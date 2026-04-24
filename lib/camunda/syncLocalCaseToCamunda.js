/**
 * Integración no bloqueante con Camunda 8 (Orchestration REST v2).
 *
 * - Por qué después del INSERT local: el caso ya es la fuente de verdad en Postgres; Camunda solo orquesta seguimiento.
 * - Por qué no propagamos errores: indisponibilidad OAuth/REST o BPMN no desplegado no debe fallar la creación ciudadana.
 * - Ampliación: reintentos desde `camunda_sync_failed`, polling con `getCamundaProcessInstance`, webhooks o workers cuando existan.
 */
import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { getActiveCatalogItemByCode, getActiveCatalogItemById } from "../procedureCatalog";
import {
  CamundaClientError,
  createCamundaProcessInstance,
  getCamundaBaseUrl,
} from "./client";
import { buildIncidentCamundaVariables, buildTramiteCamundaVariables } from "./buildCamundaVariables";
import { upsertCamundaCaseLink } from "./camundaCaseLinks";

function summarizeCreateResponse(body) {
  if (!body || typeof body !== "object") {
    return {};
  }
  return {
    processInstanceKey: body.processInstanceKey ?? null,
    processDefinitionKey: body.processDefinitionKey ?? null,
    processDefinitionId: body.processDefinitionId ?? null,
    processDefinitionVersion: body.processDefinitionVersion ?? null,
  };
}

function summarizeError(err) {
  if (err instanceof CamundaClientError) {
    return err.message.slice(0, 500);
  }
  if (err && typeof err === "object" && typeof err.message === "string") {
    return err.message.slice(0, 500);
  }
  return "unknown_error";
}

async function tryUpsertCamundaSkip({
  localCaseId,
  localCaseType,
  catalogItemId = null,
  reason,
  processId = null,
}) {
  try {
    await upsertCamundaCaseLink({
      localCaseId,
      localCaseType,
      catalogItemId,
      camundaProcessDefinitionId: processId,
      camundaState: "camunda_sync_skipped",
      camundaProcessInstanceKey: null,
      rawResponseSummary: {},
      lastErrorSummary: reason,
    });
  } catch (error) {
    console.warn("[camunda] no se pudo registrar estado skipped", sanitizeForLogs({ error: summarizeError(error) }));
  }
}

function resolveFallbackProcessId(caseType) {
  if (caseType === "incident") {
    return process.env.CAMUNDA_PROCESS_ID_INCIDENT?.trim() || null;
  }
  if (caseType === "procedure") {
    return process.env.CAMUNDA_PROCESS_ID_TRAMITE?.trim() || null;
  }
  return null;
}

async function resolveCatalogProcessId({ caseType, catalogItemId, catalogCode }) {
  const expectedType = caseType === "incident" ? "incident" : "procedure";
  if (catalogItemId) {
    const byId = await getActiveCatalogItemById(catalogItemId);
    if (byId?.caseType === expectedType) {
      if (byId.camundaProcessId) {
        return {
          processId: byId.camundaProcessId,
          catalogItemId: byId.id,
          source: "catalog_item_id",
        };
      }
      return {
        processId: null,
        catalogItemId: byId.id,
        source: "catalog_item_id",
      };
    }
  }
  if (catalogCode) {
    const byCode = await getActiveCatalogItemByCode(catalogCode);
    if (byCode?.caseType === expectedType) {
      if (byCode.camundaProcessId) {
        return {
          processId: byCode.camundaProcessId,
          catalogItemId: byCode.id,
          source: "catalog_code",
        };
      }
      return {
        processId: null,
        catalogItemId: byCode.id,
        source: "catalog_code",
      };
    }
  }
  return { processId: null, catalogItemId: catalogItemId || null, source: "none" };
}

function resolveEffectiveProcessId({ caseType, catalogProcess, fallbackProcessId, hasCatalogHint }) {
  if (catalogProcess?.processId) {
    return {
      processId: catalogProcess.processId,
      source: catalogProcess.source || "catalog",
      usedFallback: false,
    };
  }
  // Si hay pista explícita de catálogo (id/código) pero no se encontró process id,
  // evitamos arrancar un BPMN incorrecto con fallback global.
  if (hasCatalogHint) {
    return {
      processId: null,
      source: "catalog_hint_without_process_id",
      usedFallback: false,
    };
  }
  return {
    processId: fallbackProcessId || null,
    source: fallbackProcessId ? `${caseType}_env_fallback` : "none",
    usedFallback: Boolean(fallbackProcessId),
  };
}

function isCamundaNotFoundError(error) {
  const status = Number(error?.status);
  if (status === 404) {
    return true;
  }
  const detail =
    typeof error?.detail === "string"
      ? error.detail
      : error?.detail && typeof error.detail === "object"
        ? JSON.stringify(error.detail)
        : "";
  return /expected to find process definition/i.test(detail);
}

/**
 * Integración activa si hay credenciales OAuth y URL de clúster.
 * Si falta algo, se omite en silencio (entornos sin Camunda).
 */
export function isCamundaIntegrationConfigured() {
  const clientId = process.env.CAMUNDA_CLIENT_ID?.trim();
  const clientSecret = process.env.CAMUNDA_CLIENT_SECRET?.trim();
  const oauthUrl = process.env.CAMUNDA_OAUTH_URL?.trim();
  return Boolean(clientId && clientSecret && oauthUrl && getCamundaBaseUrl());
}

/**
 * Tras persistir la incidencia local, disparamos Camunda como motor de seguimiento.
 * Si Camunda u OAuth fallan, el caso local ya existe: solo registramos y seguimos.
 *
 * Ampliación futura: un job o endpoint admin puede reintentar filas `camunda_sync_failed`
 * o enriquecer estado con `getCamundaProcessInstance`.
 *
 * @param {object} incident
 * @param {object} [context]
 * @param {"web"|"whatsapp"} [context.channel]
 * @param {string|null} [context.risk]
 * @param {object|null} [context.authenticatedUser]
 */
export async function syncIncidentToCamundaAfterCreate(incident, context = {}) {
  const localCaseId = incident?.id;
  if (typeof localCaseId !== "string" || !localCaseId) {
    return;
  }
  const catalogProcess = await resolveCatalogProcessId({
    caseType: "incident",
    catalogItemId: incident?.catalogItemId || context?.catalogItemId || null,
    catalogCode: context?.catalogCode || null,
  });
  const fallbackProcessId = resolveFallbackProcessId("incident");
  const hasCatalogHint = Boolean(incident?.catalogItemId || context?.catalogItemId || context?.catalogCode);
  const resolvedProcess = resolveEffectiveProcessId({
    caseType: "incident",
    catalogProcess,
    fallbackProcessId,
    hasCatalogHint,
  });
  const processId = resolvedProcess.processId;
  console.info("[camunda] incident process id resolved", {
    localCaseId,
    processId: processId || null,
    source: resolvedProcess.source,
    catalogItemId: catalogProcess.catalogItemId || null,
    catalogCode: context?.catalogCode || null,
  });
  if (!processId) {
    console.warn("[camunda] incidencia sin camunda_process_id resolvible; se omite sincronización.");
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "incident",
      catalogItemId: catalogProcess.catalogItemId,
      reason: hasCatalogHint ? "catalog_item_missing_process_id" : "missing_process_id",
      processId: null,
    });
    return;
  }

  if (!isCamundaIntegrationConfigured()) {
    console.warn("[camunda] integración Camunda no configurada; se omite sincronización.");
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "incident",
      catalogItemId: catalogProcess.catalogItemId,
      reason: "integration_not_configured",
      processId,
    });
    return;
  }

  try {
    const variables = buildIncidentCamundaVariables(incident, context);
    const raw = await createCamundaProcessInstance({ processId, variables });
    const summary = summarizeCreateResponse(raw);
    const instanceKey =
      summary.processInstanceKey != null ? String(summary.processInstanceKey) : null;

    await upsertCamundaCaseLink({
      localCaseId,
      localCaseType: "incident",
      catalogItemId: catalogProcess.catalogItemId,
      camundaProcessDefinitionId: processId,
      camundaState: "started",
      camundaProcessInstanceKey: instanceKey,
      rawResponseSummary: summary,
      lastErrorSummary: null,
    });
  } catch (error) {
    console.error("[camunda] sync incident falló (no bloquea creación local)", sanitizeForLogs({ error: summarizeError(error) }));
    await upsertCamundaCaseLink({
      localCaseId,
      localCaseType: "incident",
      catalogItemId: catalogProcess.catalogItemId,
      camundaProcessDefinitionId: processId,
      camundaState: "camunda_sync_failed",
      camundaProcessInstanceKey: null,
      rawResponseSummary: {},
      lastErrorSummary: summarizeError(error),
    });
  }
}

/**
 * Igual que incidencias: el trámite ya está en BD antes de orquestar en Camunda.
 *
 * @param {object} procedureRequest
 * @param {object} [context]
 * @param {"web"|"whatsapp"} [context.channel]
 * @param {object|null} [context.authenticatedUser]
 * @param {Record<string, unknown>|null} [context.procedureCollectedData]
 */
export async function syncTramiteToCamundaAfterCreate(procedureRequest, context = {}) {
  const localCaseId = procedureRequest?.id;
  if (typeof localCaseId !== "string" || !localCaseId) {
    return;
  }
  const catalogProcess = await resolveCatalogProcessId({
    caseType: "procedure",
    catalogItemId: procedureRequest?.catalogItemId || context?.catalogItemId || null,
    catalogCode: procedureRequest?.procedureCode || context?.catalogCode || null,
  });
  const fallbackProcessId = resolveFallbackProcessId("procedure");
  const processId = catalogProcess.processId || fallbackProcessId;
  let effectiveProcessId = processId;
  let effectiveSource = catalogProcess.processId
    ? catalogProcess.source || "catalog"
    : fallbackProcessId
      ? "procedure_env_fallback"
      : "none";
  console.info("[camunda] procedure process id resolved", {
    localCaseId,
    processId: processId || null,
    source: effectiveSource,
    catalogItemId: catalogProcess.catalogItemId || null,
    catalogCode: procedureRequest?.procedureCode || context?.catalogCode || null,
  });
  if (!processId) {
    console.warn("[camunda] trámite sin camunda_process_id resolvible; se omite sincronización.");
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      reason: "missing_process_id",
      processId: null,
    });
    return;
  }

  if (!isCamundaIntegrationConfigured()) {
    console.warn("[camunda] integración Camunda no configurada; se omite sincronización.");
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      reason: "integration_not_configured",
      processId,
    });
    return;
  }

  try {
    const variables = buildTramiteCamundaVariables(procedureRequest, context);
    let raw;
    try {
      raw = await createCamundaProcessInstance({ processId: effectiveProcessId, variables });
    } catch (error) {
      const shouldRetryWithFallback =
        Boolean(catalogProcess.processId) &&
        Boolean(fallbackProcessId) &&
        fallbackProcessId !== processId &&
        isCamundaNotFoundError(error);
      if (!shouldRetryWithFallback) {
        throw error;
      }

      console.warn(
        "[camunda] process id de catálogo no desplegado; reintentando con fallback de entorno",
        sanitizeForLogs({
          localCaseId,
          failedProcessId: processId,
          fallbackProcessId,
        })
      );
      effectiveProcessId = fallbackProcessId;
      effectiveSource = "procedure_env_fallback_after_catalog_not_found";
      raw = await createCamundaProcessInstance({ processId: effectiveProcessId, variables });
    }
    const summary = summarizeCreateResponse(raw);
    const instanceKey =
      summary.processInstanceKey != null ? String(summary.processInstanceKey) : null;

    await upsertCamundaCaseLink({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      camundaProcessDefinitionId: effectiveProcessId,
      camundaState: "started",
      camundaProcessInstanceKey: instanceKey,
      rawResponseSummary: {
        ...summary,
        processIdSource: effectiveSource,
      },
      lastErrorSummary: null,
    });
  } catch (error) {
    console.error("[camunda] sync trámite falló (no bloquea creación local)", sanitizeForLogs({ error: summarizeError(error) }));
    await upsertCamundaCaseLink({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      camundaProcessDefinitionId: effectiveProcessId,
      camundaState: "camunda_sync_failed",
      camundaProcessInstanceKey: null,
      rawResponseSummary: {},
      lastErrorSummary: summarizeError(error),
    });
  }
}

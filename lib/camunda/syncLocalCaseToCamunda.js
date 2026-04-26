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
  PROCEDURE_REQUEST_EVENT_TYPES,
  PROCEDURE_REQUEST_STATUSES,
  addProcedureRequestEvent,
  getProcedureRequestById,
  hasProcessedOperation,
  incrementProcedureMetric,
  markOperationAsProcessed,
  transitionProcedureRequestStatus,
  updateProcedureRequestCamundaData,
} from "../procedureRequests";
import {
  CamundaVariableMappingValidationError,
  camundaVariableMapper,
} from "./CamundaVariableMapperService";
import {
  CamundaClientError,
  createCamundaProcessInstance,
  getCamundaBaseUrl,
  searchCamundaUserTasks,
} from "./client";
import { buildIncidentCamundaVariables } from "./buildCamundaVariables";
import { upsertCamundaCaseLink } from "./camundaCaseLinks";
import { getActiveTaskForProcedure } from "./getActiveTaskForProcedure";

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

function computeNextRetryAt({ retryCount }) {
  const safeRetryCount = Number.isInteger(retryCount) && retryCount > 0 ? retryCount : 1;
  const backoffMinutes = Math.min(60, 2 ** Math.min(safeRetryCount, 6));
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

function pickTaskId(task) {
  return String(task?.userTaskKey || task?.id || task?.key || "").trim();
}

function pickTaskDefinitionKey(task) {
  return String(task?.taskDefinitionId || task?.taskDefinitionKey || "").trim();
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
  void caseType;
  const expectedType = "procedure";
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
    await updateProcedureRequestCamundaData({
      procedureRequestId: localCaseId,
      camundaProcessInstanceKey: instanceKey,
      status: incident?.status || null,
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
    return { ok: false, reason: "missing_local_case_id" };
  }
  const persistedProcedure =
    (await getProcedureRequestById(localCaseId)) || procedureRequest || null;
  if (!persistedProcedure) {
    return { ok: false, reason: "procedure_not_found" };
  }
  const syncOperationKey = String(context?.syncOperationKey || "").trim();
  if (syncOperationKey) {
    const alreadySynced = await hasProcessedOperation({
      procedureRequestId: persistedProcedure.id,
      operationType: "CAMUNDA_START_SYNC",
      operationKey: syncOperationKey,
    });
    if (alreadySynced) {
      return { ok: true, idempotent: true, procedureRequest: persistedProcedure };
    }
  }
  if (String(persistedProcedure.camundaProcessInstanceKey || "").trim()) {
    return { ok: true, alreadySynced: true, procedureRequest: persistedProcedure };
  }
  const catalogProcess = await resolveCatalogProcessId({
    caseType: "procedure",
    catalogItemId: persistedProcedure?.catalogItemId || context?.catalogItemId || null,
    catalogCode: persistedProcedure?.procedureCode || context?.catalogCode || null,
  });
  const processId = catalogProcess.processId || null;
  const effectiveProcessId = processId;
  const effectiveSource = processId ? "procedure_catalog" : "procedure_catalog_missing_process_id";
  console.info("[camunda] procedure process id resolved", {
    localCaseId,
    procedureCode: procedureRequest?.procedureCode || context?.catalogCode || null,
    procedureId: catalogProcess.catalogItemId || null,
    camunda_process_id: processId || null,
    processId: processId || null,
    source: effectiveSource,
  });
  if (!processId) {
    console.warn("[camunda] trámite sin camunda_process_id resolvible; se omite sincronización.");
    await transitionProcedureRequestStatus({
      procedureRequestId: persistedProcedure.id,
      newStatus: PROCEDURE_REQUEST_STATUSES.ERROR_CAMUNDA_SYNC,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_FAILED,
      metadata: { reason: "procedure_catalog_missing_process_id" },
    });
    await updateProcedureRequestCamundaData({
      procedureRequestId: persistedProcedure.id,
      camundaError: "procedure_catalog_missing_process_id",
      syncRetryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      syncLastRetryAt: new Date(),
      syncNextRetryAt: computeNextRetryAt({
        retryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      }),
    });
    await incrementProcedureMetric("camunda_sync_errors", 1);
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      reason: "procedure_catalog_missing_process_id",
      processId: null,
    });
    return { ok: false, reason: "missing_process_id" };
  }

  if (!isCamundaIntegrationConfigured()) {
    console.warn("[camunda] integración Camunda no configurada; se omite sincronización.");
    await transitionProcedureRequestStatus({
      procedureRequestId: persistedProcedure.id,
      newStatus: PROCEDURE_REQUEST_STATUSES.ERROR_CAMUNDA_SYNC,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_FAILED,
      metadata: { reason: "integration_not_configured" },
    });
    await updateProcedureRequestCamundaData({
      procedureRequestId: persistedProcedure.id,
      camundaError: "integration_not_configured",
      syncRetryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      syncLastRetryAt: new Date(),
      syncNextRetryAt: computeNextRetryAt({
        retryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      }),
    });
    await incrementProcedureMetric("camunda_sync_errors", 1);
    await tryUpsertCamundaSkip({
      localCaseId,
      localCaseType: "tramite",
      catalogItemId: catalogProcess.catalogItemId,
      reason: "integration_not_configured",
      processId,
    });
    return { ok: false, reason: "integration_not_configured" };
  }

  await addProcedureRequestEvent({
    procedureRequestId: persistedProcedure.id,
    type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_STARTED,
    previousStatus: persistedProcedure.status,
    newStatus: persistedProcedure.status,
    metadata: {
      processId: effectiveProcessId,
      source: effectiveSource,
    },
  });

  try {
    let variables = {};
    try {
      variables = await camundaVariableMapper.buildVariables({
        procedureTypeId: catalogProcess.catalogItemId,
        scope: "START_INSTANCE",
        requireMappings: true,
        includeProcedureFieldDefinitions: true,
        collectedData:
          context.procedureCollectedData && typeof context.procedureCollectedData === "object"
            ? context.procedureCollectedData
            : persistedProcedure?.collectedData || {},
      });
      if (!variables || Object.keys(variables).length === 0) {
        throw new CamundaVariableMappingValidationError(
          "No hay mappings START_INSTANCE habilitados para este procedimiento.",
          {
            missingStartInstanceMappings: true,
            scope: "START_INSTANCE",
          }
        );
      }
    } catch (error) {
      if (error instanceof CamundaVariableMappingValidationError) {
        console.error(
          "[camunda] mapeo de variables inválido para inicio de trámite",
          sanitizeForLogs(error.details || {})
        );
        await upsertCamundaCaseLink({
          localCaseId,
          localCaseType: "tramite",
          catalogItemId: catalogProcess.catalogItemId,
          camundaProcessDefinitionId: effectiveProcessId,
          camundaState: "camunda_sync_failed",
          camundaProcessInstanceKey: null,
          rawResponseSummary: {},
          lastErrorSummary: "camunda_mapping_validation_error",
        });
        await transitionProcedureRequestStatus({
          procedureRequestId: persistedProcedure.id,
          newStatus: PROCEDURE_REQUEST_STATUSES.ERROR_CAMUNDA_SYNC,
          eventType: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_FAILED,
          metadata: error.details || { reason: "camunda_mapping_validation_error" },
        });
        await updateProcedureRequestCamundaData({
          procedureRequestId: persistedProcedure.id,
          camundaError: "camunda_mapping_validation_error",
          syncRetryCount: (persistedProcedure.syncRetryCount || 0) + 1,
          syncLastRetryAt: new Date(),
          syncNextRetryAt: computeNextRetryAt({
            retryCount: (persistedProcedure.syncRetryCount || 0) + 1,
          }),
        });
        await incrementProcedureMetric("camunda_sync_errors", 1);
        return { ok: false, reason: "camunda_mapping_validation_error", details: error.details || {} };
      }
      throw error;
    }
    const raw = await createCamundaProcessInstance({ processId: effectiveProcessId, variables });
    const summary = summarizeCreateResponse(raw);
    const instanceKey =
      summary.processInstanceKey != null ? String(summary.processInstanceKey) : null;
    const activeTask = await getActiveTaskForProcedure(persistedProcedure.id).catch(async () => {
      const tasks = await searchCamundaUserTasks({
        processInstanceKey: instanceKey,
        state: "CREATED",
        pageSize: 10,
      });
      const firstTask = tasks.find((task) => pickTaskId(task));
      return firstTask
        ? { taskDefinitionKey: pickTaskDefinitionKey(firstTask) || null }
        : null;
    });
    const nextStatus =
      activeTask && activeTask.taskDefinitionKey
        ? PROCEDURE_REQUEST_STATUSES.PENDING_BACKOFFICE_ACTION
        : PROCEDURE_REQUEST_STATUSES.IN_PROGRESS;

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
    await updateProcedureRequestCamundaData({
      procedureRequestId: persistedProcedure.id,
      camundaProcessInstanceKey: instanceKey,
      camundaProcessDefinitionId: summary.processDefinitionId || effectiveProcessId,
      camundaProcessVersion:
        Number.isInteger(summary.processDefinitionVersion) && summary.processDefinitionVersion > 0
          ? summary.processDefinitionVersion
          : undefined,
      camundaTaskDefinitionKey: activeTask?.taskDefinitionKey || null,
      camundaMetadata: {
        ...summary,
        processIdSource: effectiveSource,
      },
      clearCamundaError: true,
      syncRetryCount: 0,
      syncLastRetryAt: null,
      syncNextRetryAt: null,
    });
    await addProcedureRequestEvent({
      procedureRequestId: persistedProcedure.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_INSTANCE_CREATED,
      previousStatus: persistedProcedure.status,
      newStatus: nextStatus,
      metadata: {
        processInstanceKey: instanceKey,
        processDefinitionId: summary.processDefinitionId || effectiveProcessId,
        currentTaskDefinitionKey: activeTask?.taskDefinitionKey || null,
      },
    });
    await transitionProcedureRequestStatus({
      procedureRequestId: persistedProcedure.id,
      newStatus: nextStatus,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
      metadata: {
        source: "camunda_instance_created",
      },
    });
    if (syncOperationKey) {
      await markOperationAsProcessed({
        procedureRequestId: persistedProcedure.id,
        operationType: "CAMUNDA_START_SYNC",
        operationKey: syncOperationKey,
        metadata: {
          processInstanceKey: instanceKey,
          processDefinitionId: summary.processDefinitionId || effectiveProcessId,
        },
        actorId: String(context?.actorId || "system"),
      });
    }
    await incrementProcedureMetric("camunda_sync_success", 1);
    return {
      ok: true,
      processInstanceKey: instanceKey,
      status: nextStatus,
      currentTaskDefinitionKey: activeTask?.taskDefinitionKey || null,
    };
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
    await transitionProcedureRequestStatus({
      procedureRequestId: persistedProcedure.id,
      newStatus: PROCEDURE_REQUEST_STATUSES.ERROR_CAMUNDA_SYNC,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_FAILED,
      metadata: {
        error: summarizeError(error),
      },
    });
    await updateProcedureRequestCamundaData({
      procedureRequestId: persistedProcedure.id,
      camundaError: summarizeError(error),
      syncRetryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      syncLastRetryAt: new Date(),
      syncNextRetryAt: computeNextRetryAt({
        retryCount: (persistedProcedure.syncRetryCount || 0) + 1,
      }),
    });
    await incrementProcedureMetric("camunda_sync_errors", 1);
    return { ok: false, reason: "camunda_sync_failed", error: summarizeError(error) };
  }
}

export async function retryProcedureCamundaSync({
  procedureRequestId,
  actorId = null,
  context = {},
  idempotencyKey = null,
}) {
  try {
    if (!actorId) {
      return { ok: false, reason: "actor_required" };
    }
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return { ok: false, reason: "procedure_not_found" };
    }
    if (String(procedureRequest.camundaProcessInstanceKey || "").trim()) {
      return {
        ok: false,
        reason: "camunda_instance_already_exists",
        processInstanceKey: procedureRequest.camundaProcessInstanceKey,
      };
    }
    const retryOperationKey = String(idempotencyKey || "").trim();
    if (retryOperationKey) {
      const alreadyProcessed = await hasProcessedOperation({
        procedureRequestId: procedureRequest.id,
        operationType: "CAMUNDA_RETRY",
        operationKey: retryOperationKey,
      });
      if (alreadyProcessed) {
        return { ok: true, idempotent: true, procedureRequest };
      }
    }
    await addProcedureRequestEvent({
      procedureRequestId: procedureRequest.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_STARTED,
      previousStatus: procedureRequest.status,
      newStatus: procedureRequest.status,
      metadata: { retried: true },
      actorId,
    });
    await updateProcedureRequestCamundaData({
      procedureRequestId: procedureRequest.id,
      syncLastRetryAt: new Date(),
      syncRetryCount: (procedureRequest.syncRetryCount || 0) + 1,
    });
    const result = await syncTramiteToCamundaAfterCreate(procedureRequest, {
      ...context,
      actorId,
      syncOperationKey: retryOperationKey ? `retry:${retryOperationKey}` : "",
    });
    if (retryOperationKey && result?.ok) {
      await markOperationAsProcessed({
        procedureRequestId: procedureRequest.id,
        operationType: "CAMUNDA_RETRY",
        operationKey: retryOperationKey,
        metadata: result,
        actorId,
      });
    }
    try {
      await incrementProcedureMetric("camunda_retries_attempted", 1);
    } catch (metricError) {
      console.warn("[camunda] retry metric update failed", sanitizeForLogs({ error: summarizeError(metricError) }));
    }
    return result;
  } catch (error) {
    console.error("[camunda] retryProcedureCamundaSync failed", sanitizeForLogs({ error: summarizeError(error) }));
    return { ok: false, reason: "retry_failed", error: summarizeError(error) };
  }
}

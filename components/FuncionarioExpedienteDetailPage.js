"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";

const LOCAL_STATUS_LABELS = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de sincronización",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

const CAMUNDA_STATUS_LABELS = {
  ERROR_SYNC: "Error de sincronización",
  TASK_ACTIVE: "Pendiente de revisión",
  PROCESS_RUNNING: "En proceso",
  NOT_SYNCED: "Sin tarea activa",
};

function hasRole(user, targetRole) {
  const normalizedTarget = String(targetRole || "").trim().toLowerCase();
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role];
  return roles.map((role) => String(role || "").trim().toLowerCase()).includes(normalizedTarget);
}

function formatDateTime(value, locale) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(locale || "es");
}

function parseJsonInput(value, fallback = {}) {
  if (!value || !String(value).trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function humanizeTaskKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Sin tarea activa";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function getLocalStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  if (key === "PENDING_CAMUNDA_SYNC") {
    return "Pendiente de procesamiento";
  }
  return LOCAL_STATUS_LABELS[key] || value || "-";
}

function getCamundaStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  return CAMUNDA_STATUS_LABELS[key] || value || "-";
}

function getAssignmentScopeLabel(item) {
  if (item?.assignmentScope === "assigned_to_me") {
    return "Asignado a mí";
  }
  if (item?.assignmentScope === "available") {
    return "Disponible";
  }
  return "Sin relación";
}

function buildActionTitle(action) {
  if (action?.displayLabel) {
    return action.displayLabel;
  }
  if (action?.actionKey === "claim_task") {
    return "Tomar expediente";
  }
  if (action?.actionKey === "complete_task") {
    return "Completar tarea";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reintentar sincronización";
  }
  return action?.label || "Acción";
}

function buildActionDescription(action) {
  if (typeof action?.description === "string" && action.description.trim()) {
    return action.description.trim();
  }
  if (action?.actionKey === "claim_task") {
    return "Asigna este expediente a tu bandeja para habilitar la gestión y acciones de Camunda.";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reenvía el expediente a Camunda cuando hubo error de sincronización.";
  }
  if (action?.actionKey === "complete_task") {
    return `Avanza el flujo de Camunda para: ${action.taskDisplayName || "tarea activa"}.`;
  }
  return action?.label || "";
}

function resolveAttachmentValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const candidates = [
    collectedData.photo,
    collectedData.photoUrl,
    collectedData.image,
    collectedData.imageUrl,
    collectedData.attachmentUrl,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || null;
}

function resolveLocationValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const location = collectedData.location ?? collectedData.address ?? null;
  if (!location) {
    return null;
  }
  if (typeof location === "string") {
    return location;
  }
  return stringifyJson(location);
}

function resolvePrimaryDescription(procedureRequest, collectedData) {
  const candidates = [
    collectedData?.description,
    collectedData?.detail,
    collectedData?.details,
    collectedData?.descripcion,
    collectedData?.resumen,
    procedureRequest?.summary,
  ];
  const raw = candidates.find((item) => typeof item === "string" && item.trim()) || "";
  return raw
    .replace(/si está correcto,\s*confirma para continuar\.?/gi, "")
    .replace(/si esta correcto,\s*confirma para continuar\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveContactEmail(procedureRequest, collectedData) {
  const candidates = [
    collectedData?.email,
    collectedData?.contactEmail,
    collectedData?.correo,
    procedureRequest?.userEmail,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || null;
}

function isPendingCamundaSyncStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return key === "PENDING_CAMUNDA_SYNC";
}

function isFailedCamundaSyncStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return key === "ERROR_CAMUNDA_SYNC" || key === "CAMUNDA_SYNC_FAILED";
}

function ProcedureFieldVariables({ requiredVariables }) {
  if (!Array.isArray(requiredVariables) || requiredVariables.length === 0) {
    return null;
  }
  return (
    <>
      <p className="small">Variables requeridas para esta tarea:</p>
      <ul className="admin-procedure-fields__list">
        {requiredVariables.map((item, index) => (
          <li key={`${item.procedureFieldKey || "field"}-${index}`} className="admin-procedure-fields__item">
            <p className="small">
              <strong>{item.fieldLabel || item.procedureFieldKey}</strong>
            </p>
            <p className="small">
              Variable Camunda: {item.camundaVariableName} ({item.camundaVariableType || "string"})
            </p>
            <p className="small">Obligatoria: {item.required ? "Sí" : "No"}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

function BackToBandejaLink() {
  return (
    <p className="small" style={{ marginTop: "1rem" }}>
      <Link href="/funcionario/dashboard" className="button-inline">
        Volver a la bandeja
      </Link>
    </p>
  );
}

function ActionCards({ actions, onRunAction, actionLoadingKey, completeVariablesJson, setCompleteVariablesJson, internalObservation, setInternalObservation, nextStatus, setNextStatus }) {
  if (!actions.length) {
    return null;
  }
  return actions.map((action) => {
    const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
    const actionTitle = buildActionTitle(action);
    const actionDescription = buildActionDescription(action);
    return (
      <div key={actionKey} className="admin-procedure-fields__item">
        <p className="small">
          <strong>{actionTitle}</strong>
        </p>
        {actionDescription ? <p className="small">{actionDescription}</p> : null}
        {action.actionKey === "complete_task" ? (
          <>
            <label className="small">Variables para avanzar (JSON)</label>
            <textarea
              rows={6}
              value={completeVariablesJson}
              onChange={(event) => setCompleteVariablesJson(event.target.value)}
            />
            <label className="small">Observaciones internas</label>
            <textarea
              rows={3}
              value={internalObservation}
              onChange={(event) => setInternalObservation(event.target.value)}
            />
            <label className="small">Cambio de estado local (opcional)</label>
            <input
              type="text"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
              placeholder="Ej: PENDING_BACKOFFICE_ACTION"
            />
            <ProcedureFieldVariables requiredVariables={action.requiredVariables} />
          </>
        ) : null}
        <button
          type="button"
          className="button-inline"
          onClick={() => onRunAction(action)}
          disabled={actionLoadingKey === actionKey}
        >
          {actionLoadingKey === actionKey ? "Procesando..." : actionTitle}
        </button>
      </div>
    );
  });
}

export default function FuncionarioExpedienteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const rawParamId = params?.id;
  const procedureRequestId =
    typeof rawParamId === "string"
      ? rawParamId
      : Array.isArray(rawParamId) && rawParamId[0]
        ? String(rawParamId[0])
        : "";
  const { user, isLoadingAuth } = useAuth();
  const { locale } = useLocale();

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [fatalError, setFatalError] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoadingKey, setActionLoadingKey] = useState("");
  const [completeVariablesJson, setCompleteVariablesJson] = useState("{}");
  const [internalObservation, setInternalObservation] = useState("");
  const [nextStatus, setNextStatus] = useState("");

  const isFuncionario = hasRole(user, "agente");

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }
    if (!user || !isFuncionario) {
      router.replace("/");
    }
  }, [isFuncionario, isLoadingAuth, router, user]);

  const loadDetail = useCallback(async (requestId) => {
    if (!requestId) {
      setDetail(null);
      setDetailLoading(false);
      setFatalError({ message: "No se encontró el expediente solicitado." });
      return;
    }
    setDetailLoading(true);
    setFatalError(null);
    setActionError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/funcionario/procedures/requests/${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          setFatalError({ message: "No se encontró el expediente solicitado." });
        } else if (response.status === 403) {
          setFatalError({
            message:
              "No tienes permisos para ver este expediente o ya fue tomado por otro funcionario.",
          });
        } else {
          setFatalError({ message: data?.error || "No se pudo cargar el detalle del expediente." });
        }
        setDetail(null);
        return;
      }
      setDetail(data);
      setCompleteVariablesJson("{}");
      setInternalObservation("");
      setNextStatus("");
    } catch (_error) {
      setFatalError({ message: "No se pudo cargar el detalle del expediente." });
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoadingAuth || !user || !isFuncionario || !procedureRequestId) {
      return;
    }
    loadDetail(procedureRequestId);
  }, [isFuncionario, isLoadingAuth, loadDetail, procedureRequestId, user]);

  const availableActions = useMemo(
    () => (Array.isArray(detail?.availableActions) ? detail.availableActions : []),
    [detail?.availableActions]
  );

  const procedureRequest = detail?.procedureRequest || null;
  const isAvailable = procedureRequest?.assignmentScope === "available";
  const isAssignedToMe = procedureRequest?.assignmentScope === "assigned_to_me";
  const claimAction = availableActions.find((action) => action?.actionKey === "claim_task") || null;
  const retrySyncActionFromApi =
    availableActions.find((action) => action?.actionKey === "retry_camunda_sync") || null;
  const shouldShowPendingSyncAction = Boolean(
    isAssignedToMe &&
      isPendingCamundaSyncStatus(procedureRequest?.status) &&
      !procedureRequest?.camundaProcessInstanceKey
  );
  const shouldShowFailedSyncAction = Boolean(
    isAssignedToMe &&
      (isFailedCamundaSyncStatus(procedureRequest?.status) || procedureRequest?.camundaError)
  );
  const syntheticSyncAction =
    !retrySyncActionFromApi && (shouldShowPendingSyncAction || shouldShowFailedSyncAction)
      ? {
          actionKey: "retry_camunda_sync",
          displayLabel: shouldShowFailedSyncAction ? "Reintentar sincronización" : "Sincronizar con Camunda",
          endpoint: `/api/funcionario/procedures/requests/${encodeURIComponent(
            procedureRequestId
          )}/retry-camunda-sync`,
          method: "POST",
        }
      : null;
  const retrySyncAction = retrySyncActionFromApi || syntheticSyncAction;

  const operationalActions = isAvailable
    ? availableActions.filter((action) => action?.actionKey !== "claim_task")
    : availableActions.filter((action) => action?.actionKey !== "retry_camunda_sync");

  const runAction = async (action) => {
    if (!action?.endpoint || !procedureRequestId) {
      return;
    }
    const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
    setActionLoadingKey(actionKey);
    setActionError("");
    setSuccessMessage("");
    try {
      let body = undefined;
      if (action.actionKey === "complete_task") {
        const parsedVariables = parseJsonInput(completeVariablesJson, {});
        if (parsedVariables === null || typeof parsedVariables !== "object") {
          throw new Error("El JSON de variables no es válido.");
        }
        const observation = String(internalObservation || "").trim();
        const mergedVariables = { ...parsedVariables };
        if (observation) {
          mergedVariables.__internalObservation = observation;
        }
        body = {
          collectedData: mergedVariables,
          nextStatus: String(nextStatus || "").trim() || undefined,
          expectedTaskDefinitionKey: action.expectedTaskDefinitionKey || undefined,
          idempotencyKey: `backoffice-${Date.now()}`,
        };
      }
      const response = await fetch(action.endpoint, {
        method: action.method || "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) {
        let message = data?.error || "No se pudo ejecutar la acción.";
        if (action.actionKey === "claim_task" && response.status === 409) {
          message = "Este expediente ya fue tomado por otro funcionario.";
          setFatalError({ message });
          setDetail(null);
          return;
        }
        if (action.actionKey === "retry_camunda_sync") {
          message = data?.error || "No se pudo sincronizar con Camunda. Intenta nuevamente.";
        }
        throw new Error(message);
      }
      if (action.actionKey === "claim_task") {
        setSuccessMessage("Expediente tomado correctamente.");
      } else if (action.actionKey === "retry_camunda_sync") {
        setSuccessMessage("Sincronización solicitada correctamente.");
      } else {
        setSuccessMessage("Acción ejecutada correctamente.");
      }
      setFatalError(null);
      await loadDetail(procedureRequestId);
    } catch (requestError) {
      setActionError(requestError.message || "No se pudo ejecutar la acción.");
    } finally {
      setActionLoadingKey("");
    }
  };

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard" lang={locale}>
        <section className="card dashboard-header">
          <p className="info-message">Cargando…</p>
        </section>
      </main>
    );
  }

  if (!user || !isFuncionario) {
    return null;
  }

  const collectedData = procedureRequest?.collectedData || {};
  const attachmentValue = resolveAttachmentValue(collectedData);
  const locationValue = resolveLocationValue(collectedData);
  const caseDescription = resolvePrimaryDescription(procedureRequest, collectedData);
  const contactEmail = resolveContactEmail(procedureRequest, collectedData);
  const activeTaskLabel =
    detail?.activeTaskDisplay?.title ||
    detail?.activeTask?.taskDefinitionName ||
    humanizeTaskKey(detail?.activeTask?.taskDefinitionKey);
  const activeTaskDescription = String(detail?.activeTaskDisplay?.description || "").trim();
  const trackingCode = procedureRequest?.requestCode || null;

  if (fatalError) {
    return (
      <main className="page page--dashboard" lang={locale}>
        <section className="card dashboard-header">
          <div>
            <p className="eyebrow">ÁREA DEL FUNCIONARIO</p>
            <h1>Detalle del expediente</h1>
          </div>
          <p className="small" style={{ marginTop: "0.75rem" }}>
            <Link href="/funcionario/dashboard" className="portal-action-link">
              ← Volver a la bandeja
            </Link>
          </p>
        </section>
        <section className="card dashboard-section">
          <p className="error-message">{fatalError.message}</p>
          <BackToBandejaLink />
        </section>
      </main>
    );
  }

  return (
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">ÁREA DEL FUNCIONARIO</p>
          <h1>Detalle del expediente</h1>
          <p className="description">
            {trackingCode ? (
              <>
                Número de expediente:{" "}
                <span className="admin-procedure-table__mono">{trackingCode}</span>
              </>
            ) : (
              "Expediente"
            )}
          </p>
          {procedureRequest ? (
            <>
              <p className="small" style={{ marginTop: "0.5rem" }}>
                <span
                  className={`badge ${
                    isAvailable ? "badge--recibido" : "badge--en-revision"
                  }`}
                >
                  {getAssignmentScopeLabel(procedureRequest)}
                </span>
              </p>
              <p className="small" style={{ marginTop: "0.5rem" }}>
                <strong>Tipo:</strong> {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}{" "}
                {" · "}
                <strong>Canal:</strong> {procedureRequest.channel || "-"} {" · "}
                <strong>Creado:</strong> {formatDateTime(procedureRequest.createdAt, locale)} {" · "}
                <strong>Estado:</strong> {getLocalStatusLabel(procedureRequest.status)}
              </p>
            </>
          ) : null}
        </div>
        <p className="small" style={{ marginTop: "0.75rem" }}>
          <Link href="/funcionario/dashboard" className="portal-action-link">
            ← Volver a la bandeja
          </Link>
        </p>
      </section>

      {successMessage ? (
        <section className="card">
          <p className="info-message">{successMessage}</p>
        </section>
      ) : null}
      {actionError ? (
        <section className="card">
          <p className="error-message">{actionError}</p>
        </section>
      ) : null}

      {detailLoading ? (
        <section className="card dashboard-section">
          <p className="info-message">Cargando detalle...</p>
        </section>
      ) : null}

      {!detailLoading && procedureRequest ? (
        <>
          {isAvailable ? (
            <section className="card dashboard-section">
              <h3>Expediente disponible</h3>
              <p className="small">
                Este expediente está disponible para ser tomado. Para gestionarlo, primero debes asignarlo a tu
                bandeja.
              </p>
              {claimAction ? (
                <button
                  type="button"
                  className="button-inline"
                  onClick={() => runAction(claimAction)}
                  disabled={actionLoadingKey === `${claimAction.actionKey}:${claimAction.endpoint}`}
                >
                  {actionLoadingKey === `${claimAction.actionKey}:${claimAction.endpoint}`
                    ? "Procesando..."
                    : "Tomar expediente"}
                </button>
              ) : null}
            </section>
          ) : null}

          {!isAvailable && retrySyncAction && shouldShowPendingSyncAction ? (
            <section className="card dashboard-section admin-procedure-fields">
              <h3>Sincronización pendiente</h3>
              <p className="small">
                Este expediente todavía no está sincronizado con Camunda. Puedes intentar sincronizarlo para habilitar
                las tareas del proceso.
              </p>
              <button
                type="button"
                className="button-inline"
                onClick={() => runAction(retrySyncAction)}
                disabled={actionLoadingKey === `${retrySyncAction.actionKey}:${retrySyncAction.endpoint}`}
              >
                {actionLoadingKey === `${retrySyncAction.actionKey}:${retrySyncAction.endpoint}`
                  ? "Sincronizando..."
                  : "Sincronizar con Camunda"}
              </button>
            </section>
          ) : null}

          {!isAvailable && retrySyncAction && shouldShowFailedSyncAction ? (
            <section className="card dashboard-section admin-procedure-fields">
              <h3>Error de sincronización</h3>
              <p className="small">
                Ocurrió un problema al sincronizar el expediente con Camunda.
              </p>
              <button
                type="button"
                className="button-inline"
                onClick={() => runAction(retrySyncAction)}
                disabled={actionLoadingKey === `${retrySyncAction.actionKey}:${retrySyncAction.endpoint}`}
              >
                {actionLoadingKey === `${retrySyncAction.actionKey}:${retrySyncAction.endpoint}`
                  ? "Sincronizando..."
                  : "Reintentar sincronización"}
              </button>
            </section>
          ) : null}

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Resumen del caso</h3>
            <p className="small">
              <strong>Tipo de procedimiento:</strong>{" "}
              {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}
            </p>
            <p className="small">
              <strong>Descripción:</strong> {caseDescription || "Sin descripción informada."}
            </p>
            <p className="small">
              <strong>Ubicación:</strong> {locationValue || "No informada"}
            </p>
            <p className="small">
              <strong>Imagen adjunta:</strong> {attachmentValue || "No adjunta"}
            </p>
            <p className="small">
              <strong>Canal de origen:</strong> {procedureRequest.channel || "-"}
            </p>
            <p className="small">
              <strong>Fecha de creación:</strong> {formatDateTime(procedureRequest.createdAt, locale)}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Datos del ciudadano / contacto</h3>
            <p className="small">
              <strong>Ciudadano asociado:</strong> {procedureRequest.userId || "No asociado"}
            </p>
            <p className="small">
              <strong>Número de WhatsApp:</strong> {procedureRequest.whatsappPhone || "No informado"}
            </p>
            <p className="small">
              <strong>Email:</strong> {contactEmail || "No informado"}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Estado operativo</h3>
            <p className="small">
              <strong>Estado local:</strong> {getLocalStatusLabel(procedureRequest.status)}
            </p>
            <p className="small">
              <strong>Estado Camunda:</strong>{" "}
              {getCamundaStatusLabel(procedureRequest.camundaStatus || detail?.activeTask?.taskState)}
            </p>
            <p className="small">
              <strong>Tarea activa:</strong> {activeTaskLabel}
            </p>
            {activeTaskDescription ? (
              <p className="small">
                <strong>Detalle de tarea:</strong> {activeTaskDescription}
              </p>
            ) : null}
            <p className="small">
              <strong>Responsable actual:</strong> {procedureRequest.assignedToUserId || "Sin asignar"}
            </p>
            <p className="small">
              <strong>Relación con mi bandeja:</strong> {getAssignmentScopeLabel(procedureRequest)}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Acciones operativas</h3>
            {isAvailable ? (
              <p className="small">
                Hasta tomar el expediente no se habilitan acciones de gestión ni avances de Camunda.
              </p>
            ) : (
              <p className="small">
                Acciones habilitadas para este expediente asignado a tu bandeja.
              </p>
            )}
            <ActionCards
              actions={operationalActions}
              onRunAction={runAction}
              actionLoadingKey={actionLoadingKey}
              completeVariablesJson={completeVariablesJson}
              setCompleteVariablesJson={setCompleteVariablesJson}
              internalObservation={internalObservation}
              setInternalObservation={setInternalObservation}
              nextStatus={nextStatus}
              setNextStatus={setNextStatus}
            />
            {!isAvailable && !retrySyncAction && operationalActions.length === 0 ? (
              detail?.activeTask?.taskDefinitionKey ? (
                <p className="empty-message">No hay acciones operativas pendientes para este expediente.</p>
              ) : (
                <p className="small">
                  No hay una tarea activa disponible todavía. Cuando el proceso habilite una tarea, aparecerá aquí.
                </p>
              )
            ) : null}
            {!isAvailable &&
            !retrySyncAction &&
            operationalActions.length === 0 &&
            !detail?.activeTask?.taskDefinitionKey ? (
              <p className="small">
                No hay una tarea activa disponible todavía. Cuando el proceso habilite una tarea, aparecerá aquí.
              </p>
            ) : null}
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Información técnica</h3>

            <details>
              <summary>Ver datos técnicos del expediente</summary>
              <p className="small">
                <strong>ID interno:</strong>{" "}
                <span className="admin-procedure-table__mono">{procedureRequest.id}</span>
              </p>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(collectedData)}
              </pre>
            </details>

            <details>
              <summary>Ver variables de Camunda</summary>
              <p className="small">
                <strong>Instancia:</strong> {procedureRequest.camundaProcessInstanceKey || "-"}
              </p>
              <p className="small">
                <strong>Definición:</strong> {procedureRequest.camundaProcessDefinitionId || "-"}
              </p>
              <p className="small">
                <strong>Error de sincronización:</strong> {procedureRequest.camundaError || "Sin errores"}
              </p>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(procedureRequest.camundaMetadata)}
              </pre>
            </details>

            <details>
              <summary>Ver historial técnico</summary>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(detail.history || [])}
              </pre>
            </details>
          </section>
        </>
      ) : null}
    </main>
  );
}

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
  return JSON.stringify(location, null, 2);
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
      setFatalError({
        message: "No se encontró el expediente solicitado.",
      });
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
        throw new Error(message);
      }
      if (action.actionKey === "claim_task") {
        setSuccessMessage("Expediente tomado correctamente.");
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

  const procedureRequest = detail?.procedureRequest || null;
  const collectedData = procedureRequest?.collectedData || {};
  const attachmentValue = resolveAttachmentValue(collectedData);
  const locationValue = resolveLocationValue(collectedData);
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
            <p className="description">
              {trackingCode ? (
                <>
                  Expediente <span className="admin-procedure-table__mono">{trackingCode}</span>
                </>
              ) : (
                "Expediente"
              )}
            </p>
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
            <p className="small" style={{ marginTop: "0.5rem" }}>
              <span
                className={`badge ${
                  procedureRequest.assignmentScope === "assigned_to_me" ? "badge--en-revision" : "badge--recibido"
                }`}
              >
                {getAssignmentScopeLabel(procedureRequest)}
              </span>
            </p>
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
        <div className="admin-inbox-detail">
          <section className="card dashboard-section admin-procedure-fields">
            <h4>Resumen del expediente</h4>
            <p className="small">
              <strong>Resumen:</strong> {procedureRequest.summary || "Sin resumen"}
            </p>
            <p className="small">
              <strong>Tipo de procedimiento:</strong>{" "}
              {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}
            </p>
            <p className="small">
              <strong>Canal de origen:</strong> {procedureRequest.channel || "-"}
            </p>
            <p className="small">
              <strong>Fecha de creación:</strong> {formatDateTime(procedureRequest.createdAt, locale)}
            </p>
            <p className="small">
              <strong>Estado local:</strong> {getLocalStatusLabel(procedureRequest.status)}
            </p>
            <p className="small">
              <strong>Responsable actual:</strong> {procedureRequest.assignedToUserId || "Sin asignar"}
            </p>
            <p className="small">
              <strong>ID interno:</strong>{" "}
              <span className="admin-procedure-table__mono">{procedureRequest.id}</span>
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h4>Datos del ciudadano / contacto</h4>
            <p className="small">
              <strong>Ciudadano asociado:</strong> {procedureRequest.userId || "-"}
            </p>
            <p className="small">
              <strong>Número de WhatsApp:</strong> {procedureRequest.whatsappPhone || "-"}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h4>Datos recibidos por chatbot</h4>
            <label className="small">Datos recolectados</label>
            <textarea readOnly rows={8} value={JSON.stringify(collectedData || {}, null, 2)} />
            <p className="small">
              <strong>Imagen adjunta:</strong> {attachmentValue || "-"}
            </p>
            <p className="small">
              <strong>Ubicación:</strong> {locationValue || "-"}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h4>Estado Camunda</h4>
            <p className="small">
              <strong>Estado Camunda:</strong>{" "}
              {getCamundaStatusLabel(procedureRequest.camundaStatus || detail?.activeTask?.taskState)}
            </p>
            <p className="small">
              <strong>Instancia:</strong> {procedureRequest.camundaProcessInstanceKey || "-"}
            </p>
            <p className="small">
              <strong>Definición:</strong> {procedureRequest.camundaProcessDefinitionId || "-"}
            </p>
            <p className="small">
              <strong>Tarea activa:</strong> {activeTaskLabel}
            </p>
            {activeTaskDescription ? (
              <p className="small">
                <strong>Descripción funcional:</strong> {activeTaskDescription}
              </p>
            ) : null}
            <label className="small">Variables de Camunda</label>
            <textarea readOnly rows={6} value={JSON.stringify(procedureRequest.camundaMetadata || {}, null, 2)} />
            <p className="small">
              <strong>Errores de sincronización:</strong> {procedureRequest.camundaError || "Sin errores"}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h4>Acciones del funcionario</h4>
            {procedureRequest.assignmentScope === "available" ? (
              <>
                <p className="small">Este expediente está disponible para ser tomado.</p>
                <p className="small">
                  Usa <strong>Tomar expediente</strong> para habilitar la gestión y las acciones de Camunda.
                </p>
              </>
            ) : (
              <p className="small">
                Las acciones visibles se calculan por tarea activa y configuración del procedimiento.
              </p>
            )}
            {availableActions.length ? (
              availableActions.map((action) => {
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
                      onClick={() => runAction(action)}
                      disabled={actionLoadingKey === actionKey}
                    >
                      {actionLoadingKey === actionKey ? "Procesando..." : actionTitle}
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="empty-message">No hay acciones pendientes para este expediente.</p>
            )}
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h4>Historial / observaciones</h4>
            <textarea readOnly rows={8} value={JSON.stringify(detail.history || [], null, 2)} />
          </section>
        </div>
      ) : null}
    </main>
  );
}

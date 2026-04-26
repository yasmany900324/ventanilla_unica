"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { normalizeImageReference } from "../lib/imageReference";

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
  SYNC_PENDING: "Pendiente de sincronización",
  PROCESS_RUNNING: "Instancia creada (sin tarea activa)",
  PROCESS_COMPLETED: "Finalizado",
  NOT_SYNCED: "No sincronizado",
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

function getProcedureFieldDefinitions(detail) {
  const fromType = Array.isArray(detail?.procedureType?.fieldDefinitions)
    ? detail.procedureType.fieldDefinitions
    : Array.isArray(detail?.procedureType?.requiredFields)
      ? detail.procedureType.requiredFields
      : [];
  return fromType.filter((field) => field && typeof field === "object");
}

function resolveTypedFieldValue(collectedData, fieldDefinitions, expectedType) {
  const candidate = fieldDefinitions.find(
    (field) => String(field?.type || "").trim().toLowerCase() === expectedType
  );
  if (!candidate?.key) {
    return null;
  }
  return collectedData?.[candidate.key] ?? null;
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

function formatLocationForDisplay(rawLocation) {
  if (!rawLocation) {
    return null;
  }
  if (typeof rawLocation === "string") {
    const text = rawLocation.trim();
    return text.length >= 5 ? text : "Formato inválido";
  }
  if (rawLocation && typeof rawLocation === "object") {
    const text = String(rawLocation.text || rawLocation.address || "").trim();
    const latitude = Number(rawLocation.latitude ?? rawLocation.lat);
    const longitude = Number(rawLocation.longitude ?? rawLocation.lng ?? rawLocation.lon);
    if (text) {
      return text;
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `${latitude}, ${longitude}`;
    }
  }
  return "Formato inválido";
}

function formatAttachmentForDisplay(rawAttachment) {
  const normalized = normalizeImageReference(rawAttachment);
  return {
    isValid: normalized.isValid,
    url: normalized.url,
    label: normalized.displayName || "",
  };
}

function deriveCamundaStatus(procedureRequest, detail) {
  const existing = String(procedureRequest?.camundaStatus || "").trim();
  if (existing) {
    return existing;
  }
  const hasTask = Boolean(detail?.activeTask?.taskDefinitionKey || procedureRequest?.currentTaskDefinitionKey);
  if (procedureRequest?.camundaError) {
    return "ERROR_SYNC";
  }
  if (hasTask) {
    return "TASK_ACTIVE";
  }
  if (procedureRequest?.camundaProcessInstanceKey) {
    const localStatus = String(procedureRequest?.status || "").trim().toUpperCase();
    if (["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"].includes(localStatus)) {
      return "PROCESS_COMPLETED";
    }
    return "PROCESS_RUNNING";
  }
  if (String(procedureRequest?.status || "").trim().toUpperCase() === "PENDING_CAMUNDA_SYNC") {
    return "SYNC_PENDING";
  }
  return "NOT_SYNCED";
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

function buildOperationalSituation({ procedureRequest, camundaStatusKey, hasActiveTask, requiresSyncReview }) {
  if (requiresSyncReview) {
    return "El expediente fue creado en el sistema, pero no tiene una tarea activa asociada en Camunda.";
  }
  if (hasActiveTask) {
    return "El expediente está sincronizado y cuenta con una tarea operativa activa.";
  }
  if (String(camundaStatusKey || "").trim().toUpperCase() === "PROCESS_RUNNING") {
    return "La instancia de Camunda está activa, pero todavía no se generó una tarea operativa.";
  }
  if (isPendingCamundaSyncStatus(procedureRequest?.status)) {
    return "El expediente está pendiente de sincronización inicial con Camunda.";
  }
  return "Estado operativo estable sin alertas de sincronización.";
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
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteTechnicalDetail, setDeleteTechnicalDetail] = useState("");

  const isFuncionario = hasRole(user, "agente");
  const isAdmin = hasRole(user, "administrador");
  const isBackofficeManager = isFuncionario || isAdmin;

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }
    if (!user || !isBackofficeManager) {
      router.replace("/");
    }
  }, [isBackofficeManager, isLoadingAuth, router, user]);

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
    setDeleteTechnicalDetail("");
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
              "No tienes permisos para ver este expediente o no está asignado a tu bandeja.",
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
    if (isLoadingAuth || !user || !isBackofficeManager || !procedureRequestId) {
      return;
    }
    loadDetail(procedureRequestId);
  }, [isBackofficeManager, isLoadingAuth, loadDetail, procedureRequestId, user]);

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

  const retrySyncLoadingKey = retrySyncAction
    ? `${retrySyncAction.actionKey || "action"}:${retrySyncAction.endpoint}`
    : "";
  const isRetrySyncLoading = Boolean(retrySyncLoadingKey && actionLoadingKey === retrySyncLoadingKey);
  const requiresSyncReview = Boolean(retrySyncAction && (shouldShowPendingSyncAction || shouldShowFailedSyncAction));
  const hasActiveTask = Boolean(detail?.activeTask?.taskDefinitionKey);
  const operationalSituation = buildOperationalSituation({
    procedureRequest,
    camundaStatusKey,
    hasActiveTask,
    requiresSyncReview,
  });
  const responsibleLabel = procedureRequest?.assignedToUserId
    ? "Funcionario asignado"
    : "Sin funcionario asignado";
  const relationLabel =
    getAssignmentScopeLabel(procedureRequest) === "Sin relación"
      ? "No asignado a mi bandeja"
      : getAssignmentScopeLabel(procedureRequest);
  const activeTaskOperationalLabel =
    activeTaskLabel === "Sin tarea activa" ? "No hay tarea activa disponible" : activeTaskLabel;
  const handleRetryCamundaSync = () => {
    if (!retrySyncAction || isRetrySyncLoading) {
      return;
    }
    void runAction(retrySyncAction);
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

  if (!user || !isBackofficeManager) {
    return null;
  }

  const collectedData = procedureRequest?.collectedData || {};
  const fieldDefinitions = getProcedureFieldDefinitions(detail);
  const typedLocation = resolveTypedFieldValue(collectedData, fieldDefinitions, "location");
  const typedAttachment =
    resolveTypedFieldValue(collectedData, fieldDefinitions, "image") ||
    resolveTypedFieldValue(collectedData, fieldDefinitions, "file");
  const rawAttachment = typedAttachment ?? resolveAttachmentValue(collectedData);
  const attachmentDisplay = formatAttachmentForDisplay(rawAttachment);
  const hasPhotoProvided = String(collectedData?.photoStatus || "").trim().toLowerCase() === "provided";
  const hasPhotoSkipped = ["skipped", "not_requested"].includes(
    String(collectedData?.photoStatus || "").trim().toLowerCase()
  );
  const attachmentSummaryText = hasPhotoSkipped
    ? "No se adjuntó imagen"
    : attachmentDisplay.isValid
      ? attachmentDisplay.label || "Sí"
      : hasPhotoProvided && rawAttachment
        ? attachmentDisplay.label || String(rawAttachment || "").trim() || "Imagen adjunta registrada"
        : rawAttachment
          ? "Formato inválido"
          : "No se adjuntó imagen";
  const locationValue = formatLocationForDisplay(typedLocation ?? resolveLocationValue(collectedData));
  const caseDescription = resolvePrimaryDescription(procedureRequest, collectedData);
  const contactEmail = resolveContactEmail(procedureRequest, collectedData);
  const activeTaskLabel =
    detail?.activeTaskDisplay?.title ||
    detail?.activeTask?.taskDefinitionName ||
    humanizeTaskKey(detail?.activeTask?.taskDefinitionKey);
  const activeTaskDescription = String(detail?.activeTaskDisplay?.description || "").trim();
  const trackingCode = procedureRequest?.requestCode || null;
  const camundaStatusKey = deriveCamundaStatus(procedureRequest, detail);
  const canManageDeletion = Boolean(procedureRequest && (isAssignedToMe || isAdmin));

  const handleDeleteExpediente = async () => {
    if (!procedureRequest?.id || deleteLoading) {
      return;
    }
    setDeleteLoading(true);
    setActionError("");
    setSuccessMessage("");
    setDeleteTechnicalDetail("");
    try {
      const response = await fetch(`/api/funcionario/expedientes/${encodeURIComponent(procedureRequest.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          response.status === 409 && String(data?.error || "").toLowerCase().includes("camunda")
            ? "No se pudo eliminar la instancia en Camunda. El expediente no fue eliminado."
            : data?.error || "No se pudo eliminar el expediente.";
        setActionError(message);
        if (data?.technicalDetails) {
          setDeleteTechnicalDetail(stringifyJson(data.technicalDetails));
        }
        return;
      }
      setSuccessMessage("Expediente eliminado correctamente.");
      setIsDeleteConfirmOpen(false);
      router.push("/funcionario/dashboard");
    } catch (error) {
      setActionError("No se pudo eliminar el expediente.");
      setDeleteTechnicalDetail(stringifyJson({ message: error?.message || "network_error" }));
    } finally {
      setDeleteLoading(false);
    }
  };

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
              <strong>Imagen adjunta:</strong>{" "}
              {attachmentDisplay.url && attachmentDisplay.isValid ? (
                <>
                  {attachmentSummaryText} ·{" "}
                  <a href={attachmentDisplay.url} target="_blank" rel="noopener noreferrer">
                    Ver imagen
                  </a>
                </>
              ) : (
                attachmentSummaryText
              )}
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
            {requiresSyncReview ? (
              <div
                className="admin-roles-confirm-dialog__lead"
                style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "10px", padding: "0.75rem" }}
              >
                <p className="small" style={{ margin: 0 }}>
                  Este expediente requiere revisión de sincronización con Camunda.
                </p>
                <button
                  type="button"
                  className="button-inline"
                  onClick={handleRetryCamundaSync}
                  disabled={isRetrySyncLoading}
                  style={{ marginTop: "0.65rem" }}
                >
                  {isRetrySyncLoading ? "Sincronizando..." : "Reintentar sincronización con Camunda"}
                </button>
              </div>
            ) : null}
            <dl className="admin-roles-confirm-dialog__details" style={{ marginTop: "0.85rem" }}>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Estado del expediente</dt>
                <dd>
                  <span className={`badge ${requiresSyncReview ? "badge--en-revision" : "badge--recibido"}`}>
                    {getLocalStatusLabel(procedureRequest.status)}
                  </span>
                </dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Situación</dt>
                <dd>{operationalSituation}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Tarea activa</dt>
                <dd>{activeTaskOperationalLabel}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Responsable</dt>
                <dd>{responsibleLabel}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Relación con mi bandeja</dt>
                <dd>{relationLabel}</dd>
              </div>
            </dl>
            {activeTaskDescription ? (
              <p className="small">
                <strong>Detalle de tarea:</strong> {activeTaskDescription}
              </p>
            ) : null}
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
            {requiresSyncReview ? (
              <button
                type="button"
                className="button-inline"
                onClick={handleRetryCamundaSync}
                disabled={isRetrySyncLoading}
                style={{ marginTop: "0.4rem" }}
              >
                {isRetrySyncLoading ? "Sincronizando..." : "Reintentar sincronización"}
              </button>
            ) : null}
            {!isAvailable && !requiresSyncReview && operationalActions.length === 0 ? (
              <p className="empty-message">No hay acciones operativas disponibles para este expediente.</p>
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
              <p className="small">
                <strong>UUID responsable:</strong>{" "}
                <span className="admin-procedure-table__mono">{procedureRequest.assignedToUserId || "-"}</span>
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

          {canManageDeletion ? (
            <section className="card dashboard-section admin-procedure-fields">
              <h3>Zona de peligro</h3>
              <p className="small">
                Esta acción es destructiva. El expediente se elimina en forma permanente y no puede recuperarse.
              </p>
              <button
                type="button"
                className="button-inline button-inline--danger"
                onClick={() => setIsDeleteConfirmOpen(true)}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Eliminando..." : "Eliminar expediente"}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {deleteTechnicalDetail ? (
        <section className="card dashboard-section admin-procedure-fields">
          <details>
            <summary>Detalle técnico de eliminación</summary>
            <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
              {deleteTechnicalDetail}
            </pre>
          </details>
        </section>
      ) : null}

      {isDeleteConfirmOpen && procedureRequest ? (
        <div
          className="admin-roles-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-expediente-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !deleteLoading) {
              setIsDeleteConfirmOpen(false);
            }
          }}
        >
          <section className="admin-roles-confirm-dialog__panel" onClick={(event) => event.stopPropagation()}>
            <header className="admin-roles-confirm-dialog__header">
              <h2 id="delete-expediente-title" className="admin-roles-confirm-dialog__title">
                Confirmar eliminación del expediente
              </h2>
            </header>
            <p className="admin-roles-confirm-dialog__lead">
              Esta acción eliminará el expediente del sistema. Si existe una instancia asociada en Camunda, primero
              se intentará eliminar/cancelar esa instancia. Esta acción no se puede deshacer.
            </p>
            <dl className="admin-roles-confirm-dialog__details">
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Número de expediente</dt>
                <dd>{procedureRequest.requestCode || "-"}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Estado local</dt>
                <dd>{getLocalStatusLabel(procedureRequest.status)}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Instancia Camunda</dt>
                <dd>{procedureRequest.camundaProcessInstanceKey || "-"}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Definición Camunda</dt>
                <dd>{procedureRequest.camundaProcessDefinitionId || "-"}</dd>
              </div>
            </dl>
            <div className="admin-roles-confirm-dialog__actions">
              <button
                type="button"
                className="admin-roles-confirm-dialog__button admin-roles-confirm-dialog__button--ghost"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={deleteLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="admin-roles-confirm-dialog__button"
                onClick={handleDeleteExpediente}
                disabled={deleteLoading}
                style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
              >
                {deleteLoading ? "Eliminando..." : "Sí, eliminar expediente"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

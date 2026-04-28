/**
 * Estado operativo Camunda derivado para expediente (funcionario / detalle).
 * Extraído del componente para tests sin jsdom.
 */

export const BENIGN_OPERATIONAL_ERROR_CODES = new Set(["CAMUNDA_ACTIVE_TASK_NOT_FOUND"]);

export const ACTIVE_TASK_API_MISS_USER_MESSAGE =
  "La instancia Camunda está activa, pero no se pudo obtener una User Task operable desde la API.";

const LOCAL_STATUS_LABELS = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de sincronización",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  CAMUNDA_ACTIVE_TASK_NOT_FOUND: "Instancia activa (tarea no visible vía API)",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

function getLocalStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  if (key === "PENDING_CAMUNDA_SYNC") {
    return "Pendiente de procesamiento";
  }
  return LOCAL_STATUS_LABELS[key] || value || "-";
}

const TERMINAL_PROCEDURE_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function isTerminalProcedureStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return TERMINAL_PROCEDURE_STATUSES.has(key);
}

function normalizeForSyncHeuristic(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ");
}

function textIndicatesSyncFailure(value) {
  const n = normalizeForSyncHeuristic(value);
  if (!n) {
    return false;
  }
  if (n.includes("error") && (n.includes("sincronizacion") || n.includes("sync"))) {
    return true;
  }
  if (n.includes("sync error") || n.includes("sync_error") || n.includes("camunda sync")) {
    return true;
  }
  if (/\bfailed\b/.test(n) || /\berror\b/.test(n)) {
    if (n.includes("camunda") || n.includes("sync")) {
      return true;
    }
  }
  return false;
}

function camundaStatusIndicatesSyncFailure(camundaStatusKey) {
  const key = String(camundaStatusKey || "").trim().toUpperCase();
  return key === "ERROR_SYNC";
}

/**
 * @param {unknown[]} operationalErrors
 * @returns {{ blockingErrors: unknown[], benignActiveTaskMiss: unknown[] }}
 */
export function splitOperationalErrors(operationalErrors) {
  const list = Array.isArray(operationalErrors) ? operationalErrors : [];
  const blockingErrors = list.filter((e) => !BENIGN_OPERATIONAL_ERROR_CODES.has(String(e?.code || "")));
  const benignActiveTaskMiss = list.filter((e) => BENIGN_OPERATIONAL_ERROR_CODES.has(String(e?.code || "")));
  return { blockingErrors, benignActiveTaskMiss };
}

export function deriveCamundaStatus(procedureRequest, detail) {
  const existing = String(procedureRequest?.camundaStatus || "").trim();
  if (existing) {
    return existing;
  }
  const processState = String(detail?.operationalState?.process?.state || "")
    .trim()
    .toUpperCase();
  const hasTask = Boolean(detail?.activeTask?.taskDefinitionKey);
  const operationalErrors = detail?.operationalState?.errors || [];
  const { blockingErrors, benignActiveTaskMiss } = splitOperationalErrors(operationalErrors);

  if (procedureRequest?.camundaError) {
    return "ERROR_SYNC";
  }
  if (blockingErrors.length > 0) {
    return "ERROR_SYNC";
  }
  if (hasTask) {
    return "TASK_ACTIVE";
  }
  if (
    benignActiveTaskMiss.length > 0 &&
    (processState === "ACTIVE" || processState === "RUNNING")
  ) {
    return "ACTIVE_TASK_NOT_FOUND";
  }
  if (["COMPLETED", "TERMINATED", "CANCELED", "CANCELLED"].includes(processState)) {
    return "PROCESS_COMPLETED";
  }
  if (processState === "ACTIVE" || processState === "RUNNING") {
    return "PROCESS_RUNNING";
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

export function buildOperationalSituation({
  procedureRequest,
  camundaStatusKey,
  hasActiveTask,
  requiresCamundaRetry,
  isInitialCamundaSyncPending,
}) {
  if (requiresCamundaRetry) {
    return "No hay una tarea activa asociada en Camunda. Se recomienda reintentar la sincronización.";
  }
  if (isInitialCamundaSyncPending) {
    return "El expediente está pendiente de sincronización inicial con Camunda.";
  }
  if (hasActiveTask) {
    return "El expediente está sincronizado y cuenta con una tarea operativa activa.";
  }
  if (String(camundaStatusKey || "").trim().toUpperCase() === "ACTIVE_TASK_NOT_FOUND") {
    return ACTIVE_TASK_API_MISS_USER_MESSAGE;
  }
  if (String(camundaStatusKey || "").trim().toUpperCase() === "PROCESS_RUNNING") {
    return "La instancia de Camunda está activa, pero todavía no se generó una tarea operativa.";
  }
  return "Estado operativo estable sin alertas de sincronización.";
}

function isFailedCamundaSyncStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return key === "ERROR_CAMUNDA_SYNC" || key === "CAMUNDA_SYNC_FAILED";
}

export function computeRequiresCamundaRetry({
  procedureRequest,
  camundaStatusKey,
  camundaStatusLabel,
  hasActiveTask,
  isAvailable,
}) {
  if (!procedureRequest || isAvailable || isTerminalProcedureStatus(procedureRequest.status)) {
    return false;
  }
  if (procedureRequest?.camundaError) {
    return true;
  }
  if (isFailedCamundaSyncStatus(procedureRequest?.status)) {
    return true;
  }
  if (camundaStatusIndicatesSyncFailure(camundaStatusKey)) {
    return true;
  }
  if (textIndicatesSyncFailure(getLocalStatusLabel(procedureRequest?.status))) {
    return true;
  }
  if (textIndicatesSyncFailure(camundaStatusLabel)) {
    return true;
  }
  if (!hasActiveTask && procedureRequest?.camundaProcessInstanceKey) {
    return false;
  }
  return false;
}

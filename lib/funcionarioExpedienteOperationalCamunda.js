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

function trimStr(value) {
  const s = value != null && String(value).trim();
  return s || "";
}

/**
 * Nombre funcional del paso actual (Orchestration / snapshot), sin priorizar títulos técnicos de display.
 * Orden: name, taskName, label, taskDefinitionName; último recurso taskDefinitionKey (p. ej. elementId BPMN).
 * @param {Record<string, unknown>|null|undefined} activeTask
 */
export function buildOperativeStepLabel(activeTask) {
  if (!activeTask || typeof activeTask !== "object") {
    return "Sin tarea activa";
  }
  const fromName =
    trimStr(activeTask.name) ||
    trimStr(activeTask.taskName) ||
    trimStr(activeTask.label) ||
    trimStr(activeTask.taskDefinitionName);
  if (fromName) {
    return fromName;
  }
  const key = trimStr(activeTask.taskDefinitionKey);
  return key || "Sin tarea activa";
}

/**
 * Relación del expediente con la bandeja del funcionario según dueño local (inbox_owner_user_id), no assignee Camunda.
 * @param {unknown} inboxOwnerUserId
 * @param {unknown} currentUserId
 */
export function buildInboxRelationLabelFromOwner(inboxOwnerUserId, currentUserId) {
  const owner = trimStr(inboxOwnerUserId);
  const current = trimStr(currentUserId);
  if (!owner) {
    return "Disponible";
  }
  if (current && owner === current) {
    return "Asignado a mí";
  }
  return "Asignado a otro funcionario";
}

/**
 * Responsable de la user task en Camunda (assignee) frente al funcionario actual.
 * @param {unknown} assignee
 * @param {unknown} currentUserId
 */
export function buildCamundaAssigneeResponsibilityLabel(assignee, currentUserId) {
  const a = trimStr(assignee);
  const current = trimStr(currentUserId);
  if (!a) {
    return "Sin asignar";
  }
  if (current && a === current) {
    return "Asignado a mí";
  }
  return "Asignado a otro funcionario";
}

/**
 * Estado funcional visible (no protocolo Camunda en crudo).
 * @param {{
 *   hasActiveTask: boolean,
 *   activeTask: Record<string, unknown>|null|undefined,
 *   processStateUpper: string,
 *   camundaStatusKey: string,
 * }} input
 */
export function buildFunctionalWorkflowStateLabel({ hasActiveTask, activeTask, processStateUpper, camundaStatusKey }) {
  const proc = String(processStateUpper || "").trim().toUpperCase();
  const statusKey = String(camundaStatusKey || "").trim().toUpperCase();
  if (["COMPLETED", "TERMINATED", "CANCELED", "CANCELLED"].includes(proc)) {
    return "Completada";
  }
  if (statusKey === "PROCESS_COMPLETED") {
    return "Completada";
  }
  if (!hasActiveTask) {
    return "Sin tarea activa";
  }
  const taskState = trimStr(activeTask?.state).toUpperCase();
  const assignee = activeTask?.assignee != null && trimStr(activeTask.assignee);
  if (taskState === "COMPLETED") {
    return "Completada";
  }
  if (!assignee) {
    return "Pendiente de tomar";
  }
  return "En gestión";
}

/**
 * Resumen de la siguiente acción Camunda habilitada en el snapshot.
 * @param {Array<Record<string, unknown>>|null|undefined} operationalActions
 */
export function buildCamundaAdvanceActionSummaryLabel(operationalActions) {
  const list = Array.isArray(operationalActions) ? operationalActions : [];
  const claim = list.find((a) => a?.actionKey === "claim_task");
  const complete = list.find((a) => a?.actionKey === "complete_task");
  if (claim && claim.enabled !== false) {
    return "Tomar tarea";
  }
  if (complete && complete.enabled !== false) {
    return "Completar tarea";
  }
  return "Sin acciones disponibles";
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

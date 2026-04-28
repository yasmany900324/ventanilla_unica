import { getActiveTaskForProcedure } from "./camunda/getActiveTaskForProcedure";
import {
  humanizeTaskDefinitionKey,
  resolveTaskDisplayConfig,
  resolveTaskUiConfig,
} from "./procedureRequestInboxDetail";
import { getProcedureCatalogEntryById } from "./procedureCatalog";

function trimString(value) {
  const normalized = value != null ? String(value).trim() : "";
  return normalized || "";
}

function isTechnicalTaskText(value) {
  const text = trimString(value);
  if (!text) {
    return false;
  }
  return /^(activity|task)(?:[_\-\s][a-z0-9_:-]+)+$/i.test(text);
}

function pickFriendlyTaskLabel(candidate) {
  const label = trimString(candidate);
  if (!label) {
    return "";
  }
  const blocked = label.toLowerCase();
  if (blocked === "sin tarea activa" || blocked === "sin acción pendiente" || blocked === "sin accion pendiente") {
    return "";
  }
  if (isTechnicalTaskText(label)) {
    return "";
  }
  return label;
}

function safeHumanizedTaskDefinitionKey(taskDefinitionKey) {
  const key = trimString(taskDefinitionKey);
  if (!key) {
    return "";
  }
  if (isTechnicalTaskText(key)) {
    return "";
  }
  const humanized = trimString(humanizeTaskDefinitionKey(key));
  if (!humanized || isTechnicalTaskText(humanized)) {
    return "";
  }
  return humanized;
}

function resolvePendingTaskLabel({ activeTask, procedureType, operativeStepLabel, taskDefinitionKey }) {
  const effectiveActiveTask =
    activeTask && typeof activeTask === "object"
      ? activeTask
      : taskDefinitionKey
        ? { taskDefinitionKey }
        : null;

  const fromActiveTaskName = pickFriendlyTaskLabel(activeTask?.name);
  if (fromActiveTaskName) {
    return fromActiveTaskName;
  }

  const fromOperativeStepLabel = pickFriendlyTaskLabel(operativeStepLabel);
  if (fromOperativeStepLabel) {
    return fromOperativeStepLabel;
  }

  const taskUiConfig = resolveTaskUiConfig({ activeTask: effectiveActiveTask, procedureType });
  const dictionaryTitle = pickFriendlyTaskLabel(taskUiConfig?.title);
  if (dictionaryTitle) {
    return dictionaryTitle;
  }

  const displayConfigTitle = pickFriendlyTaskLabel(
    resolveTaskDisplayConfig({ activeTask: effectiveActiveTask, procedureType })?.title
  );
  if (displayConfigTitle) {
    return displayConfigTitle;
  }

  const fromHumanizedKey = safeHumanizedTaskDefinitionKey(taskDefinitionKey);
  if (fromHumanizedKey) {
    return fromHumanizedKey;
  }

  return "Tarea pendiente";
}

export function buildPendingAction(procedureRequest) {
  if (procedureRequest.assignmentScope === "available") {
    return "Tomar expediente";
  }
  if (procedureRequest.camundaError) {
    return "Reintentar sincronización Camunda";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    return procedureRequest.taskAssigneeId ? "Completar paso" : "Reclamar tarea";
  }
  return "Sin acción pendiente";
}

export function buildCamundaStatusLabel(camundaStatus) {
  if (camundaStatus === "ERROR_SYNC") {
    return "Error de sincronización";
  }
  if (camundaStatus === "TASK_ACTIVE") {
    return "Pendiente de revisión";
  }
  if (camundaStatus === "SYNC_PENDING") {
    return "Pendiente de sincronización";
  }
  if (camundaStatus === "PROCESS_RUNNING") {
    return "Instancia creada (sin tarea activa)";
  }
  if (camundaStatus === "PROCESS_COMPLETED") {
    return "Finalizado";
  }
  return "Sin tarea activa";
}

export function buildCamundaStatus(procedureRequest) {
  const localStatus = String(procedureRequest.status || "").trim().toUpperCase();
  if (procedureRequest.camundaError) {
    return "ERROR_SYNC";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    return "TASK_ACTIVE";
  }
  if (!procedureRequest.camundaProcessInstanceKey && localStatus === "PENDING_CAMUNDA_SYNC") {
    return "SYNC_PENDING";
  }
  if (procedureRequest.camundaProcessInstanceKey) {
    if (["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"].includes(localStatus)) {
      return "PROCESS_COMPLETED";
    }
    return "PROCESS_RUNNING";
  }
  return "NOT_SYNCED";
}

export async function enrichProcedureRequestsForInbox(procedures) {
  const uniqueProcedureTypeIds = Array.from(
    new Set(
      (Array.isArray(procedures) ? procedures : [])
        .map((procedureRequest) => trimString(procedureRequest?.procedureTypeId))
        .filter(Boolean)
    )
  );
  const procedureTypeById = new Map();
  await Promise.all(
    uniqueProcedureTypeIds.map(async (procedureTypeId) => {
      const entry = await getProcedureCatalogEntryById(procedureTypeId).catch(() => null);
      procedureTypeById.set(procedureTypeId, entry);
    })
  );

  return Promise.all(
    procedures.map(async (procedureRequest) => {
      const fallbackTaskDefinitionKey = trimString(
        procedureRequest.currentTaskDefinitionKey ||
          procedureRequest.activeTaskDefinitionKey ||
          procedureRequest.taskDefinitionKey ||
          procedureRequest.camundaTaskDefinitionKey
      );
      const fetchedActiveTask =
        procedureRequest.camundaProcessInstanceKey && !fallbackTaskDefinitionKey
          ? await getActiveTaskForProcedure(procedureRequest.id).catch(() => null)
          : null;
      const currentTaskDefinitionKey = trimString(
        fetchedActiveTask?.taskDefinitionKey || fallbackTaskDefinitionKey
      );
      const activeTaskFromRow =
        procedureRequest.activeTask && typeof procedureRequest.activeTask === "object"
          ? procedureRequest.activeTask
          : null;
      const activeTask =
        fetchedActiveTask ||
        activeTaskFromRow ||
        (currentTaskDefinitionKey
          ? {
              taskDefinitionKey: currentTaskDefinitionKey,
              name: trimString(procedureRequest.activeTaskName || procedureRequest.taskName) || null,
              taskName: trimString(procedureRequest.taskName) || null,
            }
          : null);
      const procedureType = procedureTypeById.get(trimString(procedureRequest?.procedureTypeId)) || null;
      const camundaStatus = buildCamundaStatus({
        ...procedureRequest,
        currentTaskDefinitionKey,
      });
      const pendingAction = buildPendingAction({
        ...procedureRequest,
        currentTaskDefinitionKey,
      });
      const pendingActionDetail = currentTaskDefinitionKey
        ? resolvePendingTaskLabel({
            activeTask,
            procedureType,
            operativeStepLabel: procedureRequest.operativeStepLabel,
            taskDefinitionKey: currentTaskDefinitionKey,
        })
        : "";
      return {
        ...procedureRequest,
        assignedToUserId: procedureRequest.assignedToUserId || null,
        hasCamundaError: Boolean(procedureRequest.camundaError),
        camundaStatus,
        camundaStatusLabel: buildCamundaStatusLabel(camundaStatus),
        pendingAction,
        pendingActionDetail,
        activeTask: activeTask || null,
      };
    })
  );
}

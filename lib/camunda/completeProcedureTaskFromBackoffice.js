import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import {
  PROCEDURE_REQUEST_EVENT_TYPES,
  PROCEDURE_REQUEST_STATUSES,
  addProcedureRequestEvent,
  claimProcedureTask,
  hasProcessedOperation,
  incrementProcedureMetric,
  getProcedureRequestById,
  markOperationAsProcessed,
  releaseExpiredProcedureTaskClaims,
  transitionProcedureRequestStatus,
  updateProcedureRequestCamundaData,
} from "../procedureRequests";
import { getCamundaCaseLinkByLocalCase } from "./camundaCaseLinks";
import { getActiveTaskForProcedure } from "./getActiveTaskForProcedure";
import { CamundaVariableMappingValidationError, camundaVariableMapper } from "./CamundaVariableMapperService";
import { claimCamundaUserTask, completeCamundaUserTask, searchCamundaUserTasks } from "./client";

export class CompleteProcedureTaskError extends Error {
  constructor(message, details = {}, status = 400) {
    super(message);
    this.name = "CompleteProcedureTaskError";
    this.details = details;
    this.status = status;
  }
}

function pickTaskDefinitionKey(task) {
  return (
    String(task?.taskDefinitionId || "").trim() ||
    String(task?.taskDefinitionKey || "").trim() ||
    String(task?.elementId || "").trim() ||
    ""
  );
}

function pickTaskId(task) {
  return String(task?.userTaskKey || task?.id || task?.key || "").trim();
}

export async function completeProcedureTaskFromBackoffice({
  procedureRequestId,
  collectedData = {},
  formValues = null,
  internalObservation = null,
  nextLocalStatus = null,
  actorId = null,
  expectedTaskDefinitionKey = null,
  idempotencyKey = null,
}) {
  if (!actorId) {
    throw new CompleteProcedureTaskError("actorId es obligatorio para completar tareas.", {}, 400);
  }
  await releaseExpiredProcedureTaskClaims();
  const procedureRequest = await getProcedureRequestById(procedureRequestId);
  if (!procedureRequest) {
    throw new CompleteProcedureTaskError("No se encontró el trámite solicitado.", {}, 404);
  }
  if (!procedureRequest.procedureTypeId) {
    throw new CompleteProcedureTaskError(
      "El trámite no tiene tipo de procedimiento configurado.",
      { procedureRequestId },
      400
    );
  }
  const link = await getCamundaCaseLinkByLocalCase({
    localCaseId: procedureRequest.id,
    localCaseType: "tramite",
  });
  const processInstanceKey =
    String(procedureRequest.camundaProcessInstanceKey || "").trim() ||
    String(link?.camundaProcessInstanceKey || "").trim();
  if (!processInstanceKey) {
    throw new CompleteProcedureTaskError(
      "El trámite no tiene instancia de Camunda asociada.",
      { procedureRequestId: procedureRequest.id },
      400
    );
  }

  const activeTask = await getActiveTaskForProcedure(procedureRequest.id);
  if (!activeTask) {
    throw new CompleteProcedureTaskError(
      "No se encontró una tarea activa para este trámite en Camunda.",
      { processInstanceKey },
      409
    );
  }
  const taskId = activeTask.taskId;
  const userTaskKey = String(activeTask.userTaskKey || activeTask.taskId || "").trim() || null;
  const taskDefinitionKey = activeTask.taskDefinitionKey;
  const taskFormKey = String(activeTask.formKey || "").trim() || null;
  const normalizedIdempotencyKey = String(idempotencyKey || "").trim();
  const completionOperationKey =
    normalizedIdempotencyKey || `${taskId}:${taskDefinitionKey}:${actorId}`;
  const alreadyProcessed = await hasProcessedOperation({
    procedureRequestId: procedureRequest.id,
    operationType: "COMPLETE_TASK",
    operationKey: completionOperationKey,
  });
  if (alreadyProcessed) {
    return {
      idempotent: true,
      procedureRequest,
      camunda: {
        processInstanceKey,
        taskId,
        taskDefinitionKey,
        nextTaskDefinitionKey: procedureRequest.currentTaskDefinitionKey || null,
        processEnded: false,
        variableKeys: [],
      },
    };
  }
  const normalizedExpectedTaskDefinitionKey = String(expectedTaskDefinitionKey || "").trim();
  if (
    normalizedExpectedTaskDefinitionKey &&
    normalizedExpectedTaskDefinitionKey !== taskDefinitionKey
  ) {
    throw new CompleteProcedureTaskError(
      "La tarea activa cambió. Actualiza la vista antes de completar.",
      {
        expectedTaskDefinitionKey: normalizedExpectedTaskDefinitionKey,
        currentTaskDefinitionKey: taskDefinitionKey,
      },
      409
    );
  }

  const freshProcedure = await getProcedureRequestById(procedureRequest.id);
  if (
    freshProcedure?.currentTaskDefinitionKey &&
    String(freshProcedure.currentTaskDefinitionKey).trim() !== taskDefinitionKey
  ) {
    throw new CompleteProcedureTaskError(
      "La tarea activa cambió en Camunda. Refresca antes de completar.",
      {
        persistedTaskDefinitionKey: freshProcedure.currentTaskDefinitionKey,
        currentTaskDefinitionKey: taskDefinitionKey,
      },
      409
    );
  }
  const claimedBy = String(freshProcedure?.taskAssigneeId || "").trim() || null;
  if (claimedBy && actorId && claimedBy !== actorId) {
    throw new CompleteProcedureTaskError(
      "La tarea está asignada a otro funcionario.",
      { assigneeId: claimedBy },
      409
    );
  }
  if (actorId) {
    const claimResult = await claimProcedureTask({
      procedureRequestId: procedureRequest.id,
      actorId,
      expectedTaskDefinitionKey: taskDefinitionKey,
    });
    if (!claimResult?.ok) {
      throw new CompleteProcedureTaskError(
        "No se pudo reclamar la tarea localmente. Puede haber sido tomada por otro usuario.",
        claimResult || {},
        409
      );
    }
    try {
      await claimCamundaUserTask(taskId, actorId);
    } catch (_error) {
      // Si Camunda ya la tenía asignada al mismo usuario o no soporta claim estricto, seguimos con validación local.
    }
  }

  const normalizedFormValues =
    formValues && typeof formValues === "object" && !Array.isArray(formValues) ? formValues : null;
  let variables = {};
  if (normalizedFormValues) {
    variables = { ...normalizedFormValues };
  } else {
    try {
      variables = await camundaVariableMapper.buildVariables({
        procedureTypeId: procedureRequest.procedureTypeId,
        scope: "COMPLETE_TASK",
        taskDefinitionKey,
        requireMappings: true,
        collectedData: {
          ...(procedureRequest.collectedData && typeof procedureRequest.collectedData === "object"
            ? procedureRequest.collectedData
            : {}),
          ...(collectedData && typeof collectedData === "object" ? collectedData : {}),
        },
      });
    } catch (error) {
      if (error instanceof CamundaVariableMappingValidationError) {
        throw new CompleteProcedureTaskError(
          "Faltan variables obligatorias o hay valores inválidos para completar la tarea.",
          error.details || {},
          400
        );
      }
      throw error;
    }
  }

  const previousStatus = procedureRequest.status;
  try {
    await completeCamundaUserTask(taskId, variables);
  } catch (error) {
    const sanitized = (error?.message || "camunda_complete_task_failed").slice(0, 500);
    await addProcedureRequestEvent({
      procedureRequestId: procedureRequest.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_SYNC_FAILED,
      previousStatus,
      newStatus: previousStatus,
      metadata: {
        stage: "complete_task",
        taskId,
        taskDefinitionKey,
        error: sanitized,
      },
      actorId: actorId || null,
    });
    await updateProcedureRequestCamundaData({
      procedureRequestId: procedureRequest.id,
      camundaError: sanitized,
    });
    await incrementProcedureMetric("camunda_complete_task_errors", 1);
    throw error;
  }
  console.info(
    "[camunda] tarea completada desde backoffice",
    sanitizeForLogs({
      procedureRequestId: procedureRequest.id,
      processInstanceKey,
      taskId,
      taskDefinitionKey,
      variableKeys: Object.keys(variables || {}),
    })
  );
  await addProcedureRequestEvent({
    procedureRequestId: procedureRequest.id,
    type: PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED,
    previousStatus,
    newStatus: previousStatus,
    metadata: {
      processInstanceKey,
      taskId,
      userTaskKey,
      taskDefinitionKey,
      formKey: taskFormKey,
      formId: null,
      variableKeys: Object.keys(variables || {}),
      ...(internalObservation
        ? {
            internalObservation: String(internalObservation).trim().slice(0, 2000),
          }
        : {}),
    },
    actorId: actorId || null,
  });
  const tasksAfterComplete = await searchCamundaUserTasks({
    processInstanceKey,
    state: "CREATED",
    pageSize: 20,
  });
  const nextTaskRaw = tasksAfterComplete.find((task) => pickTaskId(task)) || null;
  const nextTaskDefinitionKey = pickTaskDefinitionKey(nextTaskRaw) || null;
  const resolvedByDecision = (() => {
    const decisionValue =
      collectedData?.resolutionResult ??
      collectedData?.backofficeDecision ??
      collectedData?.approved ??
      null;
    if (typeof decisionValue === "boolean") {
      return decisionValue;
    }
    const lookup = String(decisionValue || "").trim().toLowerCase();
    return ["aprobado", "approved", "resolve", "resuelto", "true", "si", "sí", "1"].includes(lookup);
  })();
  const finalStatus = nextTaskDefinitionKey
    ? PROCEDURE_REQUEST_STATUSES.PENDING_BACKOFFICE_ACTION
    : nextLocalStatus ||
      (resolvedByDecision ? PROCEDURE_REQUEST_STATUSES.RESOLVED : PROCEDURE_REQUEST_STATUSES.CLOSED);

  const updated = await updateProcedureRequestCamundaData({
    procedureRequestId: procedureRequest.id,
    camundaProcessInstanceKey: processInstanceKey,
    camundaTaskDefinitionKey: nextTaskDefinitionKey,
    taskAssigneeId: nextTaskRaw?.assignee || null,
    taskClaimedAt: nextTaskRaw?.assignee ? new Date() : null,
    clearCamundaError: true,
  });
  await transitionProcedureRequestStatus({
    procedureRequestId: procedureRequest.id,
    newStatus: finalStatus,
    actorId: actorId || null,
    eventType:
      finalStatus === PROCEDURE_REQUEST_STATUSES.CLOSED ||
      finalStatus === PROCEDURE_REQUEST_STATUSES.RESOLVED
        ? PROCEDURE_REQUEST_EVENT_TYPES.PROCEDURE_CLOSED
        : PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
    metadata: {
      processInstanceKey,
      previousTaskDefinitionKey: taskDefinitionKey,
      nextTaskDefinitionKey,
    },
  });
  await incrementProcedureMetric("camunda_tasks_completed", 1);
  await markOperationAsProcessed({
    procedureRequestId: procedureRequest.id,
    operationType: "COMPLETE_TASK",
    operationKey: completionOperationKey,
    metadata: {
      processInstanceKey,
      taskId,
      taskDefinitionKey,
      nextTaskDefinitionKey,
    },
    actorId,
  });
  return {
    procedureRequest: updated || procedureRequest,
    camunda: {
      processInstanceKey,
      taskId,
      taskDefinitionKey,
      nextTaskDefinitionKey,
      processEnded: !nextTaskDefinitionKey,
      variableKeys: Object.keys(variables || {}),
    },
  };
}

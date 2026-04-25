import {
  PROCEDURE_REQUEST_EVENT_TYPES,
  findLatestWaitingCitizenProcedureRequest,
  hasProcessedOperation,
  markOperationAsProcessed,
  incrementProcedureMetric,
  updateProcedureRequestCollectedData,
} from "../procedureRequests";
import { getProcedureCatalogEntryById } from "../procedureCatalog";
import { CamundaVariableMappingValidationError, camundaVariableMapper } from "./CamundaVariableMapperService";
import { completeCamundaUserTask } from "./client";
import { getActiveTaskForProcedure } from "./getActiveTaskForProcedure";
import { syncProcedureRequestStateFromCamunda } from "./syncProcedureStateFromCamunda";

function normalizeMessageValue(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

export async function tryHandleWaitingCitizenInfoMessage({
  userId = null,
  whatsappWaId = null,
  userMessageText = "",
}) {
  const normalizedMessage = normalizeMessageValue(userMessageText);
  if (!normalizedMessage) {
    return { handled: false };
  }
  const waitingProcedure = await findLatestWaitingCitizenProcedureRequest({ userId, whatsappWaId });
  if (!waitingProcedure) {
    return { handled: false };
  }
  const [procedureType, activeTask] = await Promise.all([
    getProcedureCatalogEntryById(waitingProcedure.procedureTypeId, { includeInactive: true }).catch(() => null),
    getActiveTaskForProcedure(waitingProcedure.id).catch(() => null),
  ]);
  if (!activeTask?.taskDefinitionKey || !activeTask.taskId) {
    return { handled: false };
  }
  const citizenInfoTasks =
    procedureType?.flowDefinition &&
    typeof procedureType.flowDefinition === "object" &&
    procedureType.flowDefinition.citizenInfoTasks &&
    typeof procedureType.flowDefinition.citizenInfoTasks === "object"
      ? procedureType.flowDefinition.citizenInfoTasks
      : {};
  const taskConfig = citizenInfoTasks[activeTask.taskDefinitionKey] || null;
  if (!taskConfig?.fieldKey) {
    return { handled: false };
  }
  const mergedCollectedData = {
    ...(waitingProcedure.collectedData && typeof waitingProcedure.collectedData === "object"
      ? waitingProcedure.collectedData
      : {}),
    [taskConfig.fieldKey]: normalizedMessage,
  };
  const idempotencyKey = `${activeTask.taskId}:${taskConfig.fieldKey}:${normalizedMessage.toLowerCase()}`;
  const alreadyProcessed = await hasProcessedOperation({
    procedureRequestId: waitingProcedure.id,
    operationType: "CITIZEN_INFO_COMPLETE_TASK",
    operationKey: idempotencyKey,
  });
  if (alreadyProcessed) {
    return {
      handled: true,
      ok: true,
      idempotent: true,
      procedureRequestId: waitingProcedure.id,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED,
      replyText:
        "Gracias. Esta información ya fue recibida y el trámite continúa en proceso.",
    };
  }

  let variables = {};
  try {
    variables = await camundaVariableMapper.buildVariables({
      procedureTypeId: waitingProcedure.procedureTypeId,
      scope: "COMPLETE_TASK",
      taskDefinitionKey: activeTask.taskDefinitionKey,
      requireMappings: true,
      collectedData: mergedCollectedData,
    });
  } catch (error) {
    if (error instanceof CamundaVariableMappingValidationError) {
      return {
        handled: true,
        ok: false,
        procedureRequestId: waitingProcedure.id,
        replyText:
          "Recibimos tu respuesta, pero todavía faltan datos obligatorios para continuar el trámite.",
        details: error.details || {},
      };
    }
    throw error;
  }

  await updateProcedureRequestCollectedData({
    procedureRequestId: waitingProcedure.id,
    collectedData: mergedCollectedData,
  });

  await completeCamundaUserTask(activeTask.taskId, variables);
  await markOperationAsProcessed({
    procedureRequestId: waitingProcedure.id,
    operationType: "CITIZEN_INFO_COMPLETE_TASK",
    operationKey: idempotencyKey,
    metadata: {
      taskId: activeTask.taskId,
      taskDefinitionKey: activeTask.taskDefinitionKey,
      fieldKey: taskConfig.fieldKey,
    },
    actorId: "system",
  });
  await incrementProcedureMetric("waiting_citizen_info_responses", 1);
  await syncProcedureRequestStateFromCamunda({
    procedureRequestId: waitingProcedure.id,
    actorId: null,
  });

  return {
    handled: true,
    ok: true,
    procedureRequestId: waitingProcedure.id,
    eventType: PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED,
    replyText:
      "Gracias. Recibimos la información adicional y continuamos el trámite automáticamente.",
  };
}

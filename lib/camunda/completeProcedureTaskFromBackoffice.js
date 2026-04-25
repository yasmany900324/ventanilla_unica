import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { getProcedureRequestById, updateProcedureRequestCamundaData } from "../procedureRequests";
import { getCamundaCaseLinkByLocalCase } from "./camundaCaseLinks";
import { CamundaVariableMappingValidationError, camundaVariableMapper } from "./CamundaVariableMapperService";
import { completeCamundaUserTask, searchCamundaUserTasks } from "./client";

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
    ""
  );
}

function pickTaskId(task) {
  return String(task?.userTaskKey || task?.id || task?.key || "").trim();
}

export async function completeProcedureTaskFromBackoffice({
  procedureRequestId,
  collectedData = {},
  nextLocalStatus = null,
}) {
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

  const tasks = await searchCamundaUserTasks({
    processInstanceKey,
    state: "CREATED",
    pageSize: 20,
  });
  const activeTask = tasks.find((task) => pickTaskId(task)) || null;
  if (!activeTask) {
    throw new CompleteProcedureTaskError(
      "No se encontró una tarea activa para este trámite en Camunda.",
      { processInstanceKey },
      409
    );
  }
  const taskId = pickTaskId(activeTask);
  const taskDefinitionKey = pickTaskDefinitionKey(activeTask);
  if (!taskDefinitionKey) {
    throw new CompleteProcedureTaskError(
      "La tarea activa no tiene taskDefinitionKey.",
      { taskId },
      409
    );
  }

  let variables = {};
  try {
    variables = await camundaVariableMapper.buildVariables({
      procedureTypeId: procedureRequest.procedureTypeId,
      scope: "COMPLETE_TASK",
      taskDefinitionKey,
      collectedData,
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

  await completeCamundaUserTask(taskId, variables);
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
  const updated = await updateProcedureRequestCamundaData({
    procedureRequestId: procedureRequest.id,
    camundaProcessInstanceKey: processInstanceKey,
    camundaTaskDefinitionKey: taskDefinitionKey,
    status: nextLocalStatus || null,
  });
  return {
    procedureRequest: updated || procedureRequest,
    camunda: {
      processInstanceKey,
      taskId,
      taskDefinitionKey,
      variableKeys: Object.keys(variables || {}),
    },
  };
}

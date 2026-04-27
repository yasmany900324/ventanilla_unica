import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { getCamundaCaseLinkByLocalCase } from "./camundaCaseLinks";
import { CamundaClientError, getCamundaProcessInstance, searchCamundaUserTasks } from "./client";

function pickTaskId(task) {
  return String(task?.userTaskKey || task?.id || task?.key || "").trim();
}

function pickTaskDefinitionKey(task) {
  return String(task?.taskDefinitionId || task?.taskDefinitionKey || "").trim();
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function mapTask(task) {
  if (!task) {
    return null;
  }
  const id = pickTaskId(task);
  const taskDefinitionKey = pickTaskDefinitionKey(task);
  if (!id || !taskDefinitionKey) {
    return null;
  }
  return {
    id,
    taskDefinitionKey,
    taskDefinitionId: taskDefinitionKey,
    name: String(task.name || task.elementId || "").trim() || null,
    state: toUpper(task.state || task.status || "") || null,
    assignee: String(task.assignee || "").trim() || null,
    candidateUsers: Array.isArray(task.candidateUsers) ? task.candidateUsers : [],
    candidateGroups: Array.isArray(task.candidateGroups) ? task.candidateGroups : [],
    createdAt: task.creationDate || task.createdAt || null,
  };
}

function emptyTaskState() {
  return {
    exists: false,
    id: null,
    taskDefinitionKey: null,
    taskDefinitionId: null,
    name: null,
    state: null,
    assignee: null,
    candidateUsers: [],
    candidateGroups: [],
    createdAt: null,
  };
}

function buildDisabledActions(reason) {
  return [
    {
      action: "CLAIM_TASK",
      enabled: false,
      reason,
    },
    {
      action: "COMPLETE_TASK",
      enabled: false,
      reason,
    },
  ];
}

function buildTaskActions(activeTask, actorId) {
  if (!activeTask?.id) {
    return buildDisabledActions("NO_ACTIVE_TASK");
  }
  const normalizedActorId = String(actorId || "").trim();
  const assignee = String(activeTask.assignee || "").trim();
  const assignedToOther = assignee && normalizedActorId && assignee !== normalizedActorId;
  return [
    {
      action: "CLAIM_TASK",
      enabled: !assignee,
      reason: assignee ? "TASK_ALREADY_ASSIGNED" : null,
    },
    {
      action: "COMPLETE_TASK",
      enabled: Boolean(!assignedToOther && (assignee ? assignee === normalizedActorId : true)),
      reason: assignedToOther ? "TASK_ASSIGNED_TO_OTHER" : null,
    },
  ];
}

function classifyCamundaError(error) {
  const message = String(error?.message || "camunda_unavailable");
  if (error instanceof CamundaClientError) {
    const status = Number(error?.status || 0);
    if (status === 401 || status === 403) {
      return {
        code: "CAMUNDA_UNAUTHORIZED",
        message: "No se pudo autenticar con Camunda.",
        retryable: false,
      };
    }
    const explicitCode = typeof error.errorCode === "string" && error.errorCode.trim() ? error.errorCode.trim() : "";
    if (explicitCode) {
      const retryable = status >= 500 || status === 0;
      if (explicitCode === "CAMUNDA_TASK_SEARCH_BAD_REQUEST") {
        return {
          code: "CAMUNDA_TASK_SEARCH_BAD_REQUEST",
          message: "Camunda rechazó la búsqueda de user tasks (solicitud inválida).",
          retryable: false,
        };
      }
      return {
        code: explicitCode,
        message: message.slice(0, 240) || "Error al consultar Camunda.",
        retryable,
      };
    }
    if (status === 400) {
      return {
        code: "CAMUNDA_BAD_REQUEST",
        message: "Camunda rechazó la consulta (solicitud inválida).",
        retryable: false,
      };
    }
    return {
      code: "CAMUNDA_UNAVAILABLE",
      message: "No se pudo consultar Camunda en este momento.",
      retryable: status >= 500 || status === 0,
    };
  }
  return {
    code: "CAMUNDA_UNAVAILABLE",
    message: message || "No se pudo consultar Camunda en este momento.",
    retryable: true,
  };
}

export async function getLiveCamundaTaskSnapshot({ procedureRequest, actorId = null } = {}) {
  const snapshotAt = new Date().toISOString();
  const localCaseId = String(procedureRequest?.id || "").trim();
  const localProcessInstanceKey = String(procedureRequest?.camundaProcessInstanceKey || "").trim();
  const link = localCaseId
    ? await getCamundaCaseLinkByLocalCase({
        localCaseId,
        localCaseType: "tramite",
      }).catch(() => null)
    : null;
  const processInstanceKey =
    localProcessInstanceKey || String(link?.camundaProcessInstanceKey || "").trim();
  if (!processInstanceKey) {
    return {
      sourceOfTruth: "camunda_live",
      snapshotAt,
      process: {
        instanceKey: null,
        state: "NOT_LINKED",
        bpmnProcessId: null,
        definitionId: null,
      },
      activeTask: emptyTaskState(),
      availableActions: buildDisabledActions("MISSING_PROCESS_INSTANCE_KEY"),
      errors: [
        {
          code: "MISSING_PROCESS_INSTANCE_KEY",
          message: "El expediente no tiene instancia de Camunda vinculada.",
          retryable: false,
          source: "local",
        },
      ],
    };
  }

  try {
    const processInstance = await getCamundaProcessInstance(processInstanceKey);
    if (!processInstance) {
      return {
        sourceOfTruth: "camunda_live",
        snapshotAt,
        process: {
          instanceKey: processInstanceKey,
          state: "NOT_FOUND",
          bpmnProcessId: null,
          definitionId: null,
        },
        activeTask: emptyTaskState(),
        availableActions: buildDisabledActions("CAMUNDA_INSTANCE_NOT_FOUND"),
        errors: [
          {
            code: "CAMUNDA_INSTANCE_NOT_FOUND",
            message: "La instancia de Camunda no fue encontrada.",
            retryable: false,
            source: "camunda",
          },
        ],
      };
    }

    const [createdTasks, assignedTasks] = await Promise.all([
      searchCamundaUserTasks({
        processInstanceKey,
        state: "CREATED",
        pageSize: 25,
      }),
      searchCamundaUserTasks({
        processInstanceKey,
        state: "ASSIGNED",
        pageSize: 25,
      }),
    ]);
    const mappedAssigned = (assignedTasks || []).map(mapTask).filter(Boolean);
    const mappedCreated = (createdTasks || []).map(mapTask).filter(Boolean);
    const activeTask = mappedAssigned[0] || mappedCreated[0] || null;
    const normalizedActiveTask = activeTask
      ? {
          exists: true,
          ...activeTask,
        }
      : emptyTaskState();

    const errors = [];
    if (!activeTask) {
      errors.push({
        code: "NO_ACTIVE_TASK",
        message: "No hay user task activa para esta instancia.",
        retryable: false,
        source: "camunda",
      });
    }

    const output = {
      sourceOfTruth: "camunda_live",
      snapshotAt,
      process: {
        instanceKey: processInstanceKey,
        state: toUpper(processInstance.state || processInstance.status || "UNKNOWN"),
        bpmnProcessId: String(processInstance.processDefinitionId || "").trim() || null,
        definitionId: String(processInstance.processDefinitionId || "").trim() || null,
      },
      activeTask: normalizedActiveTask,
      availableActions: buildTaskActions(activeTask, actorId),
      errors,
    };
    console.info(
      "[camunda] live snapshot obtenido",
      sanitizeForLogs({
        procedureRequestId: localCaseId || null,
        processInstanceKey,
        processState: output.process.state,
        hasActiveTask: output.activeTask.exists,
        activeTaskId: output.activeTask.id,
        activeTaskDefinitionKey: output.activeTask.taskDefinitionKey,
      })
    );
    return output;
  } catch (error) {
    const classified = classifyCamundaError(error);
    console.warn(
      "[camunda] no se pudo obtener snapshot live",
      sanitizeForLogs({
        procedureRequestId: localCaseId || null,
        processInstanceKey,
        errorCode: classified.code,
        error: String(error?.message || "camunda_unavailable").slice(0, 300),
      })
    );
    return {
      sourceOfTruth: "camunda_live",
      snapshotAt,
      process: {
        instanceKey: processInstanceKey,
        state: "UNKNOWN",
        bpmnProcessId: null,
        definitionId: null,
      },
      activeTask: emptyTaskState(),
      availableActions: buildDisabledActions(classified.code),
      errors: [
        {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          source: "camunda",
        },
      ],
    };
  }
}

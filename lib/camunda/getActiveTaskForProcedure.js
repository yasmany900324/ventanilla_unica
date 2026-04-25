import { getProcedureRequestById, updateProcedureRequestCamundaData } from "../procedureRequests";
import { getCamundaCaseLinkByLocalCase } from "./camundaCaseLinks";
import { searchCamundaUserTasks } from "./client";

function pickTaskId(task) {
  return String(task?.userTaskKey || task?.id || task?.key || "").trim();
}

function pickTaskDefinitionKey(task) {
  return String(task?.taskDefinitionId || task?.taskDefinitionKey || "").trim();
}

function mapActiveTask(task) {
  if (!task) {
    return null;
  }
  const taskId = pickTaskId(task);
  const taskDefinitionKey = pickTaskDefinitionKey(task);
  if (!taskId || !taskDefinitionKey) {
    return null;
  }
  return {
    taskId,
    taskDefinitionKey,
    name: String(task.name || task.elementId || "").trim() || null,
    assignee: String(task.assignee || "").trim() || null,
    createdAt: task.creationDate || task.createdAt || null,
  };
}

export async function getActiveTaskForProcedure(procedureRequestId) {
  const procedure = await getProcedureRequestById(procedureRequestId);
  if (!procedure) {
    return null;
  }
  const link = await getCamundaCaseLinkByLocalCase({
    localCaseId: procedure.id,
    localCaseType: "tramite",
  });
  const processInstanceKey =
    String(procedure.camundaProcessInstanceKey || "").trim() ||
    String(link?.camundaProcessInstanceKey || "").trim();
  if (!processInstanceKey) {
    return null;
  }
  const tasks = await searchCamundaUserTasks({
    processInstanceKey,
    state: "CREATED",
    pageSize: 25,
  });
  const activeTask = mapActiveTask(tasks.find((task) => pickTaskId(task)));
  await updateProcedureRequestCamundaData({
    procedureRequestId: procedure.id,
    camundaProcessInstanceKey: processInstanceKey,
    camundaTaskDefinitionKey: activeTask?.taskDefinitionKey || null,
    taskAssigneeId: activeTask?.assignee || null,
    taskClaimedAt: activeTask ? new Date() : null,
  });
  return activeTask;
}

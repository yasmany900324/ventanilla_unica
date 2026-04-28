import { getProcedureRequestById, updateProcedureRequestCamundaData } from "../procedureRequests";
import { getCamundaCaseLinkByLocalCase } from "./camundaCaseLinks";
import { searchCamundaUserTasks } from "./client";
import { mapCamundaOrchestrationUserTask } from "./mapOrchestrationUserTask";

function mapActiveTask(task) {
  const mapped = mapCamundaOrchestrationUserTask(task);
  if (!mapped) {
    return null;
  }
  return {
    taskId: mapped.id,
    userTaskKey: mapped.userTaskKey || mapped.id,
    taskDefinitionKey: mapped.taskDefinitionKey,
    name: mapped.name,
    assignee: mapped.assignee,
    createdAt: mapped.createdAt,
    formKey: mapped.formKey || null,
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
  const candidateStates = ["CREATED", "ASSIGNED"];
  let activeTask = null;
  for (const state of candidateStates) {
    const tasks = await searchCamundaUserTasks({
      processInstanceKey,
      state,
      pageSize: 25,
    });
    activeTask = mapActiveTask(tasks.find((task) => mapCamundaOrchestrationUserTask(task)));
    if (activeTask) {
      break;
    }
  }
  await updateProcedureRequestCamundaData({
    procedureRequestId: procedure.id,
    camundaProcessInstanceKey: processInstanceKey,
    camundaTaskDefinitionKey: activeTask?.taskDefinitionKey || null,
    taskAssigneeId: activeTask?.assignee || null,
    taskClaimedAt: activeTask ? new Date() : null,
  });
  return activeTask;
}

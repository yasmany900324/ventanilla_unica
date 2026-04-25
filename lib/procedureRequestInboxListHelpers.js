import { getActiveTaskForProcedure } from "./camunda/getActiveTaskForProcedure";

export function buildPendingAction(procedureRequest) {
  if (procedureRequest.camundaError) {
    return "Reintentar sincronización Camunda";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    if (procedureRequest.taskAssigneeId) {
      return `Tarea ${procedureRequest.currentTaskDefinitionKey} asignada a ${procedureRequest.taskAssigneeId}`;
    }
    return `Reclamar tarea ${procedureRequest.currentTaskDefinitionKey}`;
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
  if (camundaStatus === "PROCESS_RUNNING") {
    return "En proceso";
  }
  return "Sin tarea activa";
}

export function buildCamundaStatus(procedureRequest) {
  if (procedureRequest.camundaError) {
    return "ERROR_SYNC";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    return "TASK_ACTIVE";
  }
  if (procedureRequest.camundaProcessInstanceKey) {
    return "PROCESS_RUNNING";
  }
  return "NOT_SYNCED";
}

export async function enrichProcedureRequestsForInbox(procedures) {
  return Promise.all(
    procedures.map(async (procedureRequest) => {
      const activeTask =
        procedureRequest.camundaProcessInstanceKey && !procedureRequest.currentTaskDefinitionKey
          ? await getActiveTaskForProcedure(procedureRequest.id).catch(() => null)
          : null;
      const currentTaskDefinitionKey =
        activeTask?.taskDefinitionKey || procedureRequest.currentTaskDefinitionKey || null;
      const camundaStatus = buildCamundaStatus({
        ...procedureRequest,
        currentTaskDefinitionKey,
      });
      return {
        ...procedureRequest,
        assignedToUserId: procedureRequest.assignedToUserId || null,
        hasCamundaError: Boolean(procedureRequest.camundaError),
        camundaStatus,
        camundaStatusLabel: buildCamundaStatusLabel(camundaStatus),
        pendingAction: buildPendingAction({
          ...procedureRequest,
          currentTaskDefinitionKey,
        }),
        activeTask: activeTask || null,
      };
    })
  );
}

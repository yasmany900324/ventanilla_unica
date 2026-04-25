import {
  CHATBOT_CONVERSATION_STATES,
  setConversationState,
} from "../chatSessionStore";
import {
  PROCEDURE_REQUEST_EVENT_TYPES,
  PROCEDURE_REQUEST_STATUSES,
  addProcedureRequestEvent,
  handleWaitingCitizenInfoTimeouts,
  getProcedureRequestById,
  hasProcessedOperation,
  incrementProcedureMetric,
  listProcedureRequestsForCamundaReconciliation,
  listProcedureRequestsPendingAutoRetry,
  markOperationAsProcessed,
  markOverdueProceduresAsEscalated,
  releaseExpiredProcedureTaskClaims,
  transitionProcedureRequestStatus,
  updateProcedureRequestCamundaData,
} from "../procedureRequests";
import { getProcedureCatalogEntryById } from "../procedureCatalog";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId";
import { getCamundaProcessInstance } from "./client";
import { getActiveTaskForProcedure } from "./getActiveTaskForProcedure";
import { retryProcedureCamundaSync } from "./syncLocalCaseToCamunda";

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveClosedStatus({ procedureType, procedureRequest }) {
  const flowDefinition =
    procedureType?.flowDefinition && typeof procedureType.flowDefinition === "object"
      ? procedureType.flowDefinition
      : {};
  const outcomeVariable = String(flowDefinition.completionOutcomeVariable || "").trim();
  const resolvedValue = String(flowDefinition.completionOutcomeResolvedValue || "RESOLVED")
    .trim()
    .toLowerCase();
  const metadata =
    procedureRequest?.camundaMetadata && typeof procedureRequest.camundaMetadata === "object"
      ? procedureRequest.camundaMetadata
      : {};
  const outcomeValue =
    outcomeVariable && metadata[outcomeVariable] != null
      ? String(metadata[outcomeVariable]).trim().toLowerCase()
      : "";
  if (outcomeValue && outcomeValue === resolvedValue) {
    return PROCEDURE_REQUEST_STATUSES.RESOLVED;
  }
  return PROCEDURE_REQUEST_STATUSES.CLOSED;
}

async function reactivateWaitingCitizenInfoChat({ procedureRequest, taskDefinitionKey, flowDefinition }) {
  const citizenInfoTasks =
    flowDefinition?.citizenInfoTasks && typeof flowDefinition.citizenInfoTasks === "object"
      ? flowDefinition.citizenInfoTasks
      : {};
  const waitingTaskConfig = citizenInfoTasks[String(taskDefinitionKey || "").trim()] || null;
  if (!waitingTaskConfig) {
    return { reactivated: false };
  }
  const fieldKey = String(waitingTaskConfig.fieldKey || "").trim();
  const prompt = String(waitingTaskConfig.prompt || "").trim();
  if (!fieldKey || !prompt) {
    return { reactivated: false };
  }

  if (procedureRequest.channel === "WHATSAPP" && procedureRequest.whatsappWaId) {
    const sessionId = buildWhatsAppAssistantSessionId(procedureRequest.whatsappWaId);
    const collectedData =
      procedureRequest.collectedData && typeof procedureRequest.collectedData === "object"
        ? { ...procedureRequest.collectedData }
        : {};
    collectedData[fieldKey] = collectedData[fieldKey] ?? "";
    await setConversationState(sessionId, {
      whatsappWaId: procedureRequest.whatsappWaId,
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: fieldKey,
      confirmationState: "none",
      collectedData,
      lastIntent: "provide_citizen_info",
      lastAction: "waiting_citizen_info_reactivated",
      lastInterpretation: {},
    });
    return { reactivated: true, channel: "WHATSAPP", fieldKey, prompt };
  }

  return { reactivated: false, channel: procedureRequest.channel || "WEB", fieldKey, prompt };
}

export async function syncProcedureRequestStateFromCamunda({
  procedureRequestId,
  actorId = null,
  sourceEventId = null,
} = {}) {
  const procedureRequest = await getProcedureRequestById(procedureRequestId);
  if (!procedureRequest) {
    return { ok: false, reason: "procedure_not_found" };
  }
  const processInstanceKey = String(procedureRequest.camundaProcessInstanceKey || "").trim();
  if (!processInstanceKey) {
    return { ok: false, reason: "missing_process_instance_key" };
  }

  const normalizedSourceEventId = String(sourceEventId || "").trim();
  if (normalizedSourceEventId) {
    const alreadyProcessed = await hasProcessedOperation({
      procedureRequestId: procedureRequest.id,
      operationType: "CAMUNDA_STATE_SYNC",
      operationKey: normalizedSourceEventId,
    });
    if (alreadyProcessed) {
      return { ok: true, idempotent: true, status: procedureRequest.status };
    }
  }

  const [procedureType, activeTask, processInstance] = await Promise.all([
    getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true }).catch(() => null),
    getActiveTaskForProcedure(procedureRequest.id).catch(() => null),
    getCamundaProcessInstance(processInstanceKey).catch(() => null),
  ]);

  const processState = toUpper(processInstance?.state || processInstance?.status || "");
  if (activeTask?.taskDefinitionKey) {
    const flowDefinition = procedureType?.flowDefinition || {};
    const citizenInfoTasks = flowDefinition.citizenInfoTasks || {};
    const isWaitingCitizenInfo = Boolean(citizenInfoTasks[activeTask.taskDefinitionKey]);
    const targetStatus = isWaitingCitizenInfo
      ? PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO
      : PROCEDURE_REQUEST_STATUSES.PENDING_BACKOFFICE_ACTION;

    await updateProcedureRequestCamundaData({
      procedureRequestId: procedureRequest.id,
      camundaTaskDefinitionKey: activeTask.taskDefinitionKey,
      taskAssigneeId: activeTask.assignee || null,
      taskClaimedAt: activeTask.assignee ? new Date() : null,
      clearCamundaError: true,
    });
    await transitionProcedureRequestStatus({
      procedureRequestId: procedureRequest.id,
      newStatus: targetStatus,
      actorId,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
      metadata: {
        source: "camunda_poll",
        processState: processState || null,
        taskDefinitionKey: activeTask.taskDefinitionKey,
      },
    });
    if (isWaitingCitizenInfo) {
      const reactivation = await reactivateWaitingCitizenInfoChat({
        procedureRequest,
        taskDefinitionKey: activeTask.taskDefinitionKey,
        flowDefinition,
      });
      await addProcedureRequestEvent({
        procedureRequestId: procedureRequest.id,
        type: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
        previousStatus: procedureRequest.status,
        newStatus: PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO,
        actorId: actorId || "system",
        metadata: {
          source: "camunda_waiting_citizen_info",
          taskDefinitionKey: activeTask.taskDefinitionKey,
          reactivation,
        },
      });
      if (normalizedSourceEventId) {
        await markOperationAsProcessed({
          procedureRequestId: procedureRequest.id,
          operationType: "CAMUNDA_STATE_SYNC",
          operationKey: normalizedSourceEventId,
          metadata: { targetStatus: PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO },
          actorId: actorId || "system",
        });
      }
      return { ok: true, status: PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO, activeTask };
    }
    if (normalizedSourceEventId) {
      await markOperationAsProcessed({
        procedureRequestId: procedureRequest.id,
        operationType: "CAMUNDA_STATE_SYNC",
        operationKey: normalizedSourceEventId,
        metadata: { targetStatus },
        actorId: actorId || "system",
      });
    }
    return { ok: true, status: targetStatus, activeTask };
  }

  const processEnded = ["COMPLETED", "TERMINATED", "CANCELED", "CANCELLED"].includes(processState);
  if (processEnded || processInstance == null) {
    const closedStatus = resolveClosedStatus({ procedureType, procedureRequest });
    await updateProcedureRequestCamundaData({
      procedureRequestId: procedureRequest.id,
      camundaTaskDefinitionKey: null,
      taskAssigneeId: null,
      taskClaimedAt: null,
      clearCamundaError: true,
    });
    await transitionProcedureRequestStatus({
      procedureRequestId: procedureRequest.id,
      newStatus: closedStatus,
      actorId,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.PROCEDURE_CLOSED,
      metadata: {
        source: "camunda_poll",
        processState: processState || "UNKNOWN",
      },
    });
    await incrementProcedureMetric("camunda_processes_closed", 1);
    if (normalizedSourceEventId) {
      await markOperationAsProcessed({
        procedureRequestId: procedureRequest.id,
        operationType: "CAMUNDA_STATE_SYNC",
        operationKey: normalizedSourceEventId,
        metadata: { targetStatus: closedStatus, processEnded: true },
        actorId: actorId || "system",
      });
    }
    return { ok: true, status: closedStatus, processEnded: true };
  }

  await transitionProcedureRequestStatus({
    procedureRequestId: procedureRequest.id,
    newStatus: PROCEDURE_REQUEST_STATUSES.IN_PROGRESS,
    actorId,
    eventType: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
    metadata: {
      source: "camunda_poll",
      processState: processState || null,
    },
  });
  if (normalizedSourceEventId) {
    await markOperationAsProcessed({
      procedureRequestId: procedureRequest.id,
      operationType: "CAMUNDA_STATE_SYNC",
      operationKey: normalizedSourceEventId,
      metadata: { targetStatus: PROCEDURE_REQUEST_STATUSES.IN_PROGRESS },
      actorId: actorId || "system",
    });
  }
  return { ok: true, status: PROCEDURE_REQUEST_STATUSES.IN_PROGRESS };
}

export async function runProcedureCamundaSyncPolling({
  limit = 100,
  actorId = null,
} = {}) {
  await releaseExpiredProcedureTaskClaims();
  const escalated = await markOverdueProceduresAsEscalated({ actorId: actorId || "system" });
  const waitingTimeouts = await handleWaitingCitizenInfoTimeouts({ actorId: actorId || "system" });
  const requests = await listProcedureRequestsForCamundaReconciliation({ limit });
  const results = [];
  for (const request of requests) {
    const result = await syncProcedureRequestStateFromCamunda({
      procedureRequestId: request.id,
      actorId,
    }).catch((error) => ({ ok: false, reason: error?.message || "poll_failed" }));
    results.push({ procedureRequestId: request.id, ...result });
  }
  return {
    ok: true,
    polled: requests.length,
    escalated,
    waitingTimeouts,
    results,
  };
}

export async function runProcedureCamundaAutoRetries({
  limit = 20,
  actorId = null,
} = {}) {
  const due = await listProcedureRequestsPendingAutoRetry({ limit });
  const results = [];
  for (const request of due) {
    const retry = await retryProcedureCamundaSync({
      procedureRequestId: request.id,
      actorId: actorId || "system",
      context: {
        procedureCollectedData: request.collectedData || {},
      },
      idempotencyKey: `auto-retry:${request.id}:${request.syncRetryCount || 0}`,
    }).catch((error) => ({ ok: false, reason: error?.message || "auto_retry_failed" }));
    results.push({ procedureRequestId: request.id, ...retry });
    if (!retry?.ok) {
      await incrementProcedureMetric("camunda_retries_failed", 1);
    }
  }
  return {
    ok: true,
    attempted: due.length,
    results,
  };
}

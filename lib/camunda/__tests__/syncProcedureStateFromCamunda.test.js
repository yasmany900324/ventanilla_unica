import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProcedureRequestById: vi.fn(),
  listProcedureRequestsForCamundaReconciliation: vi.fn(),
  listProcedureRequestsPendingAutoRetry: vi.fn(),
  releaseExpiredProcedureTaskClaims: vi.fn(),
  markOverdueProceduresAsEscalated: vi.fn(),
  handleWaitingCitizenInfoTimeouts: vi.fn(),
  hasProcessedOperation: vi.fn(),
  markOperationAsProcessed: vi.fn(),
  incrementProcedureMetric: vi.fn(),
  updateProcedureRequestCamundaData: vi.fn(),
  transitionProcedureRequestStatus: vi.fn(),
  addProcedureRequestEvent: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
  getActiveTaskForProcedure: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  setConversationState: vi.fn(),
  retryProcedureCamundaSync: vi.fn(),
}));

vi.mock("../../procedureRequests", () => ({
  PROCEDURE_REQUEST_EVENT_TYPES: {
    STATUS_CHANGED: "STATUS_CHANGED",
    PROCEDURE_CLOSED: "PROCEDURE_CLOSED",
  },
  PROCEDURE_REQUEST_STATUSES: {
    WAITING_CITIZEN_INFO: "WAITING_CITIZEN_INFO",
    PENDING_BACKOFFICE_ACTION: "PENDING_BACKOFFICE_ACTION",
    IN_PROGRESS: "IN_PROGRESS",
    CLOSED: "CLOSED",
    RESOLVED: "RESOLVED",
  },
  getProcedureRequestById: mocks.getProcedureRequestById,
  listProcedureRequestsForCamundaReconciliation: mocks.listProcedureRequestsForCamundaReconciliation,
  listProcedureRequestsPendingAutoRetry: mocks.listProcedureRequestsPendingAutoRetry,
  releaseExpiredProcedureTaskClaims: mocks.releaseExpiredProcedureTaskClaims,
  markOverdueProceduresAsEscalated: mocks.markOverdueProceduresAsEscalated,
  handleWaitingCitizenInfoTimeouts: mocks.handleWaitingCitizenInfoTimeouts,
  hasProcessedOperation: mocks.hasProcessedOperation,
  markOperationAsProcessed: mocks.markOperationAsProcessed,
  incrementProcedureMetric: mocks.incrementProcedureMetric,
  updateProcedureRequestCamundaData: mocks.updateProcedureRequestCamundaData,
  transitionProcedureRequestStatus: mocks.transitionProcedureRequestStatus,
  addProcedureRequestEvent: mocks.addProcedureRequestEvent,
}));

vi.mock("../../procedureCatalog", () => ({
  getProcedureCatalogEntryById: mocks.getProcedureCatalogEntryById,
}));

vi.mock("../getActiveTaskForProcedure", () => ({
  getActiveTaskForProcedure: mocks.getActiveTaskForProcedure,
}));

vi.mock("../client", () => ({
  getCamundaProcessInstance: mocks.getCamundaProcessInstance,
}));

vi.mock("../../chatSessionStore", () => ({
  CHATBOT_CONVERSATION_STATES: { FLOW_ACTIVE: "flow_active" },
  setConversationState: mocks.setConversationState,
}));

vi.mock("../syncLocalCaseToCamunda", () => ({
  retryProcedureCamundaSync: mocks.retryProcedureCamundaSync,
}));

import { syncProcedureRequestStateFromCamunda } from "../syncProcedureStateFromCamunda";

describe("syncProcedureRequestStateFromCamunda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      procedureTypeId: "proc-1",
      channel: "WHATSAPP",
      whatsappWaId: "598111222333",
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: "12345",
      camundaMetadata: {},
      collectedData: {},
    });
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      flowDefinition: {},
    });
    mocks.getActiveTaskForProcedure.mockResolvedValue(null);
    mocks.getCamundaProcessInstance.mockResolvedValue({ state: "ACTIVE" });
    mocks.hasProcessedOperation.mockResolvedValue(false);
    mocks.markOperationAsProcessed.mockResolvedValue({ ok: true, duplicate: false });
    mocks.incrementProcedureMetric.mockResolvedValue(undefined);
    mocks.releaseExpiredProcedureTaskClaims.mockResolvedValue([]);
    mocks.markOverdueProceduresAsEscalated.mockResolvedValue(0);
    mocks.handleWaitingCitizenInfoTimeouts.mockResolvedValue(0);
    mocks.updateProcedureRequestCamundaData.mockResolvedValue(null);
    mocks.transitionProcedureRequestStatus.mockResolvedValue(null);
    mocks.addProcedureRequestEvent.mockResolvedValue(null);
    mocks.setConversationState.mockResolvedValue(null);
  });

  it("cierra localmente cuando el proceso en Camunda terminó", async () => {
    mocks.getCamundaProcessInstance.mockResolvedValueOnce({ state: "COMPLETED" });
    const out = await syncProcedureRequestStateFromCamunda({ procedureRequestId: "pr-1" });
    expect(out.ok).toBe(true);
    expect(out.processEnded).toBe(true);
    expect(mocks.transitionProcedureRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "CLOSED" })
    );
  });

  it("marca WAITING_CITIZEN_INFO cuando la tarea lo requiere", async () => {
    mocks.getProcedureCatalogEntryById.mockResolvedValueOnce({
      id: "proc-1",
      flowDefinition: {
        citizenInfoTasks: {
          request_citizen_info: {
            fieldKey: "additionalInfo",
            prompt: "Necesitamos un dato adicional.",
          },
        },
      },
    });
    mocks.getActiveTaskForProcedure.mockResolvedValueOnce({
      taskId: "task-1",
      taskDefinitionKey: "request_citizen_info",
      assignee: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const out = await syncProcedureRequestStateFromCamunda({ procedureRequestId: "pr-1" });
    expect(out.ok).toBe(true);
    expect(out.status).toBe("WAITING_CITIZEN_INFO");
    expect(mocks.transitionProcedureRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "WAITING_CITIZEN_INFO" })
    );
  });
});

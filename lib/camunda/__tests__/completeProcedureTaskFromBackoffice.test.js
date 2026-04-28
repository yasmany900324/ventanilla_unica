import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProcedureRequestById: vi.fn(),
  claimProcedureTask: vi.fn(),
  hasProcessedOperation: vi.fn(),
  updateProcedureRequestCamundaData: vi.fn(),
  transitionProcedureRequestStatus: vi.fn(),
  addProcedureRequestEvent: vi.fn(),
  markOperationAsProcessed: vi.fn(),
  incrementProcedureMetric: vi.fn(),
  releaseExpiredProcedureTaskClaims: vi.fn(),
  getCamundaCaseLinkByLocalCase: vi.fn(),
  getActiveTaskForProcedure: vi.fn(),
  buildVariables: vi.fn(),
  completeCamundaUserTask: vi.fn(),
  claimCamundaUserTask: vi.fn(),
  searchCamundaUserTasks: vi.fn(),
  waitForCamundaSnapshotChange: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
}));

vi.mock("../../procedureRequests", () => ({
  PROCEDURE_REQUEST_EVENT_TYPES: {
    BACKOFFICE_TASK_COMPLETED: "BACKOFFICE_TASK_COMPLETED",
    CAMUNDA_SYNC_FAILED: "CAMUNDA_SYNC_FAILED",
    STATUS_CHANGED: "STATUS_CHANGED",
    PROCEDURE_CLOSED: "PROCEDURE_CLOSED",
  },
  PROCEDURE_REQUEST_STATUSES: {
    PENDING_BACKOFFICE_ACTION: "PENDING_BACKOFFICE_ACTION",
    RESOLVED: "RESOLVED",
    CLOSED: "CLOSED",
  },
  getProcedureRequestById: mocks.getProcedureRequestById,
  claimProcedureTask: mocks.claimProcedureTask,
  hasProcessedOperation: mocks.hasProcessedOperation,
  updateProcedureRequestCamundaData: mocks.updateProcedureRequestCamundaData,
  transitionProcedureRequestStatus: mocks.transitionProcedureRequestStatus,
  addProcedureRequestEvent: mocks.addProcedureRequestEvent,
  markOperationAsProcessed: mocks.markOperationAsProcessed,
  incrementProcedureMetric: mocks.incrementProcedureMetric,
  releaseExpiredProcedureTaskClaims: mocks.releaseExpiredProcedureTaskClaims,
}));

vi.mock("../camundaCaseLinks", () => ({
  getCamundaCaseLinkByLocalCase: mocks.getCamundaCaseLinkByLocalCase,
}));

vi.mock("../getActiveTaskForProcedure", () => ({
  getActiveTaskForProcedure: mocks.getActiveTaskForProcedure,
}));

vi.mock("../CamundaVariableMapperService", () => ({
  CamundaVariableMappingValidationError: class CamundaVariableMappingValidationError extends Error {},
  camundaVariableMapper: { buildVariables: mocks.buildVariables },
}));

vi.mock("../client", () => ({
  completeCamundaUserTask: mocks.completeCamundaUserTask,
  claimCamundaUserTask: mocks.claimCamundaUserTask,
  searchCamundaUserTasks: mocks.searchCamundaUserTasks,
}));

vi.mock("../waitForCamundaSnapshotChange", () => ({
  waitForCamundaSnapshotChange: mocks.waitForCamundaSnapshotChange,
}));

vi.mock("../getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

import {
  CompleteProcedureTaskError,
  completeProcedureTaskFromBackoffice,
} from "../completeProcedureTaskFromBackoffice";
import { CamundaVariableMappingValidationError } from "../CamundaVariableMapperService";

describe("completeProcedureTaskFromBackoffice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      procedureTypeId: "proc-1",
      status: "PENDING_BACKOFFICE_ACTION",
      collectedData: {},
      camundaProcessInstanceKey: "12345",
    });
    mocks.getCamundaCaseLinkByLocalCase.mockResolvedValue({
      camundaProcessInstanceKey: "12345",
    });
    mocks.getActiveTaskForProcedure.mockResolvedValue({
      taskId: "task-1",
      taskDefinitionKey: "review_incident",
      name: "Revisar",
      assignee: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.buildVariables.mockResolvedValue({ aprobado: true });
    mocks.completeCamundaUserTask.mockResolvedValue(undefined);
    mocks.claimCamundaUserTask.mockResolvedValue(undefined);
    mocks.searchCamundaUserTasks.mockResolvedValue([]);
    mocks.waitForCamundaSnapshotChange.mockResolvedValue({
      confirmed: true,
      attempts: 1,
      snapshot: {
        process: { state: "ACTIVE", instanceKey: "12345" },
        activeTask: {
          exists: true,
          id: "task-2",
          taskDefinitionKey: "finalizar_tramite",
          assignee: "admin-1",
        },
      },
    });
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { state: "ACTIVE", instanceKey: "12345" },
      activeTask: { exists: true, id: "task-2", taskDefinitionKey: "finalizar_tramite", assignee: "admin-1" },
    });
    mocks.hasProcessedOperation.mockResolvedValue(false);
    mocks.claimProcedureTask.mockResolvedValue({
      ok: true,
      procedureRequest: {
        id: "pr-1",
        taskAssigneeId: "admin-1",
      },
    });
    mocks.updateProcedureRequestCamundaData.mockResolvedValue({
      id: "pr-1",
      status: "CLOSED",
    });
    mocks.transitionProcedureRequestStatus.mockResolvedValue({
      id: "pr-1",
      status: "CLOSED",
    });
    mocks.addProcedureRequestEvent.mockResolvedValue(null);
    mocks.markOperationAsProcessed.mockResolvedValue({ ok: true, duplicate: false });
    mocks.incrementProcedureMetric.mockResolvedValue(undefined);
    mocks.releaseExpiredProcedureTaskClaims.mockResolvedValue([]);
  });

  it("completa tarea con mappings COMPLETE_TASK", async () => {
    const out = await completeProcedureTaskFromBackoffice({
      procedureRequestId: "pr-1",
      collectedData: { backofficeDecision: true },
      actorId: "admin-1",
    });
    expect(out.camunda.taskId).toBe("task-1");
    expect(out.camundaAction).toBe("complete_task");
    expect(out.syncStatus).toBe("confirmed");
    expect(out.previousTaskId).toBe("task-1");
    expect(mocks.buildVariables).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "COMPLETE_TASK",
        taskDefinitionKey: "review_incident",
        requireMappings: true,
      })
    );
    expect(mocks.completeCamundaUserTask).toHaveBeenCalledWith("task-1", { aprobado: true });
    expect(mocks.claimProcedureTask).toHaveBeenCalledWith(
      expect.objectContaining({
        procedureRequestId: "pr-1",
        actorId: "admin-1",
      })
    );
  });

  it("rechaza completar tarea cuando faltan variables requeridas", async () => {
    mocks.buildVariables.mockRejectedValueOnce(new CamundaVariableMappingValidationError("missing", {}));
    await expect(
      completeProcedureTaskFromBackoffice({
        procedureRequestId: "pr-1",
        collectedData: {},
      })
    ).rejects.toBeInstanceOf(CompleteProcedureTaskError);
  });

  it("usa formValues como fuente principal de variables Camunda", async () => {
    await completeProcedureTaskFromBackoffice({
      procedureRequestId: "pr-1",
      actorId: "admin-1",
      formValues: {
        requiereIntervencion: true,
        observacionResolucion: "ok",
      },
      internalObservation: "Solo auditoría local",
    });
    expect(mocks.buildVariables).not.toHaveBeenCalled();
    expect(mocks.completeCamundaUserTask).toHaveBeenCalledWith("task-1", {
      requiereIntervencion: true,
      observacionResolucion: "ok",
    });
  });

  it("no inyecta __internalObservation como variable Camunda en flujo normal", async () => {
    await completeProcedureTaskFromBackoffice({
      procedureRequestId: "pr-1",
      actorId: "admin-1",
      formValues: { aprobado: true },
      internalObservation: "observación local",
    });
    const [, variables] = mocks.completeCamundaUserTask.mock.calls[0];
    expect(variables.__internalObservation).toBeUndefined();
  });

  it("retorna syncStatus pending si vence la espera de snapshot", async () => {
    mocks.waitForCamundaSnapshotChange.mockResolvedValueOnce({
      confirmed: false,
      attempts: 10,
      snapshot: {
        process: { state: "ACTIVE", instanceKey: "12345" },
        activeTask: { exists: true, id: "task-1", taskDefinitionKey: "review_incident", assignee: "admin-1" },
      },
    });

    const out = await completeProcedureTaskFromBackoffice({
      procedureRequestId: "pr-1",
      actorId: "admin-1",
      formValues: { aprobado: true },
    });

    expect(out.syncStatus).toBe("pending");
    expect(out.camundaAction).toBe("complete_task");
    expect(out.previousTaskId).toBe("task-1");
  });
});

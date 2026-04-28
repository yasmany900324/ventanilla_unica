import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getProcedureRequestById: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  waitForCamundaSnapshotChange: vi.fn(),
  claimCamundaUserTask: vi.fn(),
}));

vi.mock("../../../../../../../lib/auth", () => ({
  requireFuncionario: mocks.requireFuncionario,
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
}));

vi.mock("../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

vi.mock("../../../../../../../lib/camunda/waitForCamundaSnapshotChange", () => ({
  waitForCamundaSnapshotChange: mocks.waitForCamundaSnapshotChange,
}));

vi.mock("../../../../../../../lib/camunda/client", async () => {
  const actual = await vi.importActual("../../../../../../../lib/camunda/client");
  return {
    ...actual,
    claimCamundaUserTask: mocks.claimCamundaUserTask,
  };
});

import { POST } from "./route";

describe("api/funcionario/procedures/requests/[id]/claim-camunda-task POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFuncionario.mockResolvedValue({ id: "func-1", role: "agente" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      assignedToUserId: "func-1",
      camundaProcessInstanceKey: "2251799813704048",
    });
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251799813704048", state: "ACTIVE" },
      activeTask: {
        exists: true,
        id: "2251799813704056",
        userTaskKey: "2251799813704056",
        taskDefinitionKey: "Activity_0g0id0y",
        assignee: null,
      },
      availableActions: [
        { action: "CLAIM_TASK", enabled: true, reason: null },
        { action: "COMPLETE_TASK", enabled: true, reason: null },
      ],
    });
    mocks.claimCamundaUserTask.mockResolvedValue(undefined);
    mocks.waitForCamundaSnapshotChange.mockResolvedValue({
      confirmed: true,
      attempts: 1,
      snapshot: {
        process: { instanceKey: "2251799813704048", state: "ACTIVE" },
        activeTask: {
          exists: true,
          id: "2251799813704056",
          userTaskKey: "2251799813704056",
          taskDefinitionKey: "Activity_0g0id0y",
          assignee: "func-1",
        },
        availableActions: [{ action: "COMPLETE_TASK", enabled: true, reason: null }],
      },
    });
  });

  it("reclama en Camunda y no usa claim local de expediente", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValueOnce({
      process: { instanceKey: "2251799813704048", state: "ACTIVE" },
      activeTask: {
        exists: true,
        id: "2251799813704056",
        userTaskKey: "2251799813704056",
        taskDefinitionKey: "Activity_0g0id0y",
        assignee: null,
      },
      availableActions: [],
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.camundaAction).toBe("claim_task");
    expect(body.syncStatus).toBe("confirmed");
    expect(mocks.claimCamundaUserTask).toHaveBeenCalledWith("2251799813704056", "func-1");
    expect(mocks.waitForCamundaSnapshotChange).toHaveBeenCalledTimes(1);
    expect(body.snapshot?.activeTask?.assignee).toBe("func-1");
    expect(body.snapshot?.availableActions?.find((a) => a.action === "COMPLETE_TASK")?.enabled).toBe(true);
  });

  it("retorna syncStatus pending cuando Camunda tarda en reflejar snapshot", async () => {
    mocks.getLiveCamundaTaskSnapshot
      .mockResolvedValueOnce({
        process: { instanceKey: "2251799813704048", state: "ACTIVE" },
        activeTask: {
          exists: true,
          id: "2251799813704056",
          userTaskKey: "2251799813704056",
          taskDefinitionKey: "Activity_0g0id0y",
          assignee: null,
        },
        availableActions: [],
      })
      .mockResolvedValueOnce({
        process: { instanceKey: "2251799813704048", state: "ACTIVE" },
        activeTask: {
          exists: true,
          id: "2251799813704056",
          userTaskKey: "2251799813704056",
          taskDefinitionKey: "Activity_0g0id0y",
          assignee: null,
        },
        availableActions: [{ action: "COMPLETE_TASK", enabled: false, reason: "TASK_ALREADY_ASSIGNED" }],
      });
    mocks.waitForCamundaSnapshotChange.mockResolvedValueOnce({
      confirmed: false,
      attempts: 10,
      snapshot: null,
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.syncStatus).toBe("pending");
    expect(body.camundaAction).toBe("claim_task");
  });

  it("si no está asignado localmente al funcionario, devuelve error funcional", async () => {
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      assignedToUserId: "func-2",
      camundaProcessInstanceKey: "2251799813704048",
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(String(body.error || "").toLowerCase()).toContain("tomar el expediente");
    expect(mocks.claimCamundaUserTask).not.toHaveBeenCalled();
  });

  it("si no hay tarea activa, devuelve error funcional", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251799813704048", state: "ACTIVE" },
      activeTask: { exists: false, id: null, assignee: null },
      availableActions: [],
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(String(body.error || "").toLowerCase()).toContain("no hay tarea activa");
    expect(mocks.claimCamundaUserTask).not.toHaveBeenCalled();
  });

  it("si la tarea ya está asignada a otro, devuelve conflicto", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251799813704048", state: "ACTIVE" },
      activeTask: {
        exists: true,
        id: "2251799813704056",
        userTaskKey: "2251799813704056",
        taskDefinitionKey: "Activity_0g0id0y",
        assignee: "func-2",
      },
      availableActions: [],
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(String(body.error || "").toLowerCase()).toContain("otro funcionario");
    expect(mocks.claimCamundaUserTask).not.toHaveBeenCalled();
  });
});

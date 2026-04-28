import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getProcedureRequestById: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
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
  });

  it("reclama en Camunda y no usa claim local de expediente", async () => {
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
          assignee: "func-1",
        },
        availableActions: [{ action: "COMPLETE_TASK", enabled: true, reason: null }],
      });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-camunda-task"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.claimCamundaUserTask).toHaveBeenCalledWith("2251799813704056", "func-1");
    expect(mocks.getLiveCamundaTaskSnapshot).toHaveBeenCalledTimes(2);
    expect(body.snapshot?.activeTask?.assignee).toBe("func-1");
    expect(body.snapshot?.availableActions?.find((a) => a.action === "COMPLETE_TASK")?.enabled).toBe(true);
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

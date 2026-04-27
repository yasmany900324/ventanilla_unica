import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  getAppRouteParamString: vi.fn(),
  claimProcedureRequestForFuncionarioInbox: vi.fn(),
  getProcedureRequestById: vi.fn(),
}));

vi.mock("../../../../../../../lib/auth", () => ({
  requireFuncionario: mocks.requireFuncionario,
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/procedureRequests", () => ({
  claimProcedureRequestForFuncionarioInbox: mocks.claimProcedureRequestForFuncionarioInbox,
  getProcedureRequestById: mocks.getProcedureRequestById,
}));

import { POST } from "./route";

describe("api/funcionario/procedures/requests/[id]/claim-task POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFuncionario.mockResolvedValue({ id: "func-1", role: "agente" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({ id: "pr-1" });
  });

  it("cuando no tiene owner local responde ok y retorna expediente asignado", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: true,
      idempotent: false,
      procedureRequest: {
        id: "pr-1",
        assignedToUserId: "func-1",
        inboxOwnerAssignedAt: "2026-04-27T19:00:00.000Z",
        taskAssigneeId: null,
      },
    });

    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.procedureRequest).toEqual(
      expect.objectContaining({
        id: "pr-1",
        assignedToUserId: "func-1",
      })
    );
    expect(mocks.claimProcedureRequestForFuncionarioInbox).toHaveBeenCalledWith({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-1",
    });
  });

  it("si el mismo funcionario vuelve a llamar responde idempotente", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: true,
      idempotent: true,
      procedureRequest: {
        id: "pr-1",
        assignedToUserId: "func-1",
        taskAssigneeId: "camunda-task-assignee-99",
      },
    });

    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(true);
    expect(body.message).toMatch(/ya estaba asignado/i);
  });

  it("si otro funcionario intenta tomarlo responde conflicto funcional", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: false,
      status: 409,
      reason: "assigned_to_other",
    });

    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(String(body.error || "").toLowerCase()).toContain("otro funcionario");
  });

  it("el response no depende de task_assignee_id para informar claim local", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: true,
      idempotent: false,
      procedureRequest: {
        id: "pr-1",
        assignedToUserId: "func-1",
        taskAssigneeId: "camunda-task-assignee-42",
      },
    });

    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.procedureRequest.assignedToUserId).toBe("func-1");
    expect(body.procedureRequest.taskAssigneeId).toBe("camunda-task-assignee-42");
  });

  it("el endpoint no escribe task_assignee_id: delega solo al claim local", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: true,
      idempotent: false,
      procedureRequest: {
        id: "pr-1",
        assignedToUserId: "func-1",
        taskAssigneeId: "camunda-assignee-unchanged",
      },
    });

    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.claimProcedureRequestForFuncionarioInbox).toHaveBeenCalledTimes(1);
    expect(body.procedureRequest.taskAssigneeId).toBe("camunda-assignee-unchanged");
  });
});

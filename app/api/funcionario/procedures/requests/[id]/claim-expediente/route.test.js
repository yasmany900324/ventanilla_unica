import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  getAppRouteParamString: vi.fn(),
  claimProcedureRequestForFuncionarioInbox: vi.fn(),
  getProcedureRequestById: vi.fn(),
  claimCamundaUserTask: vi.fn(),
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

vi.mock("../../../../../../../lib/camunda/client", () => ({
  claimCamundaUserTask: mocks.claimCamundaUserTask,
}));

import { POST } from "./route";

describe("api/funcionario/procedures/requests/[id]/claim-expediente POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFuncionario.mockResolvedValue({ id: "func-1", role: "agente" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({ id: "pr-1" });
  });

  it("toma expediente local y no toca Camunda", async () => {
    mocks.claimProcedureRequestForFuncionarioInbox.mockResolvedValue({
      ok: true,
      idempotent: false,
      procedureRequest: {
        id: "pr-1",
        assignedToUserId: "func-1",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-expediente"),
      { params: Promise.resolve({ id: "pr-1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.claimProcedureRequestForFuncionarioInbox).toHaveBeenCalledTimes(1);
    expect(mocks.claimCamundaUserTask).not.toHaveBeenCalled();
  });
});

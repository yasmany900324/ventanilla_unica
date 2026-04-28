import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  releaseExpiredProcedureTaskClaims: vi.fn(),
  listProcedureRequestsForFuncionarioInbox: vi.fn(),
  enrichProcedureRequestsForInbox: vi.fn(),
}));

vi.mock("../../../../../lib/auth", () => ({
  requireFuncionario: mocks.requireFuncionario,
}));

vi.mock("../../../../../lib/procedureRequests", () => ({
  releaseExpiredProcedureTaskClaims: mocks.releaseExpiredProcedureTaskClaims,
  listProcedureRequestsForFuncionarioInbox: mocks.listProcedureRequestsForFuncionarioInbox,
}));

vi.mock("../../../../../lib/procedureRequestInboxListHelpers", () => ({
  enrichProcedureRequestsForInbox: mocks.enrichProcedureRequestsForInbox,
}));

import { GET } from "./route";

describe("api/funcionario/procedures/requests GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFuncionario.mockResolvedValue({ id: "func-1", role: "funcionario" });
    mocks.releaseExpiredProcedureTaskClaims.mockResolvedValue(undefined);
    mocks.listProcedureRequestsForFuncionarioInbox.mockResolvedValue([]);
    mocks.enrichProcedureRequestsForInbox.mockResolvedValue([]);
  });

  it("scope Todos incluye disponibles y asignados a mí", async () => {
    const available = {
      id: "pr-wa-1",
      channel: "WHATSAPP",
      requestCode: "TRA-205217E1",
      assignmentScope: "available",
      assignedToUserId: null,
      isAvailableToClaim: true,
    };
    const assigned = {
      id: "pr-web-2",
      channel: "WEB",
      requestCode: "TRA-205217E2",
      assignmentScope: "assigned_to_me",
      assignedToUserId: "func-1",
      isAvailableToClaim: false,
    };
    mocks.listProcedureRequestsForFuncionarioInbox.mockResolvedValueOnce([available, assigned]);
    mocks.enrichProcedureRequestsForInbox.mockResolvedValueOnce([available, assigned]);

    const response = await GET(new Request("http://localhost/api/funcionario/procedures/requests?limit=200"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(body.procedures)).toBe(true);
    expect(body.procedures).toHaveLength(2);
    expect(body.procedures.map((item) => item.assignmentScope)).toEqual([
      "available",
      "assigned_to_me",
    ]);
    expect(body.procedures[0]).toEqual(
      expect.objectContaining({
        id: "pr-wa-1",
        procedureRequestId: "pr-wa-1",
        trackingNumber: "TRA-205217E1",
      })
    );
    expect(body.procedures[1]).toEqual(
      expect.objectContaining({
        id: "pr-web-2",
        procedureRequestId: "pr-web-2",
        trackingNumber: "TRA-205217E2",
      })
    );
  });
});

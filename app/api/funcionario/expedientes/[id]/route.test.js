import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBackofficeUser: vi.fn(),
  userHasRole: vi.fn(),
  getProcedureRequestById: vi.fn(),
  canAccessProcedureRequestStrict: vi.fn(),
  deleteProcedureRequestSafely: vi.fn(),
}));

vi.mock("../../../../../lib/auth", () => ({
  requireBackofficeUser: mocks.requireBackofficeUser,
  userHasRole: mocks.userHasRole,
}));

vi.mock("../../../../../lib/roles", () => ({
  ROLES: {
    ADMIN: "administrador",
  },
}));

vi.mock("../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: async (params, key) => {
    const resolved = await params;
    return String(resolved?.[key] || "");
  },
}));

vi.mock("../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
}));

vi.mock("../../../../../lib/procedureRequestInboxDetail", () => ({
  canAccessProcedureRequestStrict: mocks.canAccessProcedureRequestStrict,
}));

vi.mock("../../../../../lib/camunda/deleteProcedureRequestSafely", () => ({
  deleteProcedureRequestSafely: mocks.deleteProcedureRequestSafely,
}));

import { DELETE } from "./route";

describe("DELETE /api/funcionario/expedientes/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBackofficeUser.mockResolvedValue({ id: "ag-1", role: "agente", roles: ["agente"] });
    mocks.userHasRole.mockReturnValue(false);
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      requestCode: "TRA-12345678",
      taskAssigneeId: "ag-1",
    });
    mocks.canAccessProcedureRequestStrict.mockReturnValue(true);
    mocks.deleteProcedureRequestSafely.mockResolvedValue({ ok: true, deleted: true });
  });

  it("bloquea usuario sin sesión", async () => {
    mocks.requireBackofficeUser.mockResolvedValueOnce(null);
    const response = await DELETE(new Request("http://localhost/api/funcionario/expedientes/pr-1"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
  });

  it("usuario sin permiso no puede eliminar", async () => {
    mocks.canAccessProcedureRequestStrict.mockReturnValueOnce(false);
    const response = await DELETE(new Request("http://localhost/api/funcionario/expedientes/pr-1"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.deleteProcedureRequestSafely).not.toHaveBeenCalled();
  });

  it("responde conflicto cuando falla eliminación Camunda", async () => {
    mocks.deleteProcedureRequestSafely.mockResolvedValueOnce({
      ok: false,
      reason: "camunda_delete_failed",
      processInstanceKey: "2251",
      error: "timeout",
    });
    const response = await DELETE(new Request("http://localhost/api/funcionario/expedientes/pr-1"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatch(/Camunda/i);
  });

  it("retorna éxito cuando el expediente ya no existe", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce(null);
    const response = await DELETE(new Request("http://localhost/api/funcionario/expedientes/pr-1"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.alreadyDeleted).toBe(true);
  });
});

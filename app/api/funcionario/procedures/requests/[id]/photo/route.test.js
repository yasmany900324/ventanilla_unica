import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBackofficeUser: vi.fn(),
  userHasRole: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getProcedureRequestById: vi.fn(),
  resolveFuncionarioAssignmentScopeForProcedureRequest: vi.fn(),
  extractDraftAttachmentRefFromCollectedData: vi.fn(),
  getIncidentAttachmentStorageByProvider: vi.fn(),
}));

vi.mock("../../../../../../../lib/auth", () => ({
  requireBackofficeUser: mocks.requireBackofficeUser,
  userHasRole: mocks.userHasRole,
}));

vi.mock("../../../../../../../lib/roles", () => ({
  ROLES: { ADMIN: "administrador" },
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
  resolveFuncionarioAssignmentScopeForProcedureRequest:
    mocks.resolveFuncionarioAssignmentScopeForProcedureRequest,
}));

vi.mock("../../../../../../../lib/attachments/draftAttachmentRef", () => ({
  extractDraftAttachmentRefFromCollectedData: mocks.extractDraftAttachmentRefFromCollectedData,
}));

vi.mock("../../../../../../../lib/attachments/getIncidentAttachmentStorage", () => ({
  getIncidentAttachmentStorageByProvider: mocks.getIncidentAttachmentStorageByProvider,
}));

import { GET } from "./route";

describe("GET /api/funcionario/procedures/requests/[id]/photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBackofficeUser.mockResolvedValue({ id: "func-1", roles: ["agente"] });
    mocks.userHasRole.mockReturnValue(false);
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      collectedData: { photoStatus: "provided" },
    });
    mocks.resolveFuncionarioAssignmentScopeForProcedureRequest.mockResolvedValue("assigned_to_me");
    mocks.extractDraftAttachmentRefFromCollectedData.mockReturnValue({
      storageProvider: "vercel_blob",
      storageKey: "incident-attachments/draft/sess/img.jpg",
      mimeType: "image/jpeg",
    });
    mocks.getIncidentAttachmentStorageByProvider.mockReturnValue({
      readDraftAttachmentBytes: vi.fn().mockResolvedValue({
        buffer: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg",
      }),
    });
  });

  it("retorna 403 sin usuario backoffice", async () => {
    mocks.requireBackofficeUser.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/photo"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
  });

  it("retorna 403 sin scope de asignación", async () => {
    mocks.resolveFuncionarioAssignmentScopeForProcedureRequest.mockResolvedValueOnce(null);
    const response = await GET(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/photo"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
  });
});

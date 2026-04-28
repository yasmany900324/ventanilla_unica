import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getProcedureRequestById: vi.fn(),
  extractDraftAttachmentRefFromCollectedData: vi.fn(),
  getIncidentAttachmentStorageByProvider: vi.fn(),
}));

vi.mock("../../../../../../../lib/auth", () => ({
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
}));

vi.mock("../../../../../../../lib/attachments/draftAttachmentRef", () => ({
  extractDraftAttachmentRefFromCollectedData: mocks.extractDraftAttachmentRefFromCollectedData,
}));

vi.mock("../../../../../../../lib/attachments/getIncidentAttachmentStorage", () => ({
  getIncidentAttachmentStorageByProvider: mocks.getIncidentAttachmentStorageByProvider,
}));

import { GET } from "./route";

describe("GET /api/ciudadano/procedures/requests/[id]/photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticatedUser.mockResolvedValue({ id: "cit-1" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      userId: "cit-1",
      collectedData: { photoStatus: "provided" },
    });
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

  it("retorna 200 cuando el expediente pertenece al ciudadano", async () => {
    const response = await GET(new Request("http://localhost/api/ciudadano/procedures/requests/pr-1/photo"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("retorna 403 cuando el expediente no pertenece al ciudadano", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce({
      id: "pr-1",
      userId: "other-user",
      collectedData: { photoStatus: "provided" },
    });
    const response = await GET(new Request("http://localhost/api/ciudadano/procedures/requests/pr-1/photo"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(403);
  });

  it("retorna 404 cuando no hay referencia de imagen", async () => {
    mocks.extractDraftAttachmentRefFromCollectedData.mockReturnValueOnce(null);
    const response = await GET(new Request("http://localhost/api/ciudadano/procedures/requests/pr-1/photo"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    expect(response.status).toBe(404);
  });
});

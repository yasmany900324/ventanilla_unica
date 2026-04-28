import { afterEach, describe, expect, it, vi } from "vitest";
import { registerProcedureImageAttachment } from "../registerProcedureImageAttachment";

const uploadDraftAttachmentMock = vi.fn();

vi.mock("../attachments/getIncidentAttachmentStorage", () => ({
  getIncidentAttachmentStorage: () => ({
    uploadDraftAttachment: uploadDraftAttachmentMock,
  }),
}));

describe("registerProcedureImageAttachment", () => {
  afterEach(() => {
    uploadDraftAttachmentMock.mockReset();
  });

  it("devuelve contrato único seguro sin bytes/base64", async () => {
    uploadDraftAttachmentMock.mockResolvedValue({
      ok: true,
      storageProvider: "vercel_blob",
      storageKey: "incident-attachments/draft/session-x/abc.jpg",
      publicUrl: "https://cdn.example.org/final/abc.jpg",
      sizeBytes: 2048,
    });

    const out = await registerProcedureImageAttachment({
      sourceChannel: "whatsapp",
      sessionId: "sess-123",
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      originalName: "foto.jpg",
    });

    expect(out.ok).toBe(true);
    expect(out.attachmentData).toEqual(
      expect.objectContaining({
        photoStatus: "provided",
        photoAttachmentStorageProvider: "vercel_blob",
        photoAttachmentStorageKey: "incident-attachments/draft/session-x/abc.jpg",
        photoAttachmentPublicUrl: "https://cdn.example.org/final/abc.jpg",
        photoAttachmentOriginalName: "foto.jpg",
        photoAttachmentContentType: "image/jpeg",
        photoAttachmentMimeType: "image/jpeg",
        photoAttachmentSizeBytes: 2048,
      })
    );
    expect(Object.keys(out.attachmentData)).not.toContain("bytes");
    expect(JSON.stringify(out.attachmentData)).not.toContain("base64");
  });

  it("descarta publicUrl con token sensible", async () => {
    uploadDraftAttachmentMock.mockResolvedValue({
      ok: true,
      storageProvider: "vercel_blob",
      storageKey: "incident-attachments/draft/session-x/abc.jpg",
      publicUrl: "https://graph.facebook.com/v21.0/123?access_token=secret",
      sizeBytes: 2048,
    });

    const out = await registerProcedureImageAttachment({
      sourceChannel: "web",
      sessionId: "sess-124",
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
      originalName: "foto.jpg",
    });

    expect(out.ok).toBe(true);
    expect(out.attachmentData.photoAttachmentPublicUrl).toBe("");
  });
});

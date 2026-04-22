import { describe, it, expect } from "vitest";
import { extractDraftAttachmentRefFromCollectedData } from "../draftAttachmentRef";
import { ATTACHMENT_PROVIDER_LOCAL_FS, ATTACHMENT_PROVIDER_VERCEL_BLOB } from "../incidentAttachmentTypes";

describe("extractDraftAttachmentRefFromCollectedData", () => {
  it("devuelve null si no hay foto proporcionada", () => {
    expect(
      extractDraftAttachmentRefFromCollectedData({
        photoStatus: "skipped",
        photoAttachmentStorageKey: "x/y/z.jpg",
      })
    ).toBeNull();
  });

  it("infiere local_fs para claves estilo basename UUID", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000.jpg";
    const ref = extractDraftAttachmentRefFromCollectedData({
      photoStatus: "provided",
      photoAttachmentStorageKey: key,
      photoAttachmentMimeType: "image/jpeg",
      photoAttachmentSizeBytes: 12,
    });
    expect(ref?.storageProvider).toBe(ATTACHMENT_PROVIDER_LOCAL_FS);
    expect(ref?.storageKey).toBe(key);
  });

  it("infiere vercel_blob para pathname con slash", () => {
    const key = "incident-attachments/draft/sess/abc.jpg";
    const ref = extractDraftAttachmentRefFromCollectedData({
      photoStatus: "provided",
      photoAttachmentStorageKey: key,
      photoAttachmentMimeType: "image/jpeg",
    });
    expect(ref?.storageProvider).toBe(ATTACHMENT_PROVIDER_VERCEL_BLOB);
    expect(ref?.storageKey).toBe(key);
  });
});

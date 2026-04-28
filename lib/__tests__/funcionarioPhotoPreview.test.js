import { describe, expect, it } from "vitest";
import {
  buildCitizenProcedurePhotoPreviewUrl,
  buildProcedurePhotoPreviewUrl,
} from "../funcionarioPhotoPreview";

describe("buildProcedurePhotoPreviewUrl", () => {
  it("usa endpoint interno /photo cuando hay storageKey y photoStatus=provided", () => {
    const out = buildProcedurePhotoPreviewUrl("req-123", {
      photoStatus: "provided",
      photoAttachmentStorageKey: "incident-attachments/draft/session-1/abc123.jpg",
    });
    expect(out).toBe("/api/funcionario/procedures/requests/req-123/photo");
  });

  it("prioriza publicUrl segura y evita URL con token", () => {
    const safe = buildProcedurePhotoPreviewUrl("req-123", {
      photoStatus: "provided",
      photoAttachmentStorageKey: "incident-attachments/draft/session-1/abc123.jpg",
      photoAttachmentPublicUrl: "https://cdn.example.org/final/abc123.jpg",
    });
    expect(safe).toBe("https://cdn.example.org/final/abc123.jpg");

    const unsafe = buildProcedurePhotoPreviewUrl("req-123", {
      photoStatus: "provided",
      photoAttachmentStorageKey: "incident-attachments/draft/session-1/abc123.jpg",
      photoAttachmentPublicUrl: "https://graph.facebook.com/media?access_token=secret",
    });
    expect(unsafe).toBe("/api/funcionario/procedures/requests/req-123/photo");
  });

  it("ciudadano usa endpoint autenticado cuando hay storageKey", () => {
    const out = buildCitizenProcedurePhotoPreviewUrl("req-123", {
      photoStatus: "provided",
      photoAttachmentStorageKey: "incident-attachments/draft/session-1/abc123.jpg",
    });
    expect(out).toBe("/api/ciudadano/procedures/requests/req-123/photo");
  });

  it("no genera preview si falta referencia válida", () => {
    const out = buildProcedurePhotoPreviewUrl("req-123", {
      photoStatus: "provided",
    });
    expect(out).toBe("");
  });
});

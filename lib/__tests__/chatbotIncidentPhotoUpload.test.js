import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATBOT_CONVERSATION_STATES,
  setConversationState,
} from "../chatSessionStore";
import { persistProcedurePhotoForChatSession } from "../chatbotIncidentPhotoUpload";

const mocks = vi.hoisted(() => ({
  registerProcedureImageAttachment: vi.fn(),
}));

vi.mock("../registerProcedureImageAttachment", () => ({
  registerProcedureImageAttachment: mocks.registerProcedureImageAttachment,
}));

describe("persistProcedurePhotoForChatSession", () => {
  afterEach(() => {
    mocks.registerProcedureImageAttachment.mockReset();
  });

  it("no salta a confirmacion si falta ubicacion requerida", async () => {
    const sessionId = `test-photo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: "59811222333",
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "photo",
      confirmationState: "none",
      collectedData: {
        description: "Hay un problema en la via publica",
        procedureCode: "registrar_incidencia",
        procedureName: "Registrar incidencia",
        procedureCategory: "incidencias",
        procedureFieldDefinitions: [
          { key: "description", label: "Descripcion", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
          { key: "location", label: "Ubicacion", type: "location", required: true, order: 3 },
        ],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_photo",
      lastConfidence: null,
    });

    mocks.registerProcedureImageAttachment.mockResolvedValue({
      ok: true,
      storage: { deleteDraftAttachment: vi.fn() },
      uploadResult: {
        storageProvider: "local_fs",
        storageKey: "draft/test-photo.jpg",
        publicUrl: "https://files.example.test/draft/test-photo.jpg",
        sizeBytes: 128,
      },
      attachmentData: {
        photoStatus: "provided",
        photoAttachmentStorageProvider: "local_fs",
        photoAttachmentStorageKey: "draft/test-photo.jpg",
        photoAttachmentPublicUrl: "https://files.example.test/draft/test-photo.jpg",
        photoAttachmentSizeBytes: 128,
        photoAttachmentOriginalName: "foto.jpg",
        photoAttachmentStoredFilename: "test-photo.jpg",
        photoAttachmentContentType: "image/jpeg",
        photoAttachmentMimeType: "image/jpeg",
      },
      canonicalImage: {
        filename: "foto.jpg",
        url: "https://files.example.test/draft/test-photo.jpg",
        mimeType: "image/jpeg",
        size: 128,
      },
    });

    const out = await persistProcedurePhotoForChatSession({
      sessionId,
      userId: null,
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      originalName: "foto.jpg",
      preferredLocale: "es",
      origin: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(out.snapshot?.currentStep).toBe("location");
    expect(out.snapshot?.collectedData?.photo).toEqual(
      expect.objectContaining({
        filename: "foto.jpg",
        url: "https://files.example.test/draft/test-photo.jpg",
      })
    );
    expect(out.body?.nextStep?.type).toBe("ask_field");
    expect(out.body?.nextStep?.field).toBe("location");
    expect(mocks.registerProcedureImageAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannel: "whatsapp",
        sessionId,
      })
    );
    expect(String(out.body?.replyText || "")).toContain(
      "Indícame Ubicación. Podés enviarla desde el clip (📎) o escribir una dirección o referencia."
    );
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("resumen del trámite");
  });

  it("en flujo web usa el servicio común con sourceChannel=web", async () => {
    const sessionId = `test-photo-web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await setConversationState(sessionId, {
      locale: "es",
      userId: "cit-1",
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "photo",
      confirmationState: "none",
      collectedData: {
        description: "Hay un problema en la via publica",
        procedureCode: "registrar_incidencia",
        procedureName: "Registrar incidencia",
        procedureCategory: "incidencias",
        procedureFieldDefinitions: [
          { key: "description", label: "Descripcion", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
        ],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_photo",
      lastConfidence: null,
    });

    mocks.registerProcedureImageAttachment.mockResolvedValue({
      ok: true,
      storage: { deleteDraftAttachment: vi.fn() },
      uploadResult: {
        storageProvider: "vercel_blob",
        storageKey: "incident-attachments/draft/sess/web.jpg",
        publicUrl: "https://cdn.example.org/web.jpg",
        sizeBytes: 100,
      },
      attachmentData: {
        photoStatus: "provided",
        photoAttachmentStorageProvider: "vercel_blob",
        photoAttachmentStorageKey: "incident-attachments/draft/sess/web.jpg",
        photoAttachmentPublicUrl: "https://cdn.example.org/web.jpg",
        photoAttachmentSizeBytes: 100,
        photoAttachmentOriginalName: "web.jpg",
        photoAttachmentStoredFilename: "web.jpg",
        photoAttachmentContentType: "image/jpeg",
        photoAttachmentMimeType: "image/jpeg",
      },
      canonicalImage: { filename: "web.jpg", url: "https://cdn.example.org/web.jpg" },
    });

    const out = await persistProcedurePhotoForChatSession({
      sessionId,
      userId: "cit-1",
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      originalName: "web.jpg",
      preferredLocale: "es",
      origin: null,
    });

    expect(out.status).toBe(200);
    expect(mocks.registerProcedureImageAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceChannel: "web",
        sessionId,
      })
    );
  });
});

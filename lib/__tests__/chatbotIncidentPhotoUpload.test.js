import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHATBOT_CONVERSATION_STATES,
  setConversationState,
} from "../chatSessionStore";
import { persistProcedurePhotoForChatSession } from "../chatbotIncidentPhotoUpload";

const uploadDraftAttachmentMock = vi.fn();

vi.mock("../attachments/getIncidentAttachmentStorage", () => ({
  getIncidentAttachmentStorage: () => ({
    uploadDraftAttachment: uploadDraftAttachmentMock,
    deleteDraftAttachment: vi.fn(),
  }),
}));

describe("persistProcedurePhotoForChatSession", () => {
  afterEach(() => {
    uploadDraftAttachmentMock.mockReset();
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

    uploadDraftAttachmentMock.mockResolvedValue({
      ok: true,
      storageProvider: "local_fs",
      storageKey: "draft/test-photo.jpg",
      publicUrl: "https://files.example.test/draft/test-photo.jpg",
      sizeBytes: 128,
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
    expect(String(out.body?.replyText || "")).toContain("Ahora enviame la ubicación del problema.");
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("resumen del trámite");
  });
});

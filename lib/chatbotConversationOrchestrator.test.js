import { describe, expect, it } from "vitest";
import { CHATBOT_CURRENT_STEPS } from "./chatSessionStore";
import {
  buildIncidentConfirmationIntroReply,
  buildQuestionForStep,
  mergeCollectedDataFromInterpretation,
  parseUserCommandFromText,
} from "./chatbotConversationOrchestrator";

describe("parseUserCommandFromText (foto / sin regresión web vía mismo parser)", () => {
  it("interpreta «sin foto» como omitir", () => {
    expect(parseUserCommandFromText("sin foto")).toEqual({
      command: "skip_photo",
      commandField: null,
    });
  });

  it("interpreta «omitir foto» como omitir", () => {
    expect(parseUserCommandFromText("omitir foto")).toEqual({
      command: "skip_photo",
      commandField: null,
    });
  });
});

describe("buildQuestionForStep — copys por canal (web intacto)", () => {
  it("en web el paso foto sigue mencionando acciones de UI", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO, channel: "web" });
    expect(q).toContain("Omitir foto");
    expect(q).toMatch(/tocá/i);
  });

  it("en WhatsApp el paso foto no usa «tocá» ni botones", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO, channel: "whatsapp" });
    expect(q).not.toMatch(/tocá/i);
    expect(q).toContain("sin foto");
  });

  it("por defecto se comporta como web (backward compatible)", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO });
    expect(q).toContain("Omitir foto");
  });
});

describe("buildIncidentConfirmationIntroReply — web vs WhatsApp", () => {
  it("sin opciones devuelve solo la línea intro (comportamiento web histórico)", () => {
    const intro = buildIncidentConfirmationIntroReply("es");
    expect(intro).toBe("Perfecto. Revisá el resumen antes de confirmar la incidencia.");
    expect(intro).not.toContain("Resumen del reporte");
  });

  it("con channel whatsapp incluye resumen en texto plano", () => {
    const intro = buildIncidentConfirmationIntroReply("es", {
      channel: "whatsapp",
      collectedData: {
        category: "incidencia_general",
        subcategory: "reporte_general",
        location: "18 de Julio y Ejido",
        description: "Bache grande",
        risk: "alto",
        photoStatus: "skipped",
      },
    });
    expect(intro).toContain("Resumen del reporte");
    expect(intro).toContain("18 de Julio");
    expect(intro).toContain("sin foto adjunta");
  });
});

describe("mergeCollectedDataFromInterpretation — preserva adjuntos y meta de ubicación", () => {
  it("no pierde campos de foto ni coordenadas al fusionar un turno de descripción", () => {
    const collectedData = {
      category: "incidencia_general",
      subcategory: "x",
      location: "Calle 1",
      description: "",
      risk: "",
      photoStatus: "pending_upload",
      photoAttachmentStorageProvider: "vercel_blob",
      photoAttachmentStorageKey: "draft/key",
      photoAttachmentPublicUrl: "https://example.com/x",
      photoAttachmentSizeBytes: 100,
      photoAttachmentOriginalName: "a.jpg",
      photoAttachmentStoredFilename: "a.jpg",
      photoAttachmentMimeType: "image/jpeg",
      photoAttachmentUploadedAt: "2026-01-01T00:00:00.000Z",
      photoWhatsappMediaId: "wamid-media",
      photoAttachmentChannel: "whatsapp",
      photoDownloadStatus: "ok",
      locationLatitude: -34.9,
      locationLongitude: -56.2,
      locationAddressText: "Plaza",
      locationSource: "whatsapp_location",
    };
    const interpretation = {
      intent: { kind: "report_incident", confidence: 0.9 },
      entities: {
        description: { value: "Hay un pozo", confidence: 0.95 },
        location: { value: "ignored", confidence: 0.99 },
        risk: { value: null, confidence: null },
        photoIntent: { value: null, confidence: null },
      },
    };
    const out = mergeCollectedDataFromInterpretation({
      collectedData,
      interpretation,
      text: "Hay un pozo",
      currentStep: CHATBOT_CURRENT_STEPS.DESCRIPTION,
    });
    expect(out.collectedData.description).toContain("pozo");
    expect(out.collectedData.photoAttachmentStorageKey).toBe("draft/key");
    expect(out.collectedData.photoWhatsappMediaId).toBe("wamid-media");
    expect(out.collectedData.locationLatitude).toBe(-34.9);
    expect(out.collectedData.locationLongitude).toBe(-56.2);
    expect(out.collectedData.locationSource).toBe("whatsapp_location");
  });
});

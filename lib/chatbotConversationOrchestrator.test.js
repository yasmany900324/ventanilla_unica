import { describe, expect, it } from "vitest";
import { CHATBOT_CURRENT_STEPS } from "./chatSessionStore";
import {
  buildIncidentConfirmationGateReply,
  buildIncidentConfirmationIntroReply,
  buildIncidentCreatedReply,
  buildProcedureStartReply,
  buildQuestionForStep,
  isAffirmativeText,
  mergeCollectedDataFromInterpretation,
  parseUserCommandFromText,
} from "./chatbotConversationOrchestrator";

describe("isAffirmativeText", () => {
  it("acepta variantes cortas naturales", () => {
    expect(isAffirmativeText("sí")).toBe(true);
    expect(isAffirmativeText("SI")).toBe(true);
    expect(isAffirmativeText("ok")).toBe(true);
    expect(isAffirmativeText("dale")).toBe(true);
    expect(isAffirmativeText("correcto")).toBe(true);
    expect(isAffirmativeText("es correcto")).toBe(true);
    expect(isAffirmativeText("confirmo")).toBe(true);
    expect(isAffirmativeText("así es")).toBe(true);
    expect(isAffirmativeText("exacto")).toBe(true);
    expect(isAffirmativeText("sip")).toBe(true);
    expect(isAffirmativeText("si, dale")).toBe(true);
  });

  it("no afirma frases largas ambiguas", () => {
    expect(isAffirmativeText("si quiero confirmar pero antes tengo una duda")).toBe(false);
  });
});

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

  it("interpreta corrección textual de campos", () => {
    expect(parseUserCommandFromText("corregir descripción")).toEqual({
      command: "request_text_correction",
      commandField: "descripcion",
    });
    expect(parseUserCommandFromText("cambiar ubicación")).toEqual({
      command: "request_text_correction",
      commandField: "ubicacion",
    });
  });
});

describe("buildQuestionForStep — copys por canal (web intacto)", () => {
  it("en web el paso foto pide adjuntar evidencia", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO, channel: "web" });
    expect(q.toLowerCase()).toContain("adjuntar");
    expect(q.toLowerCase()).toContain("foto");
  });

  it("en WhatsApp el paso foto mantiene copy sin botones", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO, channel: "whatsapp" });
    expect(q).not.toMatch(/tocá/i);
    expect(q.toLowerCase()).toContain("evidencia");
  });

  it("por defecto se comporta como web (backward compatible)", () => {
    const q = buildQuestionForStep({ step: CHATBOT_CURRENT_STEPS.PHOTO });
    expect(q.toLowerCase()).toContain("adjuntar");
  });
});

describe("buildIncidentConfirmationGateReply", () => {
  it("whatsapp pide confirmación/cancelación/corrección por texto", () => {
    const msg = buildIncidentConfirmationGateReply("whatsapp");
    expect(msg.toLowerCase()).toContain("respondé sí");
    expect(msg.toLowerCase()).toContain("no para cancelar");
    expect(msg.toLowerCase()).toContain("dato querés corregir");
  });

  it("web no depende de botones", () => {
    const msg = buildIncidentConfirmationGateReply("web");
    expect(msg.toLowerCase()).toContain("respondé sí");
    expect(msg.toLowerCase()).not.toContain("botón");
  });
});

describe("buildIncidentConfirmationIntroReply — web vs WhatsApp", () => {
  it("sin opciones devuelve solo la línea intro (comportamiento web histórico)", () => {
    const intro = buildIncidentConfirmationIntroReply("es");
    expect(intro).toBe("Perfecto. Te muestro el resumen para que lo revises antes de registrarlo.");
    expect(intro).not.toContain("Resumen del reporte");
  });

  it("con channel whatsapp incluye resumen en texto plano", () => {
    const intro = buildIncidentConfirmationIntroReply("es", {
      channel: "whatsapp",
      collectedData: {
        catalogItemCode: "registrar_incidencia",
        category: "incidencia_general",
        subcategory: "reporte_general",
        location: "18 de Julio y Ejido",
        description: "Bache grande",
        photoStatus: "skipped",
        incidentRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: false, order: 2 },
          { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
        ],
      },
    });
    expect(intro).toContain("Resumen del reporte");
    expect(intro).toContain("- Procedimiento: Registrar incidencia");
    expect(intro).toContain("- Tipo: Incidencia");
    expect(intro).toContain("- Descripción: Bache grande");
    expect(intro).toContain("- Foto: No adjunta");
    expect(intro).toContain("- Ubicación: 18 de Julio y Ejido");
    expect(intro.toLowerCase()).not.toContain("riesgo");
    expect(intro.toLowerCase()).not.toContain("prioridad");
    expect(intro.toLowerCase()).not.toContain("categor");
    expect(intro).toContain("Respondé sí para confirmar");
  });
});

describe("buildIncidentCreatedReply — canal", () => {
  it("en WhatsApp no menciona Mis incidencias ni inicio de sesión", () => {
    const msg = buildIncidentCreatedReply({
      incidentId: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
      channel: "whatsapp",
    });
    expect(msg.toLowerCase()).not.toContain("mis incidencias");
    expect(msg.toLowerCase()).not.toContain("iniciar sesión");
    expect(msg).toContain("INC-");
    expect(msg).toContain("este mismo chat");
  });
});

describe("buildProcedureStartReply", () => {
  it("incluye el nombre del procedimiento cuando está disponible", () => {
    const msg = buildProcedureStartReply("Reportar un problema común");
    expect(msg).toContain('"Reportar un problema común"');
  });

  it("usa fallback a texto genérico cuando no hay nombre", () => {
    expect(buildProcedureStartReply("")).toContain("este trámite");
  });
});

describe("mergeCollectedDataFromInterpretation — preserva adjuntos y meta de ubicación", () => {
  it("no pierde campos de foto ni coordenadas al fusionar un turno de descripción", () => {
    const collectedData = {
      category: "incidencia_general",
      subcategory: "x",
      location: "Calle 1",
      description: "",
      photoStatus: "pending_upload",
      incidentRequiredFields: [
        { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
        { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
        { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
      ],
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

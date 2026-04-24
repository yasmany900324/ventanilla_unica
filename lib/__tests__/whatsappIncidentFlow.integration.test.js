import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  getSessionSnapshot,
} from "../chatSessionStore";
import { FLOW_KEY_INCIDENT } from "../chatbotConversationOrchestrator.js";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as incidents from "../incidents.js";
import * as llm from "../llmService.js";
import * as mediaClient from "../whatsapp/whatsappMediaClient.js";
import * as photoUpload from "../chatbotIncidentPhotoUpload.js";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interpretUserMessage: vi.fn() };
});

vi.mock("../whatsapp/whatsappMediaClient.js", () => ({
  downloadWhatsAppMediaBytes: vi.fn(),
}));

vi.mock("../chatbotIncidentPhotoUpload.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, persistIncidentPhotoForChatSession: vi.fn() };
});

const testWaId = "5989912345678";

function stubIncidentRow(id) {
  return {
    id,
    userId: null,
    whatsappWaId: testWaId.replace(/\D/g, ""),
    category: "incidencia_general",
    description: "stub",
    location: "stub",
    locationLatitude: null,
    locationLongitude: null,
    status: "recibido",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachmentStorageProvider: null,
    attachmentStorageKey: null,
    attachmentUrl: null,
    attachmentOriginalName: null,
    attachmentMimeType: null,
    attachmentSizeBytes: null,
    attachmentUploadedAt: null,
    hasAttachment: false,
    attachmentImageUrl: null,
  };
}

async function mockImageUploadStep(sessionId, waId) {
  mediaClient.downloadWhatsAppMediaBytes.mockResolvedValue({
    ok: true,
    bytes: Buffer.from([0xff, 0xd8, 0xff]),
    mimeType: "image/jpeg",
  });

  const snapBeforeImage = await getSessionSnapshot(sessionId);
  expect(snapBeforeImage?.currentStep).toBe(CHATBOT_CURRENT_STEPS.PHOTO);

  const collectedAfterPhoto = {
    ...snapBeforeImage.collectedData,
    photoStatus: "provided",
    photoAttachmentStorageProvider: "test_provider",
    photoAttachmentStorageKey: "draft/test-key",
    photoAttachmentPublicUrl: "",
    photoAttachmentSizeBytes: 3,
    photoAttachmentOriginalName: "evidencia.jpg",
    photoAttachmentStoredFilename: "evidencia.jpg",
    photoAttachmentMimeType: "image/jpeg",
    photoAttachmentUploadedAt: new Date().toISOString(),
  };
  const fakeSnapshot = {
    ...snapBeforeImage,
    state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
    currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
    confirmationState: "none",
    collectedData: collectedAfterPhoto,
    lastIntent: "report_incident",
    lastAction: "incident_photo_uploaded",
  };
  photoUpload.persistIncidentPhotoForChatSession.mockResolvedValue({
    status: 200,
    body: {
      sessionId,
      locale: "es",
      replyText: "ok",
      intent: "report_incident",
      confidence: null,
      fulfillmentMessages: [],
      action: "incident_photo_uploaded",
      parameters: {},
      mode: "incident",
      draft: { ...collectedAfterPhoto, missingFields: [] },
      nextStep: { type: "ask_field", field: "location" },
      actionOptions: [],
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
      incident: null,
      statusSummary: null,
      photoPreviewUrl: null,
      incidentDraftPreview: null,
    },
    snapshot: fakeSnapshot,
  });

  const afterImage = await processAssistantTurn({
    channel: "whatsapp",
    sessionId,
    text: "",
    authenticatedUser: null,
    whatsappWaId: waId,
    channelInbound: {
      type: "image",
      mediaId: "META-MEDIA-ID",
      mimeType: "image/jpeg",
      caption: "foto de evidencia",
    },
  });
  expect(afterImage.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.LOCATION);
  expect(mediaClient.downloadWhatsAppMediaBytes).toHaveBeenCalledWith("META-MEDIA-ID");
}

async function reachIncidentConfirmation(sessionId, waId, description = "Hay un árbol caído") {
  await processAssistantTurn({
    channel: "whatsapp",
    sessionId,
    text: "quiero reportar una incidencia",
    authenticatedUser: null,
    whatsappWaId: waId,
    channelInbound: null,
  });
  await processAssistantTurn({
    channel: "whatsapp",
    sessionId,
    text: description,
    authenticatedUser: null,
    whatsappWaId: waId,
    channelInbound: null,
  });
  await mockImageUploadStep(sessionId, waId);
  return processAssistantTurn({
    channel: "whatsapp",
    sessionId,
    text: "",
    authenticatedUser: null,
    whatsappWaId: waId,
    channelInbound: {
      type: "location",
      latitude: -34.905,
      longitude: -56.191,
      addressText: "Ciudad Vieja",
    },
  });
}

describe("Flujo WhatsApp (integración, sin DB de incidencias)", () => {
  let createIncidentSpy;

  beforeEach(() => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "integration_test" },
    });
    mediaClient.downloadWhatsAppMediaBytes.mockReset();
    photoUpload.persistIncidentPhotoForChatSession.mockReset();
    createIncidentSpy = vi.spyOn(incidents, "createIncident").mockImplementation(async () =>
      stubIncidentRow("00000000-0000-4000-8000-000000000099")
    );
  });

  afterEach(() => {
    createIncidentSpy.mockRestore();
  });

  it("flujo guiado por catálogo pide descripción, foto y ubicación sin preguntar riesgo", async () => {
    const sessionId = buildWhatsAppAssistantSessionId(testWaId);

    const start = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });
    expect(start.snapshot?.currentStep).toBe("description");
    expect(String(start.body?.replyText || "").toLowerCase()).not.toContain("riesgo");

    const afterDescription = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Hay un foco roto en la rambla",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });
    expect(afterDescription.snapshot?.currentStep).toBe("photo");
    expect(String(afterDescription.body?.replyText || "").toLowerCase()).not.toContain("riesgo");
    expect(String(afterDescription.body?.replyText || "").toLowerCase()).not.toContain("prioridad");
    expect(String(afterDescription.body?.replyText || "").toLowerCase()).not.toContain("categor");

    await mockImageUploadStep(sessionId, testWaId);

    const afterLocation = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: {
        type: "location",
        latitude: -34.905,
        longitude: -56.191,
        addressText: "Ciudad Vieja",
      },
    });
    expect(afterLocation.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.CONFIRMATION);
    expect(String(afterLocation.body?.replyText || "").toLowerCase()).toContain("resumen");
    expect(String(afterLocation.body?.replyText || "").toLowerCase()).not.toContain("riesgo");
  });

  it("al confirmar, crea incidencia con adjunto y coordenadas", async () => {
    const waId = `${testWaId}2`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Bache grande en la rambla",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    await mockImageUploadStep(sessionId, waId);
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: {
        type: "location",
        latitude: -34.88,
        longitude: -56.15,
        addressText: "Punta Carretas",
      },
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(createIncidentSpy).toHaveBeenCalledTimes(1);
    const payload = createIncidentSpy.mock.calls[0][0];
    expect(payload.whatsappWaId).toBe(waId.replace(/\D/g, ""));
    expect(payload.locationLatitude).toBe(-34.88);
    expect(payload.locationLongitude).toBe(-56.15);
    expect(payload.attachmentFromChatDraft).toMatchObject({
      storageProvider: "test_provider",
      storageKey: "draft/test-key",
    });
  });

  it("resumen final usa campos del catálogo y no envía actionOptions", async () => {
    const waId = `${testWaId}4`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const confirmation = await reachIncidentConfirmation(sessionId, waId, "Hay un arbol caido");
    const reply = String(confirmation.body?.replyText || "");
    expect(confirmation.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.CONFIRMATION);
    expect(confirmation.body?.actionOptions).toEqual([]);
    expect(reply).toContain("- Procedimiento: Registrar incidencia");
    expect(reply).toContain("- Tipo: Incidencia");
    expect(reply).toContain("- Descripción: Hay un arbol caido");
    expect(reply).toContain("- Foto:");
    expect(reply).toContain("- Ubicación:");
    expect(reply.toLowerCase()).not.toContain("riesgo");
    expect(reply.toLowerCase()).not.toContain("prioridad");
    expect(reply.toLowerCase()).not.toContain("categor");
  });

  it("acepta confirmación por texto sí/ok/dale", async () => {
    const waId = `${testWaId}5`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await reachIncidentConfirmation(sessionId, waId, "Semáforo caído");

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "sí",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(createIncidentSpy).toHaveBeenCalledTimes(1);

    const waId2 = `${testWaId}6`;
    const sessionId2 = buildWhatsAppAssistantSessionId(waId2);
    await reachIncidentConfirmation(sessionId2, waId2, "Árbol sobre la calle");
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId: sessionId2,
      text: "ok",
      authenticatedUser: null,
      whatsappWaId: waId2,
      channelInbound: null,
    });
    expect(createIncidentSpy).toHaveBeenCalledTimes(2);

    const waId3 = `${testWaId}61`;
    const sessionId3 = buildWhatsAppAssistantSessionId(waId3);
    await reachIncidentConfirmation(sessionId3, waId3, "Poda urgente");
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId: sessionId3,
      text: "dale",
      authenticatedUser: null,
      whatsappWaId: waId3,
      channelInbound: null,
    });
    expect(createIncidentSpy).toHaveBeenCalledTimes(3);
  });

  it("acepta cancelación por texto no/cancelar", async () => {
    const waId = `${testWaId}7`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await reachIncidentConfirmation(sessionId, waId, "Contenedor roto");

    const cancelled = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "no",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(String(cancelled.body?.replyText || "").toLowerCase()).toContain("cancele");
    expect(createIncidentSpy).toHaveBeenCalledTimes(0);

    const waId2 = `${testWaId}8`;
    const sessionId2 = buildWhatsAppAssistantSessionId(waId2);
    await reachIncidentConfirmation(sessionId2, waId2, "Vereda rota");
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId: sessionId2,
      text: "cancelar",
      authenticatedUser: null,
      whatsappWaId: waId2,
      channelInbound: null,
    });
    expect(createIncidentSpy).toHaveBeenCalledTimes(0);
  });

  it("si pide corregir descripción, vuelve a solicitar descripción", async () => {
    const waId = `${testWaId}9`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await reachIncidentConfirmation(sessionId, waId, "Farola rota");

    const correction = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "corregir descripción",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(correction.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.DESCRIPTION);
    expect(correction.body?.nextStep).toEqual({ type: "ask_field", field: "description" });
    expect(String(correction.body?.replyText || "").toLowerCase()).toContain("descrip");
    expect(correction.body?.actionOptions).toEqual([]);
  });

  it("tras cerrar un caso, un nuevo mensaje inicia un flujo limpio", async () => {
    const waId = `${testWaId}3`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Basura en la vía",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    await mockImageUploadStep(sessionId, waId);
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: {
        type: "location",
        latitude: -34.9,
        longitude: -56.2,
        addressText: "Av. Italia",
      },
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(createIncidentSpy).toHaveBeenCalledTimes(1);
    const snapAfterCreate = await getSessionSnapshot(sessionId);
    expect(snapAfterCreate?.flowKey).toBeNull();
    expect(snapAfterCreate?.state).toBe(CHATBOT_CONVERSATION_STATES.CLOSED);

    const afterNewReport = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Quiero reportar una incidencia por vereda rota",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(afterNewReport.snapshot?.flowKey).toBe(FLOW_KEY_INCIDENT);
    expect(afterNewReport.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE);
    expect(afterNewReport.snapshot?.currentStep).toBe("description");
  });
});

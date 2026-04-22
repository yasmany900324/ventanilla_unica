/**
 * Integración del asistente (memoria local sin Postgres) + mocks de LLM, media y createIncident.
 * Para omitir foto se usa `command: "skip_photo"` como en el cliente web; el texto «sin foto»
 * sigue cubierto por unit tests de {@link ../chatbotConversationOrchestrator.parseUserCommandFromText}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHATBOT_CURRENT_STEPS, getSessionSnapshot } from "../chatSessionStore";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as incidents from "../incidents.js";
import * as llm from "../llmService.js";
import * as mediaClient from "../whatsapp/whatsappMediaClient.js";
import * as photoUpload from "../chatbotIncidentPhotoUpload.js";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    interpretUserMessage: vi.fn(),
  };
});

vi.mock("../whatsapp/whatsappMediaClient.js", () => ({
  downloadWhatsAppMediaBytes: vi.fn(),
}));

vi.mock("../chatbotIncidentPhotoUpload.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    persistIncidentPhotoForChatSession: vi.fn(),
  };
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

describe("Flujo WhatsApp (integración, sin DB de incidencias)", () => {
  let createIncidentSpy;

  beforeEach(() => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "integration_test" },
    });
    mediaClient.downloadWhatsAppMediaBytes.mockReset();
    photoUpload.persistIncidentPhotoForChatSession.mockReset();
    createIncidentSpy = vi.spyOn(incidents, "createIncident").mockImplementation(async (params) =>
      stubIncidentRow("00000000-0000-4000-8000-000000000099")
    );
  });

  afterEach(() => {
    createIncidentSpy.mockRestore();
  });

  it("ubicación WhatsApp + sin foto + confirmación llama createIncident con lat/lng (sin usuario portal)", async () => {
    const sessionId = buildWhatsAppAssistantSessionId(testWaId);

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia por foco roto en la rambla",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });

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
    expect(afterLocation.body?.draft?.locationLatitude).toBe(-34.905);
    expect(afterLocation.body?.draft?.locationLongitude).toBe(-56.191);

    const afterRisk = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "bajo",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });
    expect(afterRisk.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.PHOTO);

    const afterSkipPhoto = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "skip_photo",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });
    expect(afterSkipPhoto.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.CONFIRMATION);
    expect(afterSkipPhoto.body?.draft?.photoStatus).toBe("skipped");

    const afterConfirm = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });
    expect(afterConfirm.status).toBe(200);
    expect(createIncidentSpy).toHaveBeenCalledTimes(1);
    const payload = createIncidentSpy.mock.calls[0][0];
    expect(payload.userId).toBeNull();
    expect(payload.whatsappWaId).toBe(testWaId.replace(/\D/g, ""));
    expect(payload.locationLatitude).toBe(-34.905);
    expect(payload.locationLongitude).toBe(-56.191);
    expect(String(payload.location)).toContain("Ciudad Vieja");
    expect(payload.attachmentFromChatDraft).toBeNull();
  });

  it("imagen WhatsApp en paso foto dispara descarga, persistencia y createIncident con adjunto", async () => {
    const sessionId = buildWhatsAppAssistantSessionId(`${testWaId}2`);

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia por bache en la rambla",
      authenticatedUser: null,
      whatsappWaId: `${testWaId}2`,
      channelInbound: null,
    });

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: `${testWaId}2`,
      channelInbound: {
        type: "location",
        latitude: -34.88,
        longitude: -56.15,
      },
    });

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "alto",
      authenticatedUser: null,
      whatsappWaId: `${testWaId}2`,
      channelInbound: null,
    });

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
      state: "awaiting_confirmation",
      currentStep: "confirmation",
      confirmationState: "ready",
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
        nextStep: { type: "confirm_incident", field: null },
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

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: `${testWaId}2`,
      channelInbound: {
        type: "image",
        mediaId: "META-MEDIA-ID",
        mimeType: "image/jpeg",
        caption: "foto del bache",
      },
    });

    expect(mediaClient.downloadWhatsAppMediaBytes).toHaveBeenCalledWith("META-MEDIA-ID");
    expect(photoUpload.persistIncidentPhotoForChatSession).toHaveBeenCalled();

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      authenticatedUser: null,
      whatsappWaId: `${testWaId}2`,
      channelInbound: null,
    });

    expect(createIncidentSpy).toHaveBeenCalled();
    const lastCall = createIncidentSpy.mock.calls[createIncidentSpy.mock.calls.length - 1][0];
    expect(lastCall.userId).toBeNull();
    expect(lastCall.whatsappWaId).toBe(`${testWaId}2`.replace(/\D/g, ""));
    expect(lastCall.locationLatitude).toBe(-34.88);
    expect(lastCall.locationLongitude).toBe(-56.15);
    expect(lastCall.attachmentFromChatDraft).toMatchObject({
      storageProvider: "test_provider",
      storageKey: "draft/test-key",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  setConversationState,
} from "../chatSessionStore";
import { FLOW_KEY_INCIDENT } from "../chatbotConversationOrchestrator.js";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as incidents from "../incidents.js";
import * as llm from "../llmService.js";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interpretUserMessage: vi.fn() };
});

vi.mock("../camunda/handleCitizenInfoForWaitingProcedure.js", () => ({
  tryHandleWaitingCitizenInfoMessage: vi.fn(async () => null),
}));

const testWaId = "5987711122233";

async function seedAwaitingIncidentConfirmation(sessionId, waId) {
  return setConversationState(sessionId, {
    locale: "es",
    userId: null,
    whatsappWaId: waId.replace(/\D/g, ""),
    state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
    flowKey: FLOW_KEY_INCIDENT,
    currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
    confirmationState: "ready",
    collectedData: {
      category: "incidencia_general",
      subcategory: "reporte_general",
      procedureName: "Reportar un problema común",
      description: "Árbol caído en la calle",
      location: "Calle 123",
      photoStatus: "provided",
      photoAttachmentStorageProvider: "test_provider",
      photoAttachmentStorageKey: "draft/test-key",
      photoAttachmentOriginalName: "evidencia.jpg",
      photoAttachmentMimeType: "image/jpeg",
      photoAttachmentSizeBytes: 3,
      photoAttachmentUploadedAt: new Date().toISOString(),
      incidentRequiredFields: [
        { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
        { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
        { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
      ],
      sttCriticalEchoPending: false,
    },
    lastInterpretation: llm.getEmptyInterpretation(),
    lastIntent: "report_incident",
    lastAction: "incident_confirmation_ready",
    lastConfidence: 0.9,
  });
}

describe("Confirmación final WhatsApp (incidencia activa)", () => {
  let createIncidentSpy;

  beforeEach(() => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "integration_test" },
    });
    createIncidentSpy = vi.spyOn(incidents, "createIncident").mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000123",
      userId: null,
      whatsappWaId: testWaId,
      category: "incidencia_general",
      description: "Árbol caído en la calle",
      location: "Calle 123",
      status: "recibido",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    createIncidentSpy.mockRestore();
  });

  it.each(["Si", "sí", "ok"])(
    "confirma con '%s' y no pasa por clasificador de inicio",
    async (confirmationText) => {
      const waId = `${testWaId}${confirmationText.length}`;
      const sessionId = buildWhatsAppAssistantSessionId(waId);
      await seedAwaitingIncidentConfirmation(sessionId, waId);

      llm.interpretUserMessage.mockClear();
      const out = await processAssistantTurn({
        channel: "whatsapp",
        sessionId,
        text: confirmationText,
        authenticatedUser: null,
        whatsappWaId: waId,
        channelInbound: null,
      });

      expect(out.status).toBe(200);
      expect(createIncidentSpy).toHaveBeenCalledTimes(1);
      expect(llm.interpretUserMessage).not.toHaveBeenCalled();
      const reply = String(out.body?.replyText || "").toLowerCase();
      expect(reply).not.toContain("no me quedó claro qué querés hacer");
      expect(reply).not.toContain("puedo ayudarte con:");
    }
  );

  it("con 'no' cancela el borrador y no registra incidencia", async () => {
    const waId = `${testWaId}9`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await seedAwaitingIncidentConfirmation(sessionId, waId);

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "no",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(createIncidentSpy).toHaveBeenCalledTimes(0);
    expect(String(out.body?.replyText || "").toLowerCase()).toContain("cance");
  });

  it("con 'cambiar ubicación' entra en modo corrección de ubicación", async () => {
    const waId = `${testWaId}8`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await seedAwaitingIncidentConfirmation(sessionId, waId);

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "cambiar ubicación",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(createIncidentSpy).toHaveBeenCalledTimes(0);
    expect(out.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.LOCATION);
    expect(out.body?.nextStep).toEqual({ type: "ask_field", field: "location" });
  });
});

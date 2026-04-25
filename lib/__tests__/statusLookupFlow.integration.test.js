import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  getSessionSnapshot,
  setConversationState,
} from "../chatSessionStore";
import { FLOW_KEY_INCIDENT } from "../chatbotConversationOrchestrator";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId.js";
import * as llm from "../llmService.js";
import * as incidents from "../incidents.js";
import * as procedureRequests from "../procedureRequests.js";
import * as procedureCatalog from "../procedureCatalog.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interpretUserMessage: vi.fn() };
});
vi.mock("../camunda/handleCitizenInfoForWaitingProcedure.js", () => ({
  tryHandleWaitingCitizenInfoMessage: vi.fn(async () => ({ handled: false })),
}));
vi.mock("../camunda/syncLocalCaseToCamunda", () => ({
  syncIncidentToCamundaAfterCreate: vi.fn(async () => ({})),
  syncTramiteToCamundaAfterCreate: vi.fn(async () => ({})),
}));

function buildStartInterpretation({ intent = "greeting_or_start", confidence = 0.9, caseKind = null } = {}) {
  return {
    ...llm.getEmptyInterpretation(),
    conversationStart: {
      intent,
      confidence,
      extractedData: { caseKind, procedureHint: null, caseIdentifier: null },
      userMessage: null,
    },
  };
}

const originalCatalogMode = process.env.CHATBOT_CATALOG_CASE_TYPE;

describe("status completion closes flow and resets session", () => {
  beforeEach(() => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "mixed";
    vi.spyOn(procedureCatalog, "ensureProcedureCatalogSchema").mockResolvedValue(true);
    vi.spyOn(procedureCatalog, "listActiveProcedureCatalog").mockResolvedValue([]);
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.8 }),
      meta: { source: "llm", reason: null },
    });
    vi.spyOn(incidents, "findIncidentByIdentifier").mockResolvedValue(null);
    vi.spyOn(procedureRequests, "findProcedureRequestByIdentifier").mockResolvedValue(null);
    vi.spyOn(incidents, "createIncident").mockResolvedValue({
      id: "ebbece0d-0000-4000-8000-000000000099",
      status: "recibido",
      category: "incidencia_general",
      location: "Centro",
      description: "Creada",
    });
  });

  afterEach(() => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = originalCatalogMode;
    vi.restoreAllMocks();
  });

  it("whatsapp: consulta por INC muestra estado y deja sesión limpia/IDLE", async () => {
    const waId = "598991239999";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000001",
      status: "en revision",
      category: "incidencia_general",
      location: "Centro",
      description: "Prueba de estado",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "").toLowerCase()).toContain("estado actual");
    expect(String(out.body.replyText || "")).toContain("escribí 1 para iniciar un trámite o 2 para consultar otro caso");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(out.snapshot?.flowKey).toBeNull();
    expect(out.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.LOCATION);
    expect(out.snapshot?.lastIntent).toBeNull();
  });

  it("whatsapp: tras consulta completada, 'nueva incidencia' se procesa como nueva intención", async () => {
    const waId = "598991239998";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000002",
      status: "en proceso",
      category: "incidencia_general",
      location: "Centro",
      description: "Estado previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({
        intent: "start_case",
        confidence: 0.95,
        caseKind: "incident",
      }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "nueva incidencia",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("¿qué querés hacer?");
    expect(out.snapshot?.flowKey).not.toBe("status.check");
  });

  it("whatsapp: tras consulta completada, '2' inicia una nueva consulta de estado", async () => {
    const waId = "598991239997";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000003",
      status: "en proceso",
      category: "incidencia_general",
      location: "Centro",
      description: "Estado previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.8 }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });

    expect(out.snapshot?.flowKey).toBe("status.check");
    expect(out.snapshot?.currentStep).toBe("waiting_for_case_code");
  });

  it("whatsapp: tras consulta completada, 'hola' muestra bienvenida", async () => {
    const waId = "598991239996";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000004",
      status: "recibido",
      category: "incidencia_general",
      location: "Centro",
      description: "Estado previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start", confidence: 0.95 }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });

    expect(String(out.body.replyText || "")).toContain("Hola 👋 Soy el asistente del Sistema de Atención Ciudadana.");
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("whatsapp: tras confirmar incidencia registrada limpia sesión activa", async () => {
    const waId = "598991239995";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: FLOW_KEY_INCIDENT,
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "incidencia_general",
        description: "Bache",
        location: "Centro",
        photoStatus: "provided",
        incidentRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
          { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
        ],
      },
      lastInterpretation: {},
      lastIntent: "report_incident",
      lastAction: "incident_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "")).toContain("Código del caso: INC-");
    expect(String(out.body.replyText || "")).toContain("escribí 1 para iniciar un trámite o 2 para consultar otro caso");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(out.snapshot?.flowKey).toBeNull();
    expect(out.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.LOCATION);
    expect(out.snapshot?.lastIntent).toBeNull();
  });

  it("whatsapp: tras registro de incidencia, '2' inicia consulta nueva", async () => {
    const waId = "598991239994";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: FLOW_KEY_INCIDENT,
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "incidencia_general",
        description: "Vereda rota",
        location: "Centro",
        photoStatus: "provided",
        incidentRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
          { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
        ],
      },
      lastInterpretation: {},
      lastIntent: "report_incident",
      lastAction: "incident_ready",
      lastConfidence: null,
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.8 }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    expect(out.snapshot?.flowKey).toBe("status.check");
    expect(out.snapshot?.currentStep).toBe("waiting_for_case_code");
  });

  it("web: consulta estado completada también deja sesión limpia", async () => {
    const sessionId = "web-status-reset";
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "web", sessionId, text: "hola" });
    await processAssistantTurn({ channel: "web", sessionId, text: "2" });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000006",
      status: "recibido",
      category: "incidencia_general",
      location: "Cordón",
      description: "Caso web",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId,
      text: "INC-EBBECE0D",
      authenticatedUser: { id: "citizen-web-1" },
    });

    expect(out.snapshot?.flowKey).toBeNull();
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
  });

  it("no deja status.check ni status_result_shown después de responder estado", async () => {
    const waId = "598991239993";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000007",
      status: "en revision",
      category: "incidencia_general",
      location: "Centro",
      description: "Caso",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    const snapshot = await getSessionSnapshot(sessionId);
    expect(snapshot?.flowKey).toBeNull();
    expect(snapshot?.currentStep).not.toBe("status_result_shown");
  });

  it("no deja flow activo de incidente luego de confirmación exitosa", async () => {
    const waId = "598991239992";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: FLOW_KEY_INCIDENT,
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "incidencia_general",
        description: "Árbol caído",
        location: "Centro",
        photoStatus: "provided",
        incidentRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
          { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
          { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
        ],
      },
      lastInterpretation: {},
      lastIntent: "report_incident",
      lastAction: "incident_ready",
      lastConfidence: null,
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      whatsappWaId: waId,
    });

    const snapshot = await getSessionSnapshot(sessionId);
    expect(snapshot?.flowKey).toBeNull();
    expect(snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(snapshot?.confirmationState).toBe("none");
  });
});

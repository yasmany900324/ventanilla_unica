import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionSnapshot } from "../chatSessionStore";
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

function buildStartInterpretation({
  intent = "greeting_or_start",
  confidence = 0.9,
  caseKind = null,
} = {}) {
  return {
    ...llm.getEmptyInterpretation(),
    conversationStart: {
      intent,
      confidence,
      extractedData: {
        caseKind,
        procedureHint: null,
        caseIdentifier: null,
      },
      userMessage: null,
    },
  };
}

function buildStatusFollowUpInterpretation({
  intent = "ambiguous",
  confidence = 0.9,
  caseIdentifier = null,
  caseKind = null,
  procedureHint = null,
} = {}) {
  return {
    ...llm.getEmptyInterpretation(),
    statusFollowUp: {
      intent,
      confidence,
      extractedData: {
        caseIdentifier,
        procedureHint,
        caseKind,
      },
      userMessage: null,
    },
  };
}

const originalCatalogMode = process.env.CHATBOT_CATALOG_CASE_TYPE;

describe("status lookup flow (web + whatsapp)", () => {
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
  });

  afterEach(() => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = originalCatalogMode;
    vi.restoreAllMocks();
  });

  it("whatsapp: responder 2 deja la sesión esperando código", async () => {
    const waId = "598991239999";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "hola",
      whatsappWaId: waId,
    });

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "2",
      whatsappWaId: waId,
    });

    const snapshot = await getSessionSnapshot(sessionId);
    expect(snapshot?.flowKey).toBe("status.check");
    expect(snapshot?.currentStep).toBe("waiting_for_case_code");
    expect(snapshot?.lastIntent).toBe("check_status");
  });

  it("whatsapp: en waiting_for_case_code, código válido consulta estado y pasa a status_result_shown", async () => {
    const waId = "598991239998";
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
    llm.interpretUserMessage.mockClear();
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    expect(llm.interpretUserMessage).not.toHaveBeenCalled();
    expect(String(out.body.replyText || "").toLowerCase()).toContain("estado actual");
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("puedo ayudarte con:");
    expect(out.snapshot?.flowKey).toBe("status.check");
    expect(out.snapshot?.currentStep).toBe("status_result_shown");
  });

  it("whatsapp: en status_result_shown, otro código válido consulta otro caso", async () => {
    const waId = "598991239995";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000010",
      status: "en proceso",
      category: "incidencia_general",
      location: "Centro",
      description: "Primer caso",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "12345678-0000-4000-8000-000000000011",
      status: "recibido",
      category: "incidencia_general",
      location: "Cordón",
      description: "Segundo caso",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    llm.interpretUserMessage.mockClear();
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-12345678",
      whatsappWaId: waId,
    });

    expect(llm.interpretUserMessage).not.toHaveBeenCalled();
    expect(String(out.body.replyText || "").toLowerCase()).toContain("estado actual");
    expect(out.snapshot?.currentStep).toBe("status_result_shown");
  });

  it("whatsapp: en status_result_shown, lookup_another_case pide nuevo código", async () => {
    const waId = "598991239994";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000012",
      status: "en revision",
      category: "incidencia_general",
      location: "Centro",
      description: "Caso de prueba",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockClear();
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStatusFollowUpInterpretation({
        intent: "lookup_another_case",
        confidence: 0.94,
      }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero consultar otro",
      whatsappWaId: waId,
    });

    expect(llm.interpretUserMessage).toHaveBeenCalledTimes(1);
    expect(String(out.body.replyText || "").toLowerCase()).toContain("identificador");
    expect(out.snapshot?.currentStep).toBe("waiting_for_case_code");
  });

  it("whatsapp: en status_result_shown, start_new_case inicia nuevo flujo", async () => {
    const waId = "598991239993";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000013",
      status: "en revision",
      category: "incidencia_general",
      location: "Centro",
      description: "Caso previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockClear();
    llm.interpretUserMessage
      .mockResolvedValueOnce({
        interpretation: buildStatusFollowUpInterpretation({
          intent: "start_new_case",
          confidence: 0.95,
          caseKind: "incident",
        }),
        meta: { source: "llm", reason: null },
      })
      .mockResolvedValueOnce({
        interpretation: buildStartInterpretation({
          intent: "start_case",
          confidence: 0.92,
          caseKind: "incident",
        }),
        meta: { source: "llm", reason: null },
      });
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar otro caso",
      whatsappWaId: waId,
    });

    expect(llm.interpretUserMessage).toHaveBeenCalledTimes(2);
    expect(["incident", "procedure", "unknown"]).toContain(out.body.mode);
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("formato no parece");
  });

  it("whatsapp: en status_result_shown, ambiguous pide aclaración", async () => {
    const waId = "598991239992";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000014",
      status: "en proceso",
      category: "incidencia_general",
      location: "Centro",
      description: "Caso previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockClear();
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStatusFollowUpInterpretation({
        intent: "ambiguous",
        confidence: 0.88,
      }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "con una nueva incidencia",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "").toLowerCase()).toContain("consultar otro caso");
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("formato no parece");
  });

  it("whatsapp: en status_result_shown, fallback o baja confianza pide aclaración", async () => {
    const waId = "598991239991";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });
    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000015",
      status: "en proceso",
      category: "incidencia_general",
      location: "Centro",
      description: "Caso previo",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-EBBECE0D",
      whatsappWaId: waId,
    });

    llm.interpretUserMessage.mockClear();
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStatusFollowUpInterpretation({
        intent: "start_new_case",
        confidence: 0.3,
      }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar otro caso",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "").toLowerCase()).toContain("¿qué querés hacer?");
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("formato no parece");
  });

  it("whatsapp: código inexistente en waiting_for_case_code responde no encontrado", async () => {
    const waId = "598991239997";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "INC-00000000",
      whatsappWaId: waId,
    });

    expect(String(out.body.replyText || "")).toContain("No encontré un caso con el código INC-00000000");
  });

  it("whatsapp: en waiting_for_case_code no llama clasificador general y pide código", async () => {
    const waId = "598991239996";
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "hola", whatsappWaId: waId });
    await processAssistantTurn({ channel: "whatsapp", sessionId, text: "2", whatsappWaId: waId });

    llm.interpretUserMessage.mockClear();
    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "hola de nuevo",
      whatsappWaId: waId,
    });

    expect(llm.interpretUserMessage).not.toHaveBeenCalled();
    expect(String(out.body.replyText || "").toLowerCase()).toContain("formato");
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("puedo ayudarte con:");
  });

  it("web: en status_result_shown permite clasificación contextual (lookup_another_case)", async () => {
    const sessionId = "web-status-flow";
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({ channel: "web", sessionId, text: "hola" });
    await processAssistantTurn({ channel: "web", sessionId, text: "2" });

    incidents.findIncidentByIdentifier.mockResolvedValueOnce({
      id: "ebbece0d-0000-4000-8000-000000000002",
      status: "recibido",
      category: "incidencia_general",
      location: "Cordón",
      description: "Caso web",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await processAssistantTurn({
      channel: "web",
      sessionId,
      text: "INC-EBBECE0D",
      authenticatedUser: { id: "citizen-1" },
    });

    llm.interpretUserMessage.mockClear();
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStatusFollowUpInterpretation({
        intent: "lookup_another_case",
        confidence: 0.93,
      }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "web",
      sessionId,
      text: "quiero consultar otro",
      authenticatedUser: { id: "citizen-1" },
    });

    expect(llm.interpretUserMessage).toHaveBeenCalledTimes(1);
    expect(String(out.body.replyText || "").toLowerCase()).toContain("identificador");
    expect(out.snapshot?.currentStep).toBe("waiting_for_case_code");
  });
});

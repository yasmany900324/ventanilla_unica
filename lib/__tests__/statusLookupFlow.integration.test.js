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

describe("status lookup flow (web + whatsapp)", () => {
  beforeEach(() => {
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

  it("whatsapp: con código válido consulta estado sin volver a bienvenida ni usar clasificador", async () => {
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
  });

  it("whatsapp: código inexistente responde no encontrado", async () => {
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

  it("whatsapp: código inválido vuelve a pedir código y no reinicia menú", async () => {
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

  it("web: en estado esperando código también evita clasificación inicial y procesa identificador", async () => {
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
    llm.interpretUserMessage.mockClear();
    const out = await processAssistantTurn({
      channel: "web",
      sessionId,
      text: "INC-EBBECE0D",
      authenticatedUser: { id: "citizen-1" },
    });

    expect(llm.interpretUserMessage).not.toHaveBeenCalled();
    expect(String(out.body.replyText || "").toLowerCase()).toContain("estado actual");
    expect(String(out.body.replyText || "").toLowerCase()).not.toContain("puedo ayudarte con:");
  });
});

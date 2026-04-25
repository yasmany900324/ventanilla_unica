import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as llm from "../llmService.js";
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

const EXPECTED_WELCOME_REPLY = `Hola 👋 Soy el asistente del Sistema de Atención Ciudadana.

Puedo ayudarte con:

1. Iniciar un trámite o reportar una incidencia
2. Consultar el estado de un caso

Respondé con el número o contame qué necesitás.`;

describe("chatbot start intent classification", () => {
  beforeEach(() => {
    vi.spyOn(procedureCatalog, "ensureProcedureCatalogSchema").mockResolvedValue(true);
    vi.spyOn(procedureCatalog, "listActiveProcedureCatalog").mockResolvedValue([
      {
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "incidencias",
        requiredFields: [
          {
            key: "procedureDetails",
            label: "Detalle",
            prompt: "Contame brevemente qué necesitás.",
            type: "text",
            required: true,
            order: 1,
          },
        ],
        aliases: ["reportar incidencia"],
        keywords: ["incidencia"],
      },
    ]);
    vi.spyOn(procedureCatalog, "findMatchingProcedure").mockResolvedValue({
      code: "registrar_incidencia",
    });
    process.env.CHATBOT_CATALOG_CASE_TYPE = "mixed";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CHATBOT_CATALOG_CASE_TYPE;
  });

  it("responde bienvenida exacta para 'hola'", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-greeting-hola",
      text: "hola",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toBe(EXPECTED_WELCOME_REPLY);
    expect(out.body.actionOptions).toEqual([]);
  });

  it("responde bienvenida exacta para 'buenas'", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-greeting-buenas",
      text: "buenas",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toBe(EXPECTED_WELCOME_REPLY);
    expect(out.body.actionOptions).toEqual([]);
  });

  it("para 'necesito ayuda' devuelve opciones de inicio (bienvenida o aclaración)", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.86 }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-necesito-ayuda",
      text: "necesito ayuda",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toContain("1. Iniciar un trámite o reportar una incidencia");
    expect(out.body.replyText).toContain("2. Consultar el estado de un caso");
    expect(out.body.actionOptions).toEqual([]);
  });

  it("si inicia con 'quiero reportar una incidencia' entra directo al flujo", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({
        intent: "start_case",
        caseKind: "incident",
      }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-reportar-incidencia",
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
    });

    expect(out.body.mode).toBe("incident");
    expect(out.body.nextStep.type).toBe("ask_field");
    expect(out.body.replyText).not.toContain("Puedo ayudarte con:");
    expect(out.body.actionOptions).toEqual([]);
  });

  it("si responde 2 luego de bienvenida entra en consulta de estado", async () => {
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({
      channel: "web",
      sessionId: "start-numeric-status",
      text: "hola",
      authenticatedUser: null,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.8 }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-numeric-status",
      text: "2",
      authenticatedUser: null,
    });

    expect(out.body.nextStep).toEqual({ type: "check_status", field: "identifier" });
    expect(out.body.replyText.toLowerCase()).toContain("consultar el estado");
  });

  it("inicia flujo de incidencia desde texto semántico", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({
        intent: "start_case",
        caseKind: "incident",
      }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-incident-semantic",
      text: "hay un árbol caído en la calle",
      authenticatedUser: null,
    });

    expect(out.body.mode).toBe("incident");
    expect(out.body.nextStep.type).toBe("ask_field");
    expect(out.body.replyText).not.toContain("Puedo ayudarte con:");
    expect(out.body.actionOptions).toEqual([]);
  });

  it("si inicia con consulta de estado entra directo al flujo de estado", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({
        intent: "check_status",
        confidence: 0.95,
      }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-check-status",
      text: "quiero consultar el estado de mi caso",
      authenticatedUser: null,
    });

    expect(out.body.nextStep).toEqual({ type: "check_status", field: "identifier" });
    expect(out.body.replyText.toLowerCase()).toContain("consultar el estado");
    expect(out.body.actionOptions).not.toEqual([]);
  });

  it("si responde 1 luego de bienvenida inicia trámite/reporte", async () => {
    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({
      channel: "web",
      sessionId: "start-numeric-procedure",
      text: "hola",
      authenticatedUser: null,
    });

    llm.interpretUserMessage.mockResolvedValueOnce({
      interpretation: buildStartInterpretation({ intent: "ambiguous", confidence: 0.8 }),
      meta: { source: "llm", reason: null },
    });
    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-numeric-procedure",
      text: "1",
      authenticatedUser: null,
    });

    expect(["unknown", "procedure", "incident"]).toContain(out.body.mode);
    expect(["ask_field", "clarify_procedure", "procedure_confirm"]).toContain(out.body.nextStep.type);
    expect(out.body.replyText).not.toBe(EXPECTED_WELCOME_REPLY);
  });

  it("si dice gracias al inicio responde breve y mantiene opciones", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "unsupported", confidence: 0.88 }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-thanks",
      text: "gracias",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toContain("De nada.");
    expect(out.body.replyText).toContain("1. Iniciar un trámite o reportar una incidencia");
    expect(out.body.replyText).toContain("2. Consultar el estado de un caso");
    expect(out.body.actionOptions).toEqual([]);
  });

  it("si saluda de nuevo no duplica exactamente la bienvenida inicial", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });

    const first = await processAssistantTurn({
      channel: "web",
      sessionId: "start-repeat-greeting",
      text: "hola",
      authenticatedUser: null,
    });
    const second = await processAssistantTurn({
      channel: "web",
      sessionId: "start-repeat-greeting",
      text: "buenas",
      authenticatedUser: null,
    });

    expect(first.body.replyText).toBe(EXPECTED_WELCOME_REPLY);
    expect(second.body.replyText).not.toBe(EXPECTED_WELCOME_REPLY);
    expect(second.body.replyText).toContain("Hola de nuevo 👋");
    expect(second.body.replyText).toContain("1. Iniciar un trámite o reportar una incidencia");
  });

  it("formato whatsapp mantiene saltos de línea y sin botones", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "greeting_or_start" }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId: "start-whatsapp-format",
      text: "hola",
      authenticatedUser: null,
      whatsappWaId: "5989912345678",
      channelInbound: null,
    });

    expect(out.body.replyText).toContain("\n\n");
    expect(out.body.replyText).toContain("1. Iniciar un trámite o reportar una incidencia");
    expect(out.body.replyText).toContain("2. Consultar el estado de un caso");
    expect(out.body.actionOptions).toEqual([]);
  });

  it("con baja confianza del clasificador inicial usa fallback seguro", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: buildStartInterpretation({ intent: "start_case", confidence: 0.2, caseKind: "incident" }),
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-low-confidence-fallback",
      text: "buen día",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toBe(EXPECTED_WELCOME_REPLY);
    expect(out.body.actionOptions).toEqual([]);
  });

  it("si el LLM cae a fallback por json inválido responde con fallback seguro", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "invalid_json" },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "start-invalid-json-fallback",
      text: "qué tal",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toBe(EXPECTED_WELCOME_REPLY);
    expect(out.body.actionOptions).toEqual([]);
  });
});

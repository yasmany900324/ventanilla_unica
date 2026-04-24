import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as llm from "../llmService.js";
import * as procedureCatalog from "../procedureCatalog.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, interpretUserMessage: vi.fn() };
});

describe("chatbot conversational consistency across channels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(procedureCatalog, "ensureProcedureCatalogSchema").mockResolvedValue(true);
    vi.spyOn(procedureCatalog, "listActiveProcedureCatalog").mockResolvedValue([]);
    vi.spyOn(procedureCatalog, "findMatchingProcedure").mockResolvedValue(null);
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "test" },
    });
  });

  it("muestra mensaje de control cuando no hay procedimientos activos", async () => {
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: {
        ...llm.getEmptyInterpretation(),
        intent: { kind: "start_procedure", confidence: 0.95 },
      },
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "test-no-procedures",
      text: "quiero iniciar un trámite",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toBe(
      "Por el momento no tengo procedimientos disponibles para iniciar desde el chat."
    );
    expect(out.body.actionOptions).toEqual([]);
  });

  it("lista procedimientos en formato numerado sin action options", async () => {
    procedureCatalog.listActiveProcedureCatalog.mockResolvedValue([
      {
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "incidencias",
        requiredFields: [],
        aliases: ["reportar incidencia"],
        keywords: ["incidencia"],
      },
    ]);
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: {
        ...llm.getEmptyInterpretation(),
        intent: { kind: "start_procedure", confidence: 0.92 },
      },
      meta: { source: "llm", reason: null },
    });

    const out = await processAssistantTurn({
      channel: "web",
      sessionId: "test-list-procedures",
      text: "quiero iniciar un trámite",
      authenticatedUser: null,
    });

    expect(out.body.replyText).toContain("1. Registrar incidencia");
    expect(out.body.replyText).toContain(
      "Respondé con el número o escribí el nombre del procedimiento."
    );
    expect(out.body.actionOptions).toEqual([]);
    expect(out.body.nextStep).toEqual({ type: "clarify_procedure", field: "procedureName" });
  });

  it("acepta selección por número y valida número fuera de rango", async () => {
    procedureCatalog.listActiveProcedureCatalog.mockResolvedValue([
      {
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "incidencias",
        requiredFields: [],
        aliases: ["reportar incidencia"],
        keywords: ["incidencia"],
      },
    ]);

    llm.interpretUserMessage.mockResolvedValue({
      interpretation: {
        ...llm.getEmptyInterpretation(),
        intent: { kind: "start_procedure", confidence: 0.92 },
      },
      meta: { source: "llm", reason: null },
    });
    await processAssistantTurn({
      channel: "web",
      sessionId: "test-select-by-number",
      text: "quiero iniciar un trámite",
      authenticatedUser: null,
    });

    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "test" },
    });
    const invalid = await processAssistantTurn({
      channel: "web",
      sessionId: "test-select-by-number",
      text: "9",
      authenticatedUser: null,
    });
    expect(invalid.body.replyText).toContain(
      "No encontré una opción con ese número. Probá con uno de la lista o escribí el nombre del procedimiento."
    );
    expect(invalid.body.nextStep).toEqual({ type: "clarify_procedure", field: "procedureName" });

    const valid = await processAssistantTurn({
      channel: "web",
      sessionId: "test-select-by-number",
      text: "1",
      authenticatedUser: null,
    });
    expect(valid.snapshot?.collectedData?.procedureCode).toBe("registrar_incidencia");
  });
});

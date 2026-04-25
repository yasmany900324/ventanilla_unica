import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../openai/openaiClientRegistry.js", () => ({
  getLlmOpenAIClient: vi.fn(),
}));
vi.mock("../openai/openaiLoggedClient.js", () => ({
  createChatCompletionWithLogs: vi.fn(),
}));

import { getLlmOpenAIClient } from "../openai/openaiClientRegistry.js";
import { createChatCompletionWithLogs } from "../openai/openaiLoggedClient.js";
import { interpretUserMessage } from "../llmService.js";

describe("llmService conversationStart validation", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    getLlmOpenAIClient.mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it("acepta conversationStart.intent válido", async () => {
    createChatCompletionWithLogs.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: { kind: "unknown", confidence: 0.2 },
              flowCandidate: { flowKey: null, confidence: null },
              procedureCandidate: { name: null, category: null, confidence: null },
              entities: {
                location: { value: null, confidence: null },
                description: { value: null, confidence: null },
                photoIntent: { value: null, confidence: null },
              },
              userSignals: {
                wantsToConfirm: false,
                wantsToCancel: false,
                wantsToEdit: null,
                greetingOpen: false,
              },
              assistantStyle: { suggestedReply: null },
              conversationStart: {
                intent: "start_case",
                confidence: 0.91,
                extractedData: {
                  caseKind: "incident",
                  procedureHint: null,
                  caseIdentifier: null,
                },
                userMessage: null,
              },
            }),
          },
        },
      ],
    });

    const out = await interpretUserMessage({
      text: "hay un árbol caído",
      locale: "es",
      sessionContext: { channel: "web" },
    });

    expect(out.meta.source).toBe("llm");
    expect(out.interpretation.conversationStart.intent).toBe("start_case");
    expect(out.interpretation.conversationStart.extractedData.caseKind).toBe("incident");
  });

  it("si conversationStart.intent es inválido cae por Zod con fallback seguro", async () => {
    createChatCompletionWithLogs.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: { kind: "unknown", confidence: 0.2 },
              flowCandidate: { flowKey: null, confidence: null },
              procedureCandidate: { name: null, category: null, confidence: null },
              entities: {
                location: { value: null, confidence: null },
                description: { value: null, confidence: null },
                photoIntent: { value: null, confidence: null },
              },
              userSignals: {
                wantsToConfirm: false,
                wantsToCancel: false,
                wantsToEdit: null,
                greetingOpen: false,
              },
              assistantStyle: { suggestedReply: null },
              conversationStart: {
                intent: "whatever",
                confidence: 0.91,
                extractedData: {
                  caseKind: "incident",
                  procedureHint: null,
                  caseIdentifier: null,
                },
                userMessage: null,
              },
            }),
          },
        },
      ],
    });

    const out = await interpretUserMessage({
      text: "inicio",
      locale: "es",
      sessionContext: { channel: "web" },
    });

    expect(out.meta.source).toBe("fallback");
    expect(out.meta.reason).toBe("schema_validation_failed");
    expect(out.interpretation.conversationStart.intent).toBe("ambiguous");
  });

  it("si el proveedor devuelve JSON inválido cae en fallback invalid_json", async () => {
    createChatCompletionWithLogs.mockResolvedValue({
      choices: [
        {
          message: {
            content: "texto libre no json",
          },
        },
      ],
    });

    const out = await interpretUserMessage({
      text: "hola",
      locale: "es",
      sessionContext: { channel: "web" },
    });

    expect(out.meta.source).toBe("fallback");
    expect(out.meta.reason).toBe("invalid_json");
    expect(out.interpretation.conversationStart.intent).toBe("ambiguous");
  });
});

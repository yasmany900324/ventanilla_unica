/**
 * Confirma trámite vía WhatsApp sin usuario del portal: debe llamar a createProcedureRequest con whatsappWaId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHATBOT_CONVERSATION_STATES, CHATBOT_CURRENT_STEPS, setConversationState } from "../chatSessionStore";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as llm from "../llmService.js";
import * as procedureCatalog from "../procedureCatalog.js";
import * as procedureRequests from "../procedureRequests.js";
import { buildWhatsAppAssistantSessionId } from "../whatsapp/whatsappSessionId.js";

vi.mock("../llmService.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    interpretUserMessage: vi.fn(),
  };
});

const testWaId = "5988877766655";

describe("Trámite WhatsApp sin usuario portal", () => {
  let createProcedureRequestSpy;
  let getProcedureByCodeSpy;

  beforeEach(() => {
    getProcedureByCodeSpy = vi.spyOn(procedureCatalog, "getProcedureByCode").mockResolvedValue({
      code: "test_proc",
      name: "Trámite de prueba",
      category: "",
      requiredFields: [],
      flowDefinition: {},
    });
    llm.interpretUserMessage.mockResolvedValue({
      interpretation: llm.getEmptyInterpretation(),
      meta: { source: "fallback", reason: "integration_test" },
    });
    createProcedureRequestSpy = vi.spyOn(procedureRequests, "createProcedureRequest").mockResolvedValue({
      id: "proc-req-1",
      userId: null,
      whatsappWaId: testWaId.replace(/\D/g, ""),
      requestCode: "TRA-ABCDEF12",
      procedureCode: "test_proc",
      procedureName: "Trámite de prueba",
      procedureCategory: "",
      status: "recibido",
      summary: "resumen",
      collectedData: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    createProcedureRequestSpy.mockRestore();
    getProcedureByCodeSpy.mockRestore();
  });

  it("al confirmar persistencia usa whatsappWaId y no userId", async () => {
    const sessionId = buildWhatsAppAssistantSessionId(testWaId);

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: testWaId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "",
        subcategory: "",
        location: "",
        description: "",
        risk: "",
        photoStatus: "not_requested",
        procedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        procedureCategory: "",
        procedureDetails: "Necesito una copia simple.",
        procedureRequiredFields: [],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      command: "confirm",
      authenticatedUser: null,
      whatsappWaId: testWaId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    const args = createProcedureRequestSpy.mock.calls[0][0];
    expect(args.userId).toBeNull();
    expect(args.whatsappWaId).toBe(testWaId.replace(/\D/g, ""));
    expect(args.procedureCode).toBe("test_proc");
  });
});

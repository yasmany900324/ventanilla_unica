/**
 * Confirma trámite vía WhatsApp sin usuario del portal: debe llamar a createProcedureRequest con whatsappWaId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHATBOT_CONVERSATION_STATES, CHATBOT_CURRENT_STEPS, setConversationState } from "../chatSessionStore";
import { processAssistantTurn } from "../assistant/processAssistantTurn.js";
import * as llm from "../llmService.js";
import * as procedureCatalog from "../procedureCatalog.js";
import * as procedureRequests from "../procedureRequests.js";
import * as mediaClient from "../whatsapp/whatsappMediaClient.js";
import * as photoUpload from "../chatbotProcedurePhotoUpload.js";
import * as camundaSync from "../camunda/syncLocalCaseToCamunda.js";
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

vi.mock("../chatbotProcedurePhotoUpload.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, persistProcedurePhotoForChatSession: vi.fn() };
});

vi.mock("../camunda/handleCitizenInfoForWaitingProcedure.js", () => ({
  tryHandleWaitingCitizenInfoMessage: vi.fn(async () => null),
}));

vi.mock("../camunda/syncLocalCaseToCamunda.js", () => ({
  syncTramiteToCamundaAfterCreate: vi.fn(async () => ({ ok: true })),
  syncIncidentToCamundaAfterCreate: vi.fn(async () => ({ ok: true })),
}));

const testWaId = "5988877766655";

describe("Trámite WhatsApp sin usuario portal", () => {
  let createProcedureRequestSpy;
  let getProcedureByCodeSpy;
  let listActiveProcedureCatalogSpy;
  let syncTramiteSpy;
  const originalCatalogMode = process.env.CHATBOT_CATALOG_CASE_TYPE;

  beforeEach(() => {
    getProcedureByCodeSpy = vi.spyOn(procedureCatalog, "getProcedureByCode").mockResolvedValue({
      code: "test_proc",
      name: "Trámite de prueba",
      category: "",
      requiredFields: [
        { key: "description", label: "Descripción", type: "text", required: true },
      ],
      flowDefinition: {},
    });
    listActiveProcedureCatalogSpy = vi
      .spyOn(procedureCatalog, "listActiveProcedureCatalog")
      .mockResolvedValue([
        {
          id: "proc-1",
          code: "test_proc",
          name: "Registrar incidencia",
          category: "Incidencia",
          aliases: ["reportar incidencia", "arbol caido"],
          keywords: ["arbol", "caido", "incidencia"],
          requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
          flowDefinition: {},
          isActive: true,
        },
      ]);
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
    mediaClient.downloadWhatsAppMediaBytes.mockReset();
    photoUpload.persistProcedurePhotoForChatSession.mockReset();
    syncTramiteSpy = vi.spyOn(camundaSync, "syncTramiteToCamundaAfterCreate");
  });

  afterEach(() => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = originalCatalogMode;
    createProcedureRequestSpy.mockRestore();
    getProcedureByCodeSpy.mockRestore();
    listActiveProcedureCatalogSpy.mockRestore();
    syncTramiteSpy.mockRestore();
  });

  it("en modo procedure-only, narrativa de incidencia clara inicia el flujo", async () => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "procedure";
    const waId = `${testWaId}11`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "hay un arbol caido en mi cuadra",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(out.snapshot?.collectedData?.procedureCode).toBe("test_proc");
    expect(out.snapshot?.collectedData?.selectedProcedureCode).toBe("test_proc");
    expect(out.snapshot?.currentStep).toBe("description");
    expect(String(out.body?.replyText || "")).toContain('Voy a ayudarte con "Registrar incidencia"');
    expect(out.body?.nextStep?.type).toBe("ask_field");
  });

  it("en modo procedure-only, 'quiero reportar una incidencia' inicia flujo con catálogo disponible", async () => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "procedure";
    const waId = `${testWaId}13`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(String(out.body?.replyText || "")).toContain('Voy a ayudarte con "Registrar incidencia"');
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain(
      "de momento no puedo ayudarte"
    );
    expect(out.body?.nextStep?.type).toBe("ask_field");
  });

  it("si ya mostró bienvenida y luego llega intención clara no repite saludo", async () => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "procedure";
    const waId = `${testWaId}14`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    const greeting = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "hola",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(String(greeting.body?.replyText || "").toLowerCase()).toContain("hola");

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    const reply = String(out.body?.replyText || "").toLowerCase();
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(reply).not.toContain("hola");
    expect(reply).not.toContain("puedo ayudarte con:");
  });

  it("si selecciona por número, usa exactamente el nombre visible listado", async () => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "procedure";
    listActiveProcedureCatalogSpy.mockResolvedValue([
      {
        id: "proc-visible",
        code: "test_proc",
        name: "Registrar incidencia",
        displayName: "Reportar un problema común",
        category: "Incidencia",
        aliases: ["reportar problema"],
        keywords: ["problema", "incidencia"],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
        flowDefinition: {},
        isActive: true,
      },
    ]);
    const waId = `${testWaId}15`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero iniciar un tramite",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    const listed = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "1",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(String(listed.body?.replyText || "")).toContain("1. Reportar un problema común");

    const selected = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "1",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    const selectedReply = String(selected.body?.replyText || "");
    expect(selectedReply).toContain('Voy a ayudarte con "Reportar un problema común"');
    expect(selectedReply).not.toContain('Voy a ayudarte con "Registrar incidencia"');
    expect(selected.snapshot?.flowKey).toBe("procedure.general_start");
    expect(selected.body?.nextStep?.type).toBe("ask_field");
  });

  it("si no hay match exacto, pide aclaración con opciones en vez de cerrar", async () => {
    process.env.CHATBOT_CATALOG_CASE_TYPE = "procedure";
    listActiveProcedureCatalogSpy.mockResolvedValueOnce([
      {
        id: "proc-2",
        code: "tramite_documental",
        name: "Solicitud documental",
        category: "Trámite",
        aliases: ["copia", "documento"],
        keywords: ["documento", "copia", "certificado"],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
        flowDefinition: {},
        isActive: true,
      },
    ]);
    const waId = `${testWaId}12`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar un árbol caído",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    const reply = String(out.body?.replyText || "").toLowerCase();
    expect(reply).toContain("puedo ayudarte con:");
    expect(reply).toContain("solicitud documental");
    expect(reply).not.toContain("de momento no puedo ayudarte con ese trámite");
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("al confirmar persistencia usa whatsappWaId y no userId", async () => {
    const sessionId = buildWhatsAppAssistantSessionId(testWaId);
    getProcedureByCodeSpy.mockResolvedValueOnce({
      code: "test_proc",
      name: "Trámite de prueba",
      category: "",
      requiredFields: [],
      flowDefinition: {},
    });

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
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(out.snapshot?.flowKey).toBeNull();
    expect(out.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.LOCATION);
  });

  it("en flujo de trámite, imagen WhatsApp en paso foto se persiste y avanza", async () => {
    const waId = `${testWaId}2`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "photo",
      confirmationState: "none",
      collectedData: {
        category: "",
        subcategory: "",
        location: "",
        description: "Hay un problema",
        risk: "",
        photoStatus: "not_requested",
        procedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        procedureCategory: "",
        procedureDetails: "Necesito iniciar un trámite.",
        procedureRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true },
          { key: "photo", label: "Foto", type: "image", required: true },
          { key: "location", label: "Ubicación", type: "text", required: true },
        ],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_photo",
      lastConfidence: null,
    });

    mediaClient.downloadWhatsAppMediaBytes.mockResolvedValue({
      ok: true,
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    photoUpload.persistProcedurePhotoForChatSession.mockResolvedValue({
      status: 200,
      body: {
        sessionId,
        locale: "es",
        replyText: "Perfecto, ahora indicame la ubicación.",
        intent: "start_procedure",
        confidence: null,
        fulfillmentMessages: [],
        action: "procedure_photo_uploaded",
        parameters: {},
        mode: "procedure",
        draft: {},
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
      snapshot: {
        locale: "es",
        currentStep: "location",
        flowKey: "procedure.general_start",
        state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        collectedData: {},
        lastIntent: "start_procedure",
        lastConfidence: null,
      },
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: {
        type: "image",
        mediaId: "MEDIA_PROC_IMG",
        mimeType: "image/jpeg",
      },
    });

    expect(out.status).toBe(200);
    expect(mediaClient.downloadWhatsAppMediaBytes).toHaveBeenCalledWith("MEDIA_PROC_IMG");
    expect(photoUpload.persistProcedurePhotoForChatSession).toHaveBeenCalledTimes(1);
    expect(out.snapshot?.currentStep).toBe("location");
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(String(out.body?.replyText || "").toLowerCase()).toContain("foto recibida");
  });

  it("confirmación usa fieldDefinitions y no bloquea por opcional faltante", async () => {
    const waId = `${testWaId}20`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-fielddefs",
      code: "test_proc",
      name: "Trámite de prueba",
      category: "",
      fieldDefinitions: [
        { key: "description", label: "Descripción", type: "text", required: true },
        { key: "aclaracion", label: "Aclaración", type: "text", required: false },
      ],
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "",
        subcategory: "",
        location: "",
        description: "Necesito iniciar el trámite",
        risk: "",
        photoStatus: "not_requested",
        procedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        procedureCategory: "",
        procedureDetails: "Detalle base",
        procedureFieldDefinitions: [
          { key: "description", label: "Descripción", type: "text", required: true },
          { key: "aclaracion", label: "Aclaración", type: "text", required: false },
        ],
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
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    const args = createProcedureRequestSpy.mock.calls[0][0];
    expect(args.collectedData.procedureFieldDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "description", required: true }),
        expect.objectContaining({ key: "aclaracion", required: false }),
      ])
    );
    expect(args.collectedData.aclaracion).toBe("");
    expect(syncTramiteSpy).toHaveBeenCalledTimes(1);
  });

  it("campo opcional con valor se preserva en expediente y sincronización", async () => {
    const waId = `${testWaId}21`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-fielddefs",
      code: "test_proc",
      name: "Trámite de prueba",
      category: "",
      fieldDefinitions: [
        { key: "description", label: "Descripción", type: "text", required: true },
        { key: "aclaracion", label: "Aclaración", type: "text", required: false },
      ],
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      collectedData: {
        category: "",
        subcategory: "",
        location: "",
        description: "Necesito iniciar el trámite",
        risk: "",
        photoStatus: "not_requested",
        procedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        procedureCategory: "",
        procedureDetails: "Detalle base",
        procedureFieldDefinitions: [
          { key: "description", label: "Descripción", type: "text", required: true },
          { key: "aclaracion", label: "Aclaración", type: "text", required: false },
        ],
        aclaracion: "Dato opcional informado",
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
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    const args = createProcedureRequestSpy.mock.calls[0][0];
    expect(args.collectedData.aclaracion).toBe("Dato opcional informado");
    expect(syncTramiteSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        procedureCollectedData: expect.objectContaining({
          aclaracion: "Dato opcional informado",
        }),
      })
    );
  });

  it("description + photo + location deja el flujo en awaiting_confirmation con resumen", async () => {
    const waId = `${testWaId}30`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true },
      { key: "photo", label: "Foto", type: "image", required: true },
      { key: "location", label: "Ubicación", type: "location", required: true },
    ];
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "location",
      confirmationState: "none",
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        procedureCategory: "Incidencia",
        procedureFieldDefinitions: fieldDefinitions,
        description: "Hay una tapa de registro rota",
        photo: {
          filename: "evidencia.jpg",
          url: "https://files.example.test/evidencia.jpg",
        },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_location",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Av. Italia y Comercio",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION);
    expect(out.snapshot?.currentStep).toBe(CHATBOT_CURRENT_STEPS.CONFIRMATION);
    expect(out.snapshot?.confirmationState).toBe("ready");
    expect(out.snapshot?.awaitingFinalConfirmation).toBe(true);
    expect(out.snapshot?.confirmationContext).toEqual(
      expect.objectContaining({
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
      })
    );
    expect(out.snapshot?.collectedData?.description).toBe("Hay una tapa de registro rota");
    expect(out.snapshot?.collectedData?.photo).toEqual(
      expect.objectContaining({
        filename: "evidencia.jpg",
      })
    );
    expect(out.snapshot?.collectedData?.location).toEqual(
      expect.objectContaining({
        address: "Av. Italia y Comercio",
      })
    );
    expect(String(out.body?.replyText || "")).toContain("Respondé sí para confirmar");
  });

  it("después del resumen, 'Sí' confirma y crea el trámite sin volver a pedir ubicación", async () => {
    const waId = `${testWaId}31`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true },
      { key: "photo", label: "Foto", type: "image", required: true },
      { key: "location", label: "Ubicación", type: "location", required: true },
    ];
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: {
          procedureCode: "test_proc",
        },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        procedureCategory: "Incidencia",
        procedureFieldDefinitions: fieldDefinitions,
        description: "Hay una tapa de registro rota",
        photo: { filename: "evidencia.jpg", url: "https://files.example.test/evidencia.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Sí",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    const args = createProcedureRequestSpy.mock.calls[0][0];
    expect(args.procedureCode).toBe("test_proc");
    expect(args.procedureTypeId).toBe("proc-whatsapp-confirm");
    expect(args.channel).toBe("WHATSAPP");
    expect(args.whatsappWaId).toBe(waId.replace(/\D/g, ""));
    expect(Array.isArray(Object.keys(args.collectedData || {}))).toBe(true);
    expect(args.collectedData).toEqual(
      expect.objectContaining({
        description: "Hay una tapa de registro rota",
        photo: expect.objectContaining({ filename: "evidencia.jpg" }),
        location: expect.objectContaining({ address: "Av. Italia y Comercio" }),
      })
    );
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("dónde ocurrió");
    expect(String(out.body?.replyText || "")).toContain("Identificador: TRA-ABCDEF12");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("confirmation_branch WhatsApp: createProcedureRequest exitoso y mensaje con Identificador TRA-…", async () => {
    const waId = `${testWaId}311`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true },
      { key: "photo", label: "Foto", type: "image", required: true },
      { key: "location", label: "Ubicación", type: "location", required: true },
    ];
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      flowDefinition: {},
    });
    createProcedureRequestSpy.mockResolvedValueOnce({
      id: "proc-req-2",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      requestCode: "TRA-9999ABCD",
      procedureTypeId: "proc-whatsapp-confirm",
      status: "PENDING_CAMUNDA_SYNC",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: {
          procedureCode: "test_proc",
        },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        procedureCategory: "Incidencia",
        procedureFieldDefinitions: fieldDefinitions,
        description: "Hay una tapa de registro rota",
        photo: { filename: "evidencia.jpg", url: "https://files.example.test/evidencia.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(String(out.body?.replyText || "")).toContain("Identificador: TRA-9999ABCD");
  });

  it("si createProcedureRequest falla no responde registrado y devuelve error real del flujo", async () => {
    const waId = `${testWaId}312`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true },
      { key: "photo", label: "Foto", type: "image", required: true },
      { key: "location", label: "Ubicación", type: "location", required: true },
    ];
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      flowDefinition: {},
    });
    createProcedureRequestSpy.mockRejectedValueOnce(
      new Error("createProcedureRequest: simulated persistence failure")
    );

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: {
          procedureCode: "test_proc",
        },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        procedureCategory: "Incidencia",
        procedureFieldDefinitions: fieldDefinitions,
        description: "Hay una tapa de registro rota",
        photo: { filename: "evidencia.jpg", url: "https://files.example.test/evidencia.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(500);
    expect(String(out.body?.error || "").toLowerCase()).toContain("ocurrió un error al registrar");
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("registré la solicitud");
  });

  it("'Si' y 'si' confirman igual que 'sí' en confirmación final pendiente", async () => {
    const waId = `${testWaId}34`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true },
      { key: "photo", label: "Foto", type: "image", required: true },
      { key: "location", label: "Ubicación", type: "location", required: true },
    ];

    const seedSnapshot = async () =>
      setConversationState(sessionId, {
        locale: "es",
        userId: null,
        whatsappWaId: waId.replace(/\D/g, ""),
        state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
        flowKey: "procedure.general_start",
        currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: "ready",
        awaitingFinalConfirmation: true,
        confirmationContext: {
          procedureCode: "test_proc",
          procedureName: "Reportar un problema común",
          collectedDataSnapshot: { procedureCode: "test_proc" },
          shownAt: new Date().toISOString(),
        },
        collectedData: {
          procedureCode: "test_proc",
          procedureName: "Reportar un problema común",
          procedureCategory: "Incidencia",
          procedureFieldDefinitions: fieldDefinitions,
          description: "Hay una tapa de registro rota",
          photo: { filename: "evidencia.jpg", url: "https://files.example.test/evidencia.jpg" },
          location: { address: "Av. Italia y Comercio", locationSource: "whatsapp_location" },
        },
        lastInterpretation: {},
        lastIntent: "start_procedure",
        lastAction: "procedure_ready",
        lastConfidence: null,
      });

    getProcedureByCodeSpy.mockResolvedValue({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      flowDefinition: {},
    });

    await seedSnapshot();
    const outUpper = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(outUpper.status).toBe(200);
    expect(outUpper.snapshot?.flowKey).toBeNull();

    await seedSnapshot();
    const outLower = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(outLower.status).toBe(200);
    expect(outLower.snapshot?.flowKey).toBeNull();
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(2);
  });

  it("si currentStep es location pero awaitingFinalConfirmation=true, igual confirma", async () => {
    const waId = `${testWaId}35`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions: [
        { key: "description", label: "Descripción", type: "text", required: true },
        { key: "photo", label: "Foto", type: "image", required: true },
        { key: "location", label: "Ubicación", type: "location", required: true },
      ],
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "location",
      confirmationState: "none",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: { procedureCode: "test_proc" },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        description: "Hay una tapa de registro rota",
        photo: { filename: "evidencia.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("si confirmationState no es ready pero awaitingFinalConfirmation=true, igual confirma", async () => {
    const waId = `${testWaId}36`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-whatsapp-confirm",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions: [
        { key: "description", label: "Descripción", type: "text", required: true },
        { key: "photo", label: "Foto", type: "image", required: true },
        { key: "location", label: "Ubicación", type: "location", required: true },
      ],
      flowDefinition: {},
    });

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "none",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: { procedureCode: "test_proc" },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        description: "Hay una tapa de registro rota",
        photo: { filename: "evidencia.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "ok",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("después del resumen, 'No' no crea trámite y cancela según la lógica actual", async () => {
    const waId = `${testWaId}32`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: { procedureCode: "test_proc" },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "No",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).not.toHaveBeenCalled();
    expect(out.body?.nextStep?.type).toBe("cancelled");
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("después del resumen, 'Cancelar' cancela sesión sin registrar", async () => {
    const waId = `${testWaId}33`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        collectedDataSnapshot: { procedureCode: "test_proc" },
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Cancelar",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).not.toHaveBeenCalled();
    expect(out.body?.nextStep?.type).toBe("cancelled");
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("flujo completo hasta resumen y 'si' registra sin volver a pedir ubicación", async () => {
    const waId = `${testWaId}37`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    const fieldDefinitions = [
      { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
      { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
      { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
    ];

    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        flowKey: "procedure.general_start",
        promptType: "final_summary_confirm",
        lastAssistantPrompt: "¿Confirmás que registre esta incidencia con estos datos?",
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        procedureFieldDefinitions: fieldDefinitions,
        description: "Hay un contenedor desbordado",
        photo: { filename: "demo.jpg", url: "https://files.example.test/demo.jpg" },
        location: { address: "Av. Italia y Comercio" },
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    getProcedureByCodeSpy.mockResolvedValueOnce({
      id: "proc-demo",
      code: "test_proc",
      name: "Reportar un problema común",
      category: "Incidencia",
      fieldDefinitions,
      requiredFields: fieldDefinitions,
      flowDefinition: {},
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "si",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(createProcedureRequestSpy).toHaveBeenCalledTimes(1);
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("dónde ocurrió");
    expect(out.snapshot?.flowKey).toBeNull();
  });

  it("resumen -> cancelar -> hola arranca limpio", async () => {
    const waId = `${testWaId}38`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      flowKey: "procedure.general_start",
      currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
      confirmationState: "ready",
      awaitingFinalConfirmation: true,
      confirmationContext: {
        flowKey: "procedure.general_start",
        promptType: "final_summary_confirm",
        lastAssistantPrompt: "¿Confirmás que registre esta incidencia con estos datos?",
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        shownAt: new Date().toISOString(),
      },
      collectedData: {
        procedureCode: "test_proc",
        procedureName: "Reportar un problema común",
        selectedProcedureCode: "test_proc",
        pendingProcedureCode: "test_proc",
        description: "Texto viejo",
        location: "Texto viejo",
        draft: "viejo",
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_ready",
      lastConfidence: null,
    });

    const cancelled = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "cancelar",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.snapshot?.flowKey).toBeNull();
    expect(cancelled.snapshot?.awaitingFinalConfirmation).toBe(false);
    expect(cancelled.snapshot?.confirmationContext).toBeNull();

    const hello = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "Hola",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(String(hello.body?.replyText || "").toLowerCase()).not.toContain("dónde ocurrió");
    expect(hello.snapshot?.awaitingFinalConfirmation).toBe(false);
    expect(hello.snapshot?.confirmationContext).toBeNull();
  });

  it("ubicación estructurada en WhatsApp mantiene flowKey de procedimiento", async () => {
    const waId = `${testWaId}39`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "location",
      confirmationState: "none",
      awaitingFinalConfirmation: false,
      confirmationContext: null,
      collectedData: {
        procedureCode: "test_proc",
        selectedProcedureCode: "test_proc",
        pendingProcedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        description: "Hay un problema",
        photo: { filename: "evidencia.jpg", url: "https://cdn.test/evidencia.jpg" },
        procedureRequiredFields: [
          { key: "description", label: "Descripción", type: "text", required: true },
          { key: "photo", label: "Foto", type: "image", required: true },
          { key: "location", label: "Ubicación", type: "location", required: true },
        ],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_location",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: {
        type: "location",
        latitude: -34.8915,
        longitude: -56.1645,
        addressText: "Av. Italia y Comercio",
      },
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION);
    expect(out.snapshot?.collectedData?.location).toMatchObject({
      address: "Av. Italia y Comercio",
      locationSource: "whatsapp_location",
    });
    expect(String(out.body?.replyText || "").toLowerCase()).toContain("respondé sí");
  });

  it("con procedureCode activo no ejecuta rama incident.general", async () => {
    const waId = `${testWaId}40`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "procedure.general_start",
      currentStep: "description",
      confirmationState: "none",
      awaitingFinalConfirmation: false,
      confirmationContext: null,
      collectedData: {
        procedureCode: "test_proc",
        selectedProcedureCode: "test_proc",
        pendingProcedureCode: "test_proc",
        procedureName: "Trámite de prueba",
        description: "",
        procedureRequiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
      },
      lastInterpretation: {},
      lastIntent: "start_procedure",
      lastAction: "procedure_step_description",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "quiero reportar una incidencia urgente",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBe("procedure.general_start");
    expect(out.snapshot?.collectedData?.procedureCode).toBe("test_proc");
    expect(out.snapshot?.collectedData?.category || "").not.toBe("incidencia_general");
  });

  it("sesión mixta vieja se resetea limpiamente", async () => {
    const waId = `${testWaId}41`;
    const sessionId = buildWhatsAppAssistantSessionId(waId);
    await setConversationState(sessionId, {
      locale: "es",
      userId: null,
      whatsappWaId: waId.replace(/\D/g, ""),
      state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      flowKey: "incident.general",
      currentStep: "location",
      confirmationState: "none",
      awaitingFinalConfirmation: false,
      confirmationContext: null,
      collectedData: {
        procedureCode: "test_proc",
        selectedProcedureCode: "test_proc",
        pendingProcedureCode: "test_proc",
        description: "estado mezclado",
      },
      lastInterpretation: {},
      lastIntent: "report_incident",
      lastAction: "incident_step_location",
      lastConfidence: null,
    });

    const out = await processAssistantTurn({
      channel: "whatsapp",
      sessionId,
      text: "hola",
      authenticatedUser: null,
      whatsappWaId: waId,
      channelInbound: null,
    });

    expect(out.status).toBe(200);
    expect(out.snapshot?.flowKey).toBeNull();
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
    expect(out.snapshot?.collectedData?.procedureCode || "").toBe("");
    expect(String(out.body?.replyText || "").toLowerCase()).toContain("reinici");
  });

});

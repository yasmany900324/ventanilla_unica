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
    expect(String(out.body?.replyText || "").toLowerCase()).not.toContain("dónde ocurrió");
    expect(out.snapshot?.state).toBe(CHATBOT_CONVERSATION_STATES.IDLE);
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

});

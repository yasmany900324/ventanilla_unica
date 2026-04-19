import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/auth";
import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  clearIncidentDraft,
  getSessionSnapshot,
  setConversationState,
  setSessionUserId,
} from "../../../../lib/chatSessionStore";
import { validateChatMessagePayload } from "../../../../lib/chatbotPayloadValidation";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../../../../lib/i18n";
import { detectLocaleFromText } from "../../../../lib/languageDetection";
import { createIncident } from "../../../../lib/incidents";
import {
  FLOW_KEY_TREE,
  FLOW_KEY_PROCEDURE,
  buildAuthRequiredReply,
  buildCancelledIncidentReply,
  buildConfirmationActionOptions,
  buildIncidentCreatedReply,
  buildIncidentResumeReply,
  buildProcedureDetailsReply,
  buildProcedureStartReply,
  buildProcedureSummaryReply,
  buildPhotoActionOptions,
  buildQuestionForStep,
  buildTreeFlowSeedFromContext,
  createTreeFlowSnapshotPatch,
  getNextTreeFlowStep,
  isProcedureFlowActive,
  isTreeFlowActive,
  mergeCollectedDataFromInterpretation,
  parseUserCommandFromText,
  shouldActivateTreeFlow,
  shouldSwitchToIncidentFlow,
  shouldSwitchToProcedureFlow,
  createProcedureFlowSnapshotPatch,
} from "../../../../lib/chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "../../../../lib/chatbotTelemetry";
import { interpretUserMessage } from "../../../../lib/llmService";

export const runtime = "nodejs";

const EMPTY_COLLECTED_DATA = {
  category: "",
  subcategory: "",
  location: "",
  description: "",
  risk: "",
  photoStatus: "not_requested",
  procedureName: "",
  procedureDetails: "",
};

function getDefaultSnapshot() {
  return {
    locale: null,
    userId: null,
    state: CHATBOT_CONVERSATION_STATES.IDLE,
    flowKey: null,
    currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
    confirmationState: "none",
    collectedData: { ...EMPTY_COLLECTED_DATA },
    missingFields: [],
    lastInterpretation: {},
    lastIntent: null,
    lastAction: null,
    lastConfidence: null,
  };
}

function getRequiredMissingFields(collectedData) {
  const missing = [];
  if (!collectedData?.location) {
    missing.push("location");
  }
  if (!collectedData?.description) {
    missing.push("description");
  }
  if (!collectedData?.risk) {
    missing.push("risk");
  }
  return missing;
}

function mapFieldToStep(fieldName) {
  if (fieldName === "location") {
    return CHATBOT_CURRENT_STEPS.LOCATION;
  }
  if (fieldName === "description") {
    return CHATBOT_CURRENT_STEPS.DESCRIPTION;
  }
  if (fieldName === "risk") {
    return CHATBOT_CURRENT_STEPS.RISK;
  }
  return CHATBOT_CURRENT_STEPS.PHOTO;
}

function buildModeFromSnapshot(snapshot) {
  if (snapshot?.flowKey === FLOW_KEY_TREE) {
    return "incident";
  }
  if (snapshot?.flowKey === FLOW_KEY_PROCEDURE) {
    return "procedure";
  }
  return "unknown";
}

function getProcedureMissingFields(collectedData) {
  const missing = [];
  if (!collectedData?.procedureName) {
    missing.push("procedureName");
  }
  if (!collectedData?.procedureDetails) {
    missing.push("procedureDetails");
  }
  return missing;
}

function isMeaningfulProcedureName(text) {
  if (!text || typeof text !== "string") {
    return false;
  }

  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return false;
  }

  const genericProcedurePhrases = new Set([
    "quiero iniciar un tramite",
    "necesito hacer un tramite",
    "iniciar tramite",
    "iniciar un tramite",
    "hacer un tramite",
    "tramite",
    "trámite",
    "necesito iniciar un tramite",
  ]);
  return !genericProcedurePhrases.has(normalized);
}

function normalizeProcedureText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeIntentLookup(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldSwitchToStatusIntent({ text, interpretation }) {
  const normalized = normalizeIntentLookup(text);
  if (normalized) {
    const statusKeywords = [
      "consultar estado",
      "estado de tramite",
      "estado del tramite",
      "estado de solicitud",
      "estado de mi solicitud",
      "seguimiento",
      "ver estado",
      "consultar tramite",
    ];
    if (statusKeywords.some((keyword) => normalized.includes(keyword))) {
      return true;
    }
  }

  const intentKind = interpretation?.intent?.kind || "unknown";
  const confidence = interpretation?.intent?.confidence || 0;
  return intentKind === "check_status" && confidence >= 0.6;
}

function buildProcedureActionOptions({ nextMissingField = null, isCompleted = false } = {}) {
  const options = [
    {
      label: "Buscar trámite",
      command: "none",
      value: "Quiero buscar un trámite específico.",
      commandField: null,
    },
    {
      label: "Ver categorías de trámites",
      command: "none",
      value: "Quiero ver categorías de trámites disponibles.",
      commandField: null,
    },
    {
      label: "Describir lo que necesito gestionar",
      command: "none",
      value: "Te describo lo que necesito gestionar.",
      commandField: null,
    },
    {
      label: "Consultar estado de trámite",
      command: "none",
      value: "Quiero consultar el estado de un trámite.",
      commandField: null,
    },
  ];

  if (isCompleted) {
    return options.filter((option) =>
      option.label === "Buscar trámite" ||
      option.label === "Ver categorías de trámites" ||
      option.label === "Consultar estado de trámite"
    );
  }
  if (nextMissingField === "procedureDetails") {
    return options.filter((option) =>
      option.label === "Describir lo que necesito gestionar" ||
      option.label === "Ver categorías de trámites" ||
      option.label === "Consultar estado de trámite"
    );
  }

  return options;
}

function buildClarificationActionOptions() {
  return [
    {
      label: "Iniciar trámite",
      command: "none",
      value: "Quiero iniciar un trámite.",
      commandField: null,
    },
    {
      label: "Reportar incidencia",
      command: "none",
      value: "Quiero reportar una incidencia.",
      commandField: null,
    },
    {
      label: "Consultar estado",
      command: "none",
      value: "Quiero consultar el estado de mi solicitud.",
      commandField: null,
    },
  ];
}

function buildStatusActionOptions() {
  return [
    {
      label: "Ver mis incidencias",
      command: "none",
      value: "Quiero ver mis incidencias.",
      commandField: null,
    },
    {
      label: "Consultar con número de ticket",
      command: "none",
      value: "Quiero consultar con mi número de ticket.",
      commandField: null,
    },
    {
      label: "Iniciar trámite",
      command: "none",
      value: "Quiero iniciar un trámite.",
      commandField: null,
    },
    {
      label: "Reportar incidencia",
      command: "none",
      value: "Quiero reportar una incidencia.",
      commandField: null,
    },
  ];
}

function buildStatusReply() {
  return "Entiendo. Te ayudo a consultar el estado de tu solicitud. Puedes revisar tus casos en 'Mis incidencias' o indicarme el número de ticket para orientarte.";
}

function buildChatResponse({
  sessionId,
  locale,
  replyText,
  snapshot,
  actionOptions = [],
  nextStepType,
  nextStepField = null,
  redirectTo = null,
  redirectLabel = null,
  needsClarification = false,
  incident = null,
}) {
  const collectedData = snapshot?.collectedData || EMPTY_COLLECTED_DATA;
  const mode = buildModeFromSnapshot(snapshot);
  const missingFields =
    mode === "procedure"
      ? getProcedureMissingFields(collectedData)
      : mode === "incident"
        ? getRequiredMissingFields(collectedData)
        : [];

  return NextResponse.json({
    sessionId,
    locale,
    replyText,
    intent: snapshot?.lastIntent || null,
    confidence: snapshot?.lastConfidence || null,
    fulfillmentMessages: [],
    action: snapshot?.lastAction || null,
    parameters: {},
    mode,
    draft: {
      ...collectedData,
      missingFields,
    },
    nextStep: {
      type: nextStepType,
      field: nextStepField,
    },
    actionOptions,
    redirectTo,
    redirectLabel,
    needsClarification,
    incident,
  });
}

function resolveEffectiveLocale({ preferredLocale, sessionLocale, text, request }) {
  const detectedTextLocale = detectLocaleFromText(text);
  const selectedLocale =
    preferredLocale ||
    sessionLocale ||
    detectedTextLocale ||
    resolveLocaleFromAcceptLanguage(request.headers.get("accept-language")) ||
    normalizeLocale(request.headers.get("accept-language")) ||
    getDefaultLocale();

  return normalizeLocale(selectedLocale) || getDefaultLocale();
}

export async function GET() {
  return NextResponse.json(
    { error: "Método no permitido. Usa POST para enviar mensajes al chatbot." },
    { status: 405 }
  );
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { error: "La solicitud no tiene un formato JSON válido." },
      { status: 400 }
    );
  }

  const validationResult = validateChatMessagePayload(body);
  if (!validationResult.ok) {
    return NextResponse.json({ error: validationResult.error }, { status: 400 });
  }

  const {
    text,
    sessionId,
    preferredLocale,
    command: commandFromPayload,
    commandField: commandFieldFromPayload,
    contextEntry,
  } = validationResult.value;

  const authenticatedUser = await requireAuthenticatedUser(request);
  let snapshot = (await getSessionSnapshot(sessionId)) || getDefaultSnapshot();
  if (authenticatedUser?.id && snapshot.userId !== authenticatedUser.id) {
    await setSessionUserId(sessionId, authenticatedUser.id);
    snapshot = {
      ...snapshot,
      userId: authenticatedUser.id,
    };
  }

  const effectiveLocale = resolveEffectiveLocale({
    preferredLocale,
    sessionLocale: snapshot.locale,
    text,
    request,
  });
  const trackEvent = async (partialPayload) => {
    await trackChatbotEvent({
      sessionId,
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      command: commandFromPayload,
      ...partialPayload,
    });
  };

  await trackEvent({
    eventName: CHATBOT_TELEMETRY_EVENTS.TURN_RECEIVED,
    mode: buildModeFromSnapshot(snapshot),
    details: text ? "user_turn_with_text" : "user_turn_command_only",
  });

  let effectiveCommand = commandFromPayload;
  let effectiveCommandField = commandFieldFromPayload;
  if (effectiveCommand === "none" && text) {
    const parsedCommand = parseUserCommandFromText(text);
    if (parsedCommand.command !== "none") {
      effectiveCommand = parsedCommand.command;
      effectiveCommandField = parsedCommand.commandField;
    }
  }

  const isTreeContextStart =
    (effectiveCommand === "start_contextual_flow" ||
      effectiveCommand === "start_contextual_entry") &&
    contextEntry &&
    shouldActivateTreeFlow({
      interpretation: null,
      text: `${contextEntry.title || ""} ${contextEntry.description || ""}`,
      contextEntry,
    });

  if (isTreeContextStart) {
    const seededData = buildTreeFlowSeedFromContext(contextEntry);
    const nextStep = getNextTreeFlowStep(seededData);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";
    const patch = createTreeFlowSnapshotPatch({
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      collectedData: seededData,
      currentStep: nextStep,
      confirmationState,
      lastInterpretation: {},
      lastIntent: "report_incident",
      lastAction: effectiveCommand,
      lastConfidence: null,
      state: nextState,
    });
    const savedSnapshot = await setConversationState(sessionId, patch);
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      funnelStep: CHATBOT_FUNNEL_STEPS.ENTERED_INCIDENT_FLOW,
      mode: "incident",
      outcome: "home_card_context",
    });

    if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
        mode: "incident",
        outcome: "ready_from_context",
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentResumeReply(savedSnapshot.collectedData),
        snapshot: savedSnapshot,
        actionOptions: buildConfirmationActionOptions(),
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    const actionOptions =
      nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [];
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({ step: nextStep }),
      snapshot: savedSnapshot,
      actionOptions,
      nextStepType: "ask_field",
      nextStepField: nextStep,
    });
  }

  if (effectiveCommand === "cancel") {
    await clearIncidentDraft(sessionId);
    const clearedSnapshot = await getSessionSnapshot(sessionId);
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CANCELLED,
      funnelStep: CHATBOT_FUNNEL_STEPS.CANCELLED,
      mode: "incident",
      outcome: "cancelled_by_user",
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildCancelledIncidentReply(),
      snapshot: clearedSnapshot || getDefaultSnapshot(),
      nextStepType: "cancelled",
      nextStepField: null,
    });
  }

  if (effectiveCommand === "edit_field" && isTreeFlowActive(snapshot)) {
    const targetStep = mapFieldToStep(effectiveCommandField);
    const resetCollectedData = {
      ...snapshot.collectedData,
    };
    if (targetStep === CHATBOT_CURRENT_STEPS.LOCATION) {
      resetCollectedData.location = "";
    } else if (targetStep === CHATBOT_CURRENT_STEPS.DESCRIPTION) {
      resetCollectedData.description = "";
    } else if (targetStep === CHATBOT_CURRENT_STEPS.RISK) {
      resetCollectedData.risk = "";
    } else if (targetStep === CHATBOT_CURRENT_STEPS.PHOTO) {
      resetCollectedData.photoStatus = "not_requested";
    }
    const updatedSnapshot = await setConversationState(
      sessionId,
      createTreeFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: resetCollectedData,
        currentStep: targetStep,
        confirmationState: "none",
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: effectiveCommand,
        lastConfidence: snapshot.lastConfidence,
        state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      })
    );

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({ step: targetStep }),
      snapshot: updatedSnapshot,
      actionOptions:
        targetStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
      nextStepType: "ask_field",
      nextStepField: targetStep,
    });
  }

  if (
    (effectiveCommand === "set_photo_pending" || effectiveCommand === "skip_photo") &&
    isTreeFlowActive(snapshot)
  ) {
    const updatedData = {
      ...snapshot.collectedData,
      photoStatus: effectiveCommand === "set_photo_pending" ? "pending_upload" : "skipped",
    };
    const nextStep = getNextTreeFlowStep(updatedData);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";

    const updatedSnapshot = await setConversationState(
      sessionId,
      createTreeFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: updatedData,
        currentStep: nextStep,
        confirmationState,
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: effectiveCommand,
        lastConfidence: snapshot.lastConfidence,
        state: nextState,
      })
    );

    if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
        mode: "incident",
        outcome: "ready_after_photo_step",
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentResumeReply(updatedData),
        snapshot: updatedSnapshot,
        actionOptions: buildConfirmationActionOptions(),
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({ step: nextStep }),
      snapshot: updatedSnapshot,
      actionOptions:
        nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
      nextStepType: "ask_field",
      nextStepField: nextStep,
    });
  }

  if (effectiveCommand === "resume_confirmation" && isTreeFlowActive(snapshot)) {
    const missingFields = getRequiredMissingFields(snapshot.collectedData);
    if (missingFields.length > 0) {
      const nextStep = mapFieldToStep(missingFields[0]);
      const updatedSnapshot = await setConversationState(
        sessionId,
        createTreeFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: snapshot.collectedData,
          currentStep: nextStep,
          confirmationState: "none",
          lastInterpretation: snapshot.lastInterpretation,
          lastIntent: snapshot.lastIntent || "report_incident",
          lastAction: effectiveCommand,
          lastConfidence: snapshot.lastConfidence,
          state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        })
      );

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({ step: nextStep }),
        snapshot: updatedSnapshot,
        actionOptions:
          nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        nextStepType: "ask_field",
        nextStepField: nextStep,
      });
    }

    const updatedSnapshot = await setConversationState(
      sessionId,
      createTreeFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: snapshot.collectedData,
        currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: "ready",
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: effectiveCommand,
        lastConfidence: snapshot.lastConfidence,
        state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      })
    );

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildIncidentResumeReply(snapshot.collectedData),
      snapshot: updatedSnapshot,
      actionOptions: buildConfirmationActionOptions(),
      nextStepType: "confirm_incident",
      nextStepField: null,
    });
  }

  if (effectiveCommand === "confirm" && isTreeFlowActive(snapshot)) {
    const missingFields = getRequiredMissingFields(snapshot.collectedData);
    if (missingFields.length > 0) {
      const nextStep = mapFieldToStep(missingFields[0]);
      const updatedSnapshot = await setConversationState(
        sessionId,
        createTreeFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: snapshot.collectedData,
          currentStep: nextStep,
          confirmationState: "none",
          lastInterpretation: snapshot.lastInterpretation,
          lastIntent: snapshot.lastIntent || "report_incident",
          lastAction: effectiveCommand,
          lastConfidence: snapshot.lastConfidence,
          state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        })
      );

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({ step: nextStep }),
        snapshot: updatedSnapshot,
        actionOptions:
          nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        nextStepType: "ask_field",
        nextStepField: nextStep,
      });
    }

    if (!authenticatedUser?.id) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.AUTH_REQUIRED,
        funnelStep: CHATBOT_FUNNEL_STEPS.AUTH_REQUIRED,
        mode: "incident",
        outcome: "auth_required_before_creation",
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildAuthRequiredReply(),
        snapshot,
        actionOptions: [],
        nextStepType: "auth_required",
        nextStepField: null,
        redirectTo: "/login",
        redirectLabel: "Iniciar sesión",
      });
    }

    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      funnelStep: CHATBOT_FUNNEL_STEPS.CONFIRMED,
      mode: "incident",
      outcome: "user_confirmed",
    });

    try {
      const descriptionWithRisk = `${snapshot.collectedData.description} (Riesgo: ${snapshot.collectedData.risk})`;
      const incident = await createIncident({
        userId: authenticatedUser.id,
        category: snapshot.collectedData.category || "infraestructura",
        description: descriptionWithRisk,
        location: snapshot.collectedData.location,
      });

      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser.id,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: FLOW_KEY_TREE,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "confirmed",
        collectedData: snapshot.collectedData,
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: "report_incident",
        lastAction: "incident_created",
        lastConfidence: snapshot.lastConfidence,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.INCIDENT_CREATED,
        funnelStep: CHATBOT_FUNNEL_STEPS.INCIDENT_CREATED,
        mode: "incident",
        outcome: "success",
        incidentId: incident.id,
      });

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentCreatedReply({ incidentId: incident.id }),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
        redirectTo: `/mis-incidencias?incidentId=${encodeURIComponent(incident.id)}`,
        redirectLabel: "Ir a Mis incidencias",
        incident: {
          id: incident.id,
          status: incident.status,
          category: incident.category,
          location: incident.location,
        },
      });
    } catch (error) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "incident",
        outcome: "incident_creation_failed",
        details: error?.message || null,
      });
      return NextResponse.json(
        {
          error:
            "Ocurrió un error al crear la incidencia desde el chat. Intenta nuevamente en unos segundos.",
        },
        { status: 500 }
      );
    }
  }

  let interpretation = snapshot.lastInterpretation || {};
  let llmMeta = { source: "fallback", reason: "not_called" };
  if (text) {
    const llmResult = await interpretUserMessage({
      text,
      locale: effectiveLocale,
      sessionContext: {
        flowKey: snapshot.flowKey,
        currentStep: snapshot.currentStep,
        confirmationState: snapshot.confirmationState,
        collectedData: snapshot.collectedData,
      },
    });
    interpretation = llmResult.interpretation || {};
    llmMeta = llmResult.meta || llmMeta;

    if (llmMeta.source === "fallback") {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.LLM_FALLBACK_USED,
        mode: buildModeFromSnapshot(snapshot),
        outcome: llmMeta.reason || "unknown",
      });
    }
  }

  const switchToProcedure =
    shouldSwitchToProcedureFlow({ text, interpretation }) && !isProcedureFlowActive(snapshot);
  const switchToStatus = shouldSwitchToStatusIntent({ text, interpretation });

  if (switchToStatus) {
    const statusSnapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      confirmationState: "none",
      collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
      lastInterpretation: interpretation,
      lastIntent: "check_status",
      lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
      lastConfidence: interpretation?.intent?.confidence || null,
    });

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildStatusReply(),
      snapshot: statusSnapshot,
      actionOptions: buildStatusActionOptions(),
      nextStepType: "check_status",
      nextStepField: null,
      redirectTo: "/mis-incidencias",
      redirectLabel: "Ver mis incidencias",
      needsClarification: false,
    });
  }

  if (switchToProcedure) {
    const normalizedText = normalizeProcedureText(text, 320);
    const normalizedProcedureName = normalizeProcedureText(normalizedText, 160);
    const currentProcedureName = snapshot?.collectedData?.procedureName || "";
    const currentProcedureDetails = snapshot?.collectedData?.procedureDetails || "";
    const procedureName =
      currentProcedureName ||
      (isMeaningfulProcedureName(normalizedProcedureName) ? normalizedProcedureName : "");
    const procedureDetails = currentProcedureDetails || "";
    const procedureMissing = getProcedureMissingFields({
      procedureName,
      procedureDetails,
    });
    const procedureStep =
      procedureMissing[0] === "procedureDetails" ? CHATBOT_CURRENT_STEPS.DESCRIPTION : CHATBOT_CURRENT_STEPS.LOCATION;
    const procedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: {
          ...EMPTY_COLLECTED_DATA,
          procedureName,
          procedureDetails,
        },
        currentStep: procedureStep,
        confirmationState: "none",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "switch_to_procedure",
        lastConfidence: interpretation?.intent?.confidence || null,
      })
    );
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      mode: "procedure",
      outcome: snapshot?.flowKey === FLOW_KEY_TREE ? "switch_incident_to_procedure" : "procedure_text_detection",
    });
    const procedureReply =
      procedureMissing[0] === "procedureDetails"
        ? buildProcedureDetailsReply(procedureName)
        : buildProcedureStartReply();
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: procedureReply,
      snapshot: procedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField: procedureMissing[0] || "procedureName",
        isCompleted: procedureMissing.length === 0,
      }),
      nextStepType: "ask_field",
      nextStepField: procedureMissing[0] || "procedureName",
      needsClarification: false,
    });
  }

  if (isProcedureFlowActive(snapshot)) {
    const procedureSwitchToIncident =
      shouldSwitchToIncidentFlow({ text, interpretation }) ||
      shouldActivateTreeFlow({
        interpretation,
        text,
        contextEntry,
      });
    if (procedureSwitchToIncident) {
      const treeSeed = {
        ...EMPTY_COLLECTED_DATA,
        category: "infraestructura",
        subcategory: "arbol_caido_ramas_peligrosas",
      };
      const mergedFromSwitch = mergeCollectedDataFromInterpretation({
        collectedData: treeSeed,
        interpretation,
        text,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      });
      const nextTreeStep = getNextTreeFlowStep(mergedFromSwitch.collectedData);
      const switchedSnapshot = await setConversationState(
        sessionId,
        createTreeFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: mergedFromSwitch.collectedData,
          currentStep: nextTreeStep,
          confirmationState:
            nextTreeStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none",
          lastInterpretation: interpretation,
          lastIntent: "report_incident",
          lastAction: "switch_to_incident",
          lastConfidence: interpretation?.intent?.confidence || null,
        })
      );
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
        mode: "incident",
        outcome: "switch_procedure_to_incident",
      });

      if (nextTreeStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
        return buildChatResponse({
          sessionId,
          locale: effectiveLocale,
          replyText: buildIncidentResumeReply(mergedFromSwitch.collectedData),
          snapshot: switchedSnapshot,
          actionOptions: buildConfirmationActionOptions(),
          nextStepType: "confirm_incident",
          nextStepField: null,
        });
      }

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({
          step: nextTreeStep,
          suggestedReply: interpretation?.assistantStyle?.suggestedReply || null,
        }),
        snapshot: switchedSnapshot,
        actionOptions:
          nextTreeStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        nextStepType: "ask_field",
        nextStepField: nextTreeStep,
      });
    }

    const normalizedText = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    const procedureData = {
      ...snapshot.collectedData,
      procedureName: snapshot.collectedData?.procedureName || "",
      procedureDetails: snapshot.collectedData?.procedureDetails || "",
    };
    let hasProcedureUpdate = false;
    if (normalizedText) {
      if (!procedureData.procedureName) {
        if (isMeaningfulProcedureName(normalizedText)) {
          procedureData.procedureName = normalizeProcedureText(normalizedText, 160);
          hasProcedureUpdate = true;
        }
      } else if (!procedureData.procedureDetails) {
        procedureData.procedureDetails = normalizeProcedureText(normalizedText, 320);
        hasProcedureUpdate = true;
      } else if (effectiveCommand === "edit_field" && effectiveCommandField === "description") {
        procedureData.procedureDetails = normalizeProcedureText(normalizedText, 320);
        hasProcedureUpdate = true;
      } else if (effectiveCommand === "edit_field" && effectiveCommandField === "location") {
        procedureData.procedureName = normalizeProcedureText(normalizedText, 160);
        hasProcedureUpdate = true;
      }
    }

    const procedureMissing = getProcedureMissingFields(procedureData);
    const procedureStep =
      procedureMissing[0] === "procedureDetails"
        ? CHATBOT_CURRENT_STEPS.DESCRIPTION
        : procedureMissing[0] === "procedureName"
          ? CHATBOT_CURRENT_STEPS.LOCATION
          : CHATBOT_CURRENT_STEPS.CONFIRMATION;
    const updatedProcedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: procedureData,
        currentStep: procedureStep,
        confirmationState: procedureMissing.length > 0 ? "none" : "ready",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
        lastConfidence: interpretation?.intent?.confidence || null,
      })
    );

    if (procedureMissing.length === 0) {
      const replyText = hasProcedureUpdate
        ? buildProcedureSummaryReply({
            procedureName: procedureData.procedureName,
            procedureDetails: procedureData.procedureDetails,
          })
        : "Ya tengo la información inicial del trámite. Siguiente paso: puedo ayudarte a buscar el trámite exacto por nombre o por categoría, o consultar su estado.";
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText,
        snapshot: updatedProcedureSnapshot,
        actionOptions: buildProcedureActionOptions({
          isCompleted: true,
        }),
        nextStepType: "procedure_guided",
        nextStepField: null,
      });
    }

    const procedureReply =
      procedureMissing[0] === "procedureName"
        ? buildProcedureStartReply()
        : buildProcedureDetailsReply(procedureData.procedureName);
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: procedureReply,
      snapshot: updatedProcedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField: procedureMissing[0],
        isCompleted: false,
      }),
      nextStepType: "ask_field",
      nextStepField: procedureMissing[0],
    });
  }

  if (
    isTreeFlowActive(snapshot) &&
    shouldSwitchToProcedureFlow({ text, interpretation })
  ) {
    const procedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: {
          ...EMPTY_COLLECTED_DATA,
          procedureName: "",
          procedureDetails: "",
        },
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "switch_incident_to_procedure",
        lastConfidence: interpretation?.intent?.confidence || null,
      })
    );
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      mode: "procedure",
      outcome: "switch_incident_to_procedure_by_llm",
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildProcedureStartReply(),
      snapshot: procedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField: "procedureName",
        isCompleted: false,
      }),
      nextStepType: "ask_field",
      nextStepField: "procedureName",
    });
  }

  if (!isTreeFlowActive(snapshot)) {
    const shouldActivate = shouldActivateTreeFlow({
      interpretation,
      text,
      contextEntry,
    });

    if (!shouldActivate) {
      await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: interpretation?.intent?.kind || "unknown",
        lastAction: effectiveCommand || "none",
        lastConfidence: interpretation?.intent?.confidence || null,
      });

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Puedo ayudarte a reportar una incidencia o a iniciar un trámite. Dime qué quieres hacer y te guío con el siguiente paso.",
        snapshot: {
          ...snapshot,
          locale: effectiveLocale,
          lastInterpretation: interpretation,
          lastIntent: interpretation?.intent?.kind || "unknown",
          lastAction: effectiveCommand || "none",
          lastConfidence: interpretation?.intent?.confidence || null,
        },
        actionOptions: buildClarificationActionOptions(),
        nextStepType: "clarify",
        nextStepField: null,
        needsClarification: true,
      });
    }

    const seedData = contextEntry
      ? buildTreeFlowSeedFromContext(contextEntry)
      : {
          ...EMPTY_COLLECTED_DATA,
          category: "infraestructura",
          subcategory: "arbol_caido_ramas_peligrosas",
        };
    snapshot = await setConversationState(
      sessionId,
      createTreeFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: seedData,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        lastInterpretation: interpretation,
        lastIntent: interpretation?.intent?.kind || "report_incident",
        lastAction: effectiveCommand || "flow_activated",
        lastConfidence: interpretation?.intent?.confidence || null,
        state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
      })
    );
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      funnelStep: CHATBOT_FUNNEL_STEPS.ENTERED_INCIDENT_FLOW,
      mode: "incident",
      outcome: "text_detection",
    });
  }

  const mergedResult = mergeCollectedDataFromInterpretation({
    collectedData: snapshot.collectedData,
    interpretation,
    text,
    currentStep: snapshot.currentStep,
  });
  if (effectiveCommand === "edit_field" && effectiveCommandField) {
    if (effectiveCommandField === "location") {
      mergedResult.collectedData.location = text;
    } else if (effectiveCommandField === "description") {
      mergedResult.collectedData.description = text;
    } else if (effectiveCommandField === "risk") {
      mergedResult.collectedData.risk = text;
    }
  }
  const mergedData = mergedResult.collectedData;
  const nextStep = getNextTreeFlowStep(mergedData);
  const isReadyForConfirmation = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION;

  if (mergedResult.acceptedEntities.length > 0) {
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_ACCEPTED,
      mode: "incident",
      outcome: mergedResult.acceptedEntities.join(","),
    });
  }
  if (mergedResult.rejectedEntities.length > 0) {
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_REJECTED,
      mode: "incident",
      outcome: mergedResult.rejectedEntities.join(","),
    });
  }

  const currentStepHasLowConfidence = mergedResult.lowConfidenceFields.includes(nextStep);
  if (currentStepHasLowConfidence) {
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.LOW_CONFIDENCE_REPROMPT,
      mode: "incident",
      fieldName: nextStep,
      outcome: "reprompt",
    });
  }

  const nextState = isReadyForConfirmation
    ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
    : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
  const confirmationState = isReadyForConfirmation ? "ready" : "none";

  const savedSnapshot = await setConversationState(
    sessionId,
    createTreeFlowSnapshotPatch({
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      collectedData: mergedData,
      currentStep: nextStep,
      confirmationState,
      lastInterpretation: interpretation,
      lastIntent: interpretation?.intent?.kind || "report_incident",
      lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
      lastConfidence: interpretation?.intent?.confidence || null,
      state: nextState,
    })
  );

  if (isReadyForConfirmation) {
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
      mode: "incident",
      outcome: "ready_after_data_capture",
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildIncidentResumeReply(mergedData),
      snapshot: savedSnapshot,
      actionOptions: buildConfirmationActionOptions(),
      nextStepType: "confirm_incident",
      nextStepField: null,
    });
  }

  const replyText = buildQuestionForStep({
    step: nextStep,
    lowConfidence: currentStepHasLowConfidence,
    suggestedReply: interpretation?.assistantStyle?.suggestedReply || null,
  });
  return buildChatResponse({
    sessionId,
    locale: effectiveLocale,
    replyText,
    snapshot: savedSnapshot,
    actionOptions: nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
    nextStepType: "ask_field",
    nextStepField: nextStep,
    needsClarification: currentStepHasLowConfidence,
  });
}

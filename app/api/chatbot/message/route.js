import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/auth";
import {
  CHATBOT_CONVERSATION_STATES,
  clearIncidentDraft,
  getSessionSnapshot,
  setConversationState,
} from "../../../../lib/chatSessionStore";
import {
  detectDialogflowIntent,
  isDialogflowConfigured,
  validateDialogflowMessagePayload,
} from "../../../../lib/dialogflowService";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../../../../lib/i18n";
import { detectLocaleFromText } from "../../../../lib/languageDetection";
import { createIncident } from "../../../../lib/incidents";
import {
  buildAuthRequiredReply,
  buildCancelledIncidentReply,
  buildIncidentConfirmationActionOptions,
  buildIncidentCreatedReply,
  buildIncidentResumeReply,
  buildIncidentFlowFromDialogTurn,
} from "../../../../lib/chatbotConversationOrchestrator";
import {
  getChatbotRouteMetadata,
  resolveChatbotRedirect,
} from "../../../../lib/chatbotIntentRoutes";
import {
  computeMissingIncidentFields,
  inferIncidentCategoryFromText,
  normalizeIncidentDraft,
} from "../../../../lib/chatbotIncidentMapper";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "../../../../lib/chatbotTelemetry";

const FALLBACK_REPLY =
  "No logré identificar con claridad tu solicitud. Cuéntame si quieres reportar un problema, iniciar un trámite o consultar el estado de una gestión.";
const MIN_CONFIDENCE_TO_REDIRECT = 0.45;
const EMPTY_INCIDENT_DRAFT = {
  category: "",
  description: "",
  location: "",
};
export const runtime = "nodejs";

function getContextualReply({ contextEntry, locale }) {
  const kindLabel = contextEntry.kind === "tramite" ? "tramite" : "incidencia";
  if (locale === "en") {
    if (kindLabel === "tramite") {
      return `I understand you want to start the ${contextEntry.title} procedure. I will guide you step by step to begin.`;
    }
    return `I understand you want to report an incident of type ${contextEntry.title}. I will help you provide the required information.`;
  }
  if (locale === "pt") {
    if (kindLabel === "tramite") {
      return `Entendo que você deseja iniciar o trâmite de ${contextEntry.title}. Vou guiar você passo a passo para começar.`;
    }
    return `Entendo que você deseja reportar uma ocorrência do tipo ${contextEntry.title}. Vou ajudar você a registrar as informações necessárias.`;
  }
  if (kindLabel === "tramite") {
    return `Entiendo que deseas iniciar el trámite de ${contextEntry.title}. Te voy a guiar paso a paso para comenzar.`;
  }
  return `Entiendo que deseas reportar una incidencia de tipo ${contextEntry.title}. Voy a ayudarte a registrar la información necesaria.`;
}

function getContextualNextPrompt({ contextEntry, locale }) {
  if (locale === "en") {
    if (contextEntry.kind === "tramite") {
      return "To guide you better, tell me briefly what you need this procedure for.";
    }
    return "Please share the exact location where this is happening.";
  }
  if (locale === "pt") {
    if (contextEntry.kind === "tramite") {
      return "Para orientar melhor, conte em uma frase para que você precisa deste trâmite.";
    }
    return "Por favor, informe a localização exata onde isso está acontecendo.";
  }
  if (contextEntry.kind === "tramite") {
    return "Para orientarte mejor, cuéntame en una frase para qué necesitas este trámite.";
  }
  return "Por favor, indícame la ubicación exacta donde está ocurriendo.";
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
  } catch (error) {
    return NextResponse.json(
      { error: "La solicitud no tiene un formato JSON válido." },
      { status: 400 }
    );
  }

  const validationResult = validateDialogflowMessagePayload(body);
  if (!validationResult.ok) {
    return NextResponse.json({ error: validationResult.error }, { status: 400 });
  }

  const { text, sessionId, preferredLocale, command, contextEntry } = validationResult.value;

  const headerLocale = normalizeLocale(request.headers.get("accept-language"));
  const persistedSessionSnapshot =
    (await getSessionSnapshot(sessionId)) || {
      locale: null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      draft: EMPTY_INCIDENT_DRAFT,
      pendingField: null,
      lastIntent: null,
      lastAction: null,
      lastConfidence: null,
    };
  const persistedSessionLocale = persistedSessionSnapshot.locale;
  const detectedTextLocale = detectLocaleFromText(text);
  const selectedLocale =
    preferredLocale ||
    persistedSessionLocale ||
    detectedTextLocale ||
    resolveLocaleFromAcceptLanguage(request.headers.get("accept-language")) ||
    headerLocale ||
    getDefaultLocale();
  const effectiveLocale = normalizeLocale(selectedLocale) || getDefaultLocale();
  const trackEvent = async (partialPayload) => {
    await trackChatbotEvent({
      sessionId,
      locale: effectiveLocale,
      command,
      ...partialPayload,
    });
  };

  await trackEvent({
    eventName: CHATBOT_TELEMETRY_EVENTS.TURN_RECEIVED,
    mode: "unknown",
    details: text ? "user_turn_with_text" : "user_turn_command_only",
  });

  if ((command === "start_contextual_flow" || command === "start_contextual_entry") && contextEntry) {
    const effectiveContextLocale = "es";
    const nextPrompt = getContextualNextPrompt({
      contextEntry,
      locale: effectiveContextLocale,
    });
    const seededCategory =
      contextEntry.kind === "incidencia"
        ? contextEntry.category ||
          inferIncidentCategoryFromText(`${contextEntry.title} ${contextEntry.description}`) ||
          "infraestructura"
        : "";
    const seededDescription =
      contextEntry.kind === "incidencia" && contextEntry.description
        ? contextEntry.description
        : "";
    const seededDraft =
      contextEntry.kind === "incidencia"
        ? normalizeIncidentDraft({
            category: seededCategory,
            description: seededDescription,
            location: "",
          })
        : EMPTY_INCIDENT_DRAFT;
    const nextField =
      contextEntry.kind === "incidencia"
        ? computeMissingIncidentFields(seededDraft)[0] || "location"
        : null;
    const mode = contextEntry.kind === "incidencia" ? "incident" : "procedure";

    await setConversationState(sessionId, {
      locale: effectiveContextLocale,
      state:
        contextEntry.kind === "incidencia"
          ? CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT
          : CHATBOT_CONVERSATION_STATES.GUIDING_PROCEDURE,
      draft: seededDraft,
      pendingField: nextField,
      lastIntent: contextEntry.kind === "incidencia" ? "crear_incidencia" : "iniciar_tramite",
      lastAction: "start_contextual_entry",
      lastConfidence: null,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.MODE_RESOLVED,
      mode,
      action: "start_contextual_entry",
      outcome: "context_initialized",
      details: contextEntry.kind,
    });

    return NextResponse.json({
      sessionId,
      locale: effectiveContextLocale,
      replyText: nextPrompt,
      intent: contextEntry.kind === "incidencia" ? "crear_incidencia" : "iniciar_tramite",
      confidence: null,
      fulfillmentMessages: [],
      action: "start_contextual_entry",
      parameters: {},
      mode,
      draft: {
        ...seededDraft,
        missingFields: computeMissingIncidentFields(seededDraft),
      },
      nextStep:
        contextEntry.kind === "incidencia"
          ? {
              type: "ask_field",
              field: nextField || "location",
            }
          : {
              type: "redirect",
              field: null,
            },
      actionOptions: [],
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (command === "cancel_incident") {
    await clearIncidentDraft(sessionId);
    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      draft: EMPTY_INCIDENT_DRAFT,
      pendingField: null,
      lastAction: command,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CANCELLED,
      funnelStep: CHATBOT_FUNNEL_STEPS.CANCELLED,
      mode: "incident",
      action: command,
      outcome: "draft_cleared",
    });

    return NextResponse.json({
      sessionId,
      locale: effectiveLocale,
      replyText: buildCancelledIncidentReply(effectiveLocale),
      intent: persistedSessionSnapshot.lastIntent,
      confidence: persistedSessionSnapshot.lastConfidence,
      fulfillmentMessages: [],
      action: command,
      parameters: {},
      mode: "incident",
      draft: {
        ...EMPTY_INCIDENT_DRAFT,
        missingFields: computeMissingIncidentFields(EMPTY_INCIDENT_DRAFT),
      },
      nextStep: {
        type: "cancelled",
        field: null,
      },
      actionOptions: [],
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (command === "resume_incident_confirmation") {
    const normalizedDraft = normalizeIncidentDraft(persistedSessionSnapshot.draft);
    const missingFields = computeMissingIncidentFields(normalizedDraft);
    if (missingFields.length > 0) {
      const nextField = missingFields[0];
      await setConversationState(sessionId, {
        locale: effectiveLocale,
        state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
        draft: normalizedDraft,
        pendingField: nextField,
        lastAction: command,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
        funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
        mode: "incident",
        action: command,
        fieldName: nextField,
        outcome: "resume_missing_fields",
      });

      const partialFlow = buildIncidentFlowFromDialogTurn({
        text: "",
        locale: effectiveLocale,
        shouldAskClarification: false,
        dialogflowResponse: {
          action: "crear_incidencia",
          intent: "crear_incidencia",
          parameters: {},
        },
        sessionSnapshot: {
          ...persistedSessionSnapshot,
          draft: normalizedDraft,
          state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
          pendingField: nextField,
        },
      });

      return NextResponse.json({
        sessionId,
        locale: effectiveLocale,
        replyText: partialFlow.replyText || FALLBACK_REPLY,
        intent: persistedSessionSnapshot.lastIntent,
        confidence: persistedSessionSnapshot.lastConfidence,
        fulfillmentMessages: [],
        action: command,
        parameters: {},
        mode: partialFlow.mode,
        draft: {
          ...normalizeIncidentDraft(partialFlow.draft),
          missingFields: computeMissingIncidentFields(partialFlow.draft),
        },
        nextStep: partialFlow.nextStep,
        actionOptions: partialFlow.actionOptions,
        redirectTo: null,
        redirectLabel: null,
        needsClarification: false,
      });
    }

    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.AWAITING_INCIDENT_CONFIRMATION,
      draft: normalizedDraft,
      pendingField: null,
      lastAction: command,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_RESUMED,
      funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
      mode: "incident",
      action: command,
      outcome: "resume_ready",
    });

    return NextResponse.json({
      sessionId,
      locale: effectiveLocale,
      replyText: buildIncidentResumeReply(effectiveLocale),
      intent: persistedSessionSnapshot.lastIntent,
      confidence: persistedSessionSnapshot.lastConfidence,
      fulfillmentMessages: [],
      action: command,
      parameters: {},
      mode: "incident",
      draft: {
        ...normalizedDraft,
        missingFields: [],
      },
      nextStep: {
        type: "confirm_incident",
        field: null,
      },
      actionOptions: buildIncidentConfirmationActionOptions(effectiveLocale),
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (command === "confirm_incident") {
    const normalizedDraft = normalizeIncidentDraft(persistedSessionSnapshot.draft);
    const missingFields = computeMissingIncidentFields(normalizedDraft);
    if (missingFields.length > 0) {
      const nextField = missingFields[0];
      await setConversationState(sessionId, {
        locale: effectiveLocale,
        state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
        draft: normalizedDraft,
        pendingField: nextField,
        lastAction: command,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
        funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
        mode: "incident",
        action: command,
        fieldName: nextField,
        outcome: "confirm_with_missing_fields",
      });

      const partialFlow = buildIncidentFlowFromDialogTurn({
        text: "",
        locale: effectiveLocale,
        shouldAskClarification: false,
        dialogflowResponse: {
          action: "crear_incidencia",
          intent: "crear_incidencia",
          parameters: {},
        },
        sessionSnapshot: {
          ...persistedSessionSnapshot,
          draft: normalizedDraft,
          state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
          pendingField: nextField,
        },
      });

      return NextResponse.json({
        sessionId,
        locale: effectiveLocale,
        replyText: partialFlow.replyText || FALLBACK_REPLY,
        intent: persistedSessionSnapshot.lastIntent,
        confidence: persistedSessionSnapshot.lastConfidence,
        fulfillmentMessages: [],
        action: command,
        parameters: {},
        mode: partialFlow.mode,
        draft: {
          ...normalizeIncidentDraft(partialFlow.draft),
          missingFields: computeMissingIncidentFields(partialFlow.draft),
        },
        nextStep: partialFlow.nextStep,
        actionOptions: partialFlow.actionOptions,
        redirectTo: null,
        redirectLabel: null,
        needsClarification: false,
      });
    }

    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      await setConversationState(sessionId, {
        locale: effectiveLocale,
        state: CHATBOT_CONVERSATION_STATES.AWAITING_INCIDENT_CONFIRMATION,
        draft: normalizedDraft,
        pendingField: null,
        lastAction: command,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.AUTH_REQUIRED,
        funnelStep: CHATBOT_FUNNEL_STEPS.AUTH_REQUIRED,
        mode: "incident",
        action: command,
        hasAuth: true,
        outcome: "auth_needed_before_creation",
      });

      return NextResponse.json({
        sessionId,
        locale: effectiveLocale,
        replyText: buildAuthRequiredReply(effectiveLocale),
        intent: persistedSessionSnapshot.lastIntent,
        confidence: persistedSessionSnapshot.lastConfidence,
        fulfillmentMessages: [],
        action: command,
        parameters: {},
        mode: "incident",
        draft: {
          ...normalizedDraft,
          missingFields: [],
        },
        nextStep: {
          type: "auth_required",
          field: null,
        },
        actionOptions: [],
        redirectTo: "/login",
        redirectLabel: effectiveLocale === "en" ? "Sign in" : effectiveLocale === "pt" ? "Entrar" : "Iniciar sesión",
        needsClarification: false,
      });
    }

    try {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.CONFIRMED,
        mode: "incident",
        action: command,
        outcome: "user_confirmed_creation",
      });
      const incident = await createIncident({
        userId: authenticatedUser.id,
        category: normalizedDraft.category,
        description: normalizedDraft.description,
        location: normalizedDraft.location,
      });

      await setConversationState(sessionId, {
        locale: effectiveLocale,
        state: CHATBOT_CONVERSATION_STATES.INCIDENT_CREATED,
        draft: EMPTY_INCIDENT_DRAFT,
        pendingField: null,
        lastAction: "incident_created",
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.INCIDENT_CREATED,
        funnelStep: CHATBOT_FUNNEL_STEPS.INCIDENT_CREATED,
        mode: "incident",
        action: "incident_created",
        outcome: "success",
        incidentId: incident.id,
        userId: authenticatedUser.id,
      });

      return NextResponse.json({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentCreatedReply({
          locale: effectiveLocale,
          incidentId: incident.id,
        }),
        intent: persistedSessionSnapshot.lastIntent,
        confidence: persistedSessionSnapshot.lastConfidence,
        fulfillmentMessages: [],
        action: "incident_created",
        parameters: {},
        mode: "incident",
        draft: {
          ...EMPTY_INCIDENT_DRAFT,
          missingFields: computeMissingIncidentFields(EMPTY_INCIDENT_DRAFT),
        },
        nextStep: {
          type: "incident_created",
          field: null,
        },
        actionOptions: [],
        incident: {
          id: incident.id,
          status: incident.status,
          category: incident.category,
          location: incident.location,
        },
        redirectTo: `/mis-incidencias?incidentId=${encodeURIComponent(incident.id)}`,
        redirectLabel:
          effectiveLocale === "en"
            ? "View case status"
            : effectiveLocale === "pt"
              ? "Ver status do caso"
              : "Ver estado del caso",
        needsClarification: false,
      });
    } catch (error) {
      console.error("[chatbot] Error creando incidencia desde chat.", {
        sessionId,
        userId: authenticatedUser.id,
        message: error?.message,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "incident",
        action: command,
        outcome: "incident_creation_failed",
        details: error?.message,
        userId: authenticatedUser.id,
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

  if (command === "edit_incident_category") {
    const normalizedDraft = normalizeIncidentDraft(persistedSessionSnapshot.draft);
    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
      draft: normalizedDraft,
      pendingField: "category",
      lastAction: command,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.EDIT_REQUESTED,
      mode: "incident",
      action: command,
      fieldName: "category",
      outcome: "edit_requested",
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
      funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
      mode: "incident",
      action: command,
      fieldName: "category",
      outcome: "edit_prompted",
    });
    const partialFlow = buildIncidentFlowFromDialogTurn({
      text: "",
      locale: effectiveLocale,
      shouldAskClarification: false,
      dialogflowResponse: {
        action: "crear_incidencia",
        intent: "crear_incidencia",
        parameters: {},
      },
      sessionSnapshot: {
        ...persistedSessionSnapshot,
        draft: normalizedDraft,
        state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
        pendingField: "category",
      },
    });
    return NextResponse.json({
      sessionId,
      locale: effectiveLocale,
      replyText: partialFlow.replyText || FALLBACK_REPLY,
      intent: persistedSessionSnapshot.lastIntent,
      confidence: persistedSessionSnapshot.lastConfidence,
      fulfillmentMessages: [],
      action: command,
      parameters: {},
      mode: partialFlow.mode,
      draft: {
        ...normalizeIncidentDraft(partialFlow.draft),
        missingFields: computeMissingIncidentFields(partialFlow.draft),
      },
      nextStep: partialFlow.nextStep,
      actionOptions: partialFlow.actionOptions,
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (command === "edit_incident_description") {
    const normalizedDraft = normalizeIncidentDraft(persistedSessionSnapshot.draft);
    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
      draft: normalizedDraft,
      pendingField: "description",
      lastAction: command,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.EDIT_REQUESTED,
      mode: "incident",
      action: command,
      fieldName: "description",
      outcome: "edit_requested",
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
      funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
      mode: "incident",
      action: command,
      fieldName: "description",
      outcome: "edit_prompted",
    });

    const partialFlow = buildIncidentFlowFromDialogTurn({
      text: "",
      locale: effectiveLocale,
      shouldAskClarification: false,
      dialogflowResponse: {
        action: "crear_incidencia",
        intent: "crear_incidencia",
        parameters: {},
      },
      sessionSnapshot: {
        ...persistedSessionSnapshot,
        draft: normalizedDraft,
        state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
        pendingField: "description",
      },
    });
    return NextResponse.json({
      sessionId,
      locale: effectiveLocale,
      replyText: partialFlow.replyText || FALLBACK_REPLY,
      intent: persistedSessionSnapshot.lastIntent,
      confidence: persistedSessionSnapshot.lastConfidence,
      fulfillmentMessages: [],
      action: command,
      parameters: {},
      mode: partialFlow.mode,
      draft: {
        ...normalizeIncidentDraft(partialFlow.draft),
        missingFields: computeMissingIncidentFields(partialFlow.draft),
      },
      nextStep: partialFlow.nextStep,
      actionOptions: partialFlow.actionOptions,
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (command === "edit_incident_location") {
    const normalizedDraft = normalizeIncidentDraft(persistedSessionSnapshot.draft);
    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
      draft: normalizedDraft,
      pendingField: "location",
      lastAction: command,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.EDIT_REQUESTED,
      mode: "incident",
      action: command,
      fieldName: "location",
      outcome: "edit_requested",
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
      funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
      mode: "incident",
      action: command,
      fieldName: "location",
      outcome: "edit_prompted",
    });

    const partialFlow = buildIncidentFlowFromDialogTurn({
      text: "",
      locale: effectiveLocale,
      shouldAskClarification: false,
      dialogflowResponse: {
        action: "crear_incidencia",
        intent: "crear_incidencia",
        parameters: {},
      },
      sessionSnapshot: {
        ...persistedSessionSnapshot,
        draft: normalizedDraft,
        state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
        pendingField: "location",
      },
    });
    return NextResponse.json({
      sessionId,
      locale: effectiveLocale,
      replyText: partialFlow.replyText || FALLBACK_REPLY,
      intent: persistedSessionSnapshot.lastIntent,
      confidence: persistedSessionSnapshot.lastConfidence,
      fulfillmentMessages: [],
      action: command,
      parameters: {},
      mode: partialFlow.mode,
      draft: {
        ...normalizeIncidentDraft(partialFlow.draft),
        missingFields: computeMissingIncidentFields(partialFlow.draft),
      },
      nextStep: partialFlow.nextStep,
      actionOptions: partialFlow.actionOptions,
      redirectTo: null,
      redirectLabel: null,
      needsClarification: false,
    });
  }

  if (!isDialogflowConfigured()) {
    console.error("[chatbot] Dialogflow no configurado en entorno servidor.");
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      mode: "unknown",
      outcome: "dialogflow_not_configured",
    });
    return NextResponse.json(
      {
        error: "El asistente no está disponible temporalmente.",
      },
      { status: 503 }
    );
  }

  try {
    const dialogflowResponse = await detectDialogflowIntent({
      text,
      sessionId,
      languageCode: effectiveLocale,
    });
    const hasLowConfidence =
      typeof dialogflowResponse.confidence === "number" &&
      dialogflowResponse.confidence < MIN_CONFIDENCE_TO_REDIRECT;
    const isFallbackIntent = dialogflowResponse.intent === "Default Fallback Intent";
    const shouldAskClarification =
      !dialogflowResponse.intent || hasLowConfidence || isFallbackIntent;
    const conversationFlow = buildIncidentFlowFromDialogTurn({
      text,
      locale: effectiveLocale,
      shouldAskClarification,
      dialogflowResponse,
      sessionSnapshot: persistedSessionSnapshot,
    });
    const normalizedDraft = normalizeIncidentDraft(conversationFlow.draft);
    const missingFields = computeMissingIncidentFields(normalizedDraft);
    const resolvedRedirect =
      conversationFlow.nextStep?.type === "redirect"
        ? resolveChatbotRedirect({
            action: dialogflowResponse.action,
            intentDisplayName: dialogflowResponse.intent,
          })
        : null;
    const routeMetadata = getChatbotRouteMetadata(resolvedRedirect);
    const replyText =
      conversationFlow.replyText ||
      (shouldAskClarification ? FALLBACK_REPLY : dialogflowResponse.replyText || FALLBACK_REPLY);

    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: conversationFlow.state,
      draft: normalizedDraft,
      pendingField: conversationFlow.pendingField,
      lastIntent: dialogflowResponse.intent,
      lastAction: dialogflowResponse.action,
      lastConfidence: dialogflowResponse.confidence,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.INTENT_DETECTED,
      mode: conversationFlow.mode,
      intent: dialogflowResponse.intent,
      action: dialogflowResponse.action,
      confidence: dialogflowResponse.confidence,
      outcome: shouldAskClarification ? "low_confidence_or_fallback" : "intent_ok",
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.MODE_RESOLVED,
      mode: conversationFlow.mode,
      intent: dialogflowResponse.intent,
      action: dialogflowResponse.action,
      confidence: dialogflowResponse.confidence,
      hasRedirect: Boolean(resolvedRedirect),
      outcome: conversationFlow.nextStep?.type || "none",
    });
    if (conversationFlow.mode === "incident") {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.MODE_RESOLVED,
        funnelStep: CHATBOT_FUNNEL_STEPS.ENTERED_INCIDENT_FLOW,
        mode: conversationFlow.mode,
        intent: dialogflowResponse.intent,
        action: dialogflowResponse.action,
        outcome: "incident_mode_active",
      });
      if (conversationFlow.nextStep?.type === "ask_field") {
        await trackEvent({
          eventName: CHATBOT_TELEMETRY_EVENTS.ASK_FIELD,
          funnelStep: CHATBOT_FUNNEL_STEPS.ASKED_FIELD,
          mode: conversationFlow.mode,
          intent: dialogflowResponse.intent,
          action: dialogflowResponse.action,
          fieldName: conversationFlow.nextStep?.field || null,
          outcome: "field_requested",
        });
      }
      if (conversationFlow.nextStep?.type === "confirm_incident") {
        await trackEvent({
          eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
          funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
          mode: conversationFlow.mode,
          intent: dialogflowResponse.intent,
          action: dialogflowResponse.action,
          outcome: "waiting_user_confirmation",
        });
      }
    }
    if (conversationFlow.mode === "fallback") {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.FALLBACK_CLARIFICATION,
        mode: conversationFlow.mode,
        intent: dialogflowResponse.intent,
        action: dialogflowResponse.action,
        confidence: dialogflowResponse.confidence,
        outcome: "clarification_prompted",
      });
    }
    if (resolvedRedirect) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.REDIRECT_OFFERED,
        mode: conversationFlow.mode,
        intent: dialogflowResponse.intent,
        action: dialogflowResponse.action,
        hasRedirect: true,
        outcome: resolvedRedirect,
      });
    }

    return NextResponse.json({
      sessionId: dialogflowResponse.sessionId,
      locale: dialogflowResponse.languageCode || effectiveLocale,
      replyText,
      intent: dialogflowResponse.intent,
      confidence: dialogflowResponse.confidence,
      fulfillmentMessages: dialogflowResponse.fulfillmentMessages,
      action: dialogflowResponse.action,
      parameters: dialogflowResponse.parameters,
      mode: conversationFlow.mode,
      draft: {
        ...normalizedDraft,
        missingFields,
      },
      nextStep: conversationFlow.nextStep,
      actionOptions: conversationFlow.actionOptions,
      redirectTo: resolvedRedirect || null,
      redirectLabel: routeMetadata?.label || null,
      needsClarification:
        shouldAskClarification || conversationFlow.mode === "fallback",
    });
  } catch (error) {
    console.error("[chatbot] Error detectando intencion.", {
      sessionId,
      textLength: text.length,
      message: error?.message,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      mode: "unknown",
      outcome: "detect_intent_failed",
      details: error?.message,
    });

    return NextResponse.json(
      {
        error: "Ocurrió un error al procesar tu mensaje. Intenta nuevamente en unos segundos.",
      },
      { status: 500 }
    );
  }
}

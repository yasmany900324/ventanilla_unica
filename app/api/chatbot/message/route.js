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
  buildIncidentCreatedReply,
  buildIncidentFlowFromDialogTurn,
} from "../../../../lib/chatbotConversationOrchestrator";
import {
  getChatbotRouteMetadata,
  resolveChatbotRedirect,
} from "../../../../lib/chatbotIntentRoutes";
import {
  computeMissingIncidentFields,
  normalizeIncidentDraft,
} from "../../../../lib/chatbotIncidentMapper";

const FALLBACK_REPLY =
  "No logre identificar con claridad tu solicitud. Contame si quieres reportar un problema, iniciar un tramite o consultar el estado de una gestion.";
const MIN_CONFIDENCE_TO_REDIRECT = 0.45;
const EMPTY_INCIDENT_DRAFT = {
  category: "",
  description: "",
  location: "",
};

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "Metodo no permitido. Usa POST para enviar mensajes al chatbot." },
    { status: 405 }
  );
}

export async function POST(request) {
  let body = null;

  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      { error: "La solicitud no tiene un formato JSON valido." },
      { status: 400 }
    );
  }

  const validationResult = validateDialogflowMessagePayload(body);
  if (!validationResult.ok) {
    return NextResponse.json({ error: validationResult.error }, { status: 400 });
  }

  const { text, sessionId, preferredLocale, command } = validationResult.value;

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

  if (command === "cancel_incident") {
    await clearIncidentDraft(sessionId);
    await setConversationState(sessionId, {
      locale: effectiveLocale,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      draft: EMPTY_INCIDENT_DRAFT,
      pendingField: null,
      lastAction: command,
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
        redirectLabel: effectiveLocale === "en" ? "Sign in" : effectiveLocale === "pt" ? "Entrar" : "Iniciar sesion",
        needsClarification: false,
      });
    }

    try {
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
      return NextResponse.json(
        {
          error:
            "Ocurrio un error al crear la incidencia desde el chat. Intenta nuevamente en unos segundos.",
        },
        { status: 500 }
      );
    }
  }

  if (!isDialogflowConfigured()) {
    console.error("[chatbot] Dialogflow no configurado en entorno servidor.");
    return NextResponse.json(
      {
        error: "El asistente no esta disponible temporalmente.",
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

    return NextResponse.json(
      {
        error: "Ocurrio un error al procesar tu mensaje. Intenta nuevamente en unos segundos.",
      },
      { status: 500 }
    );
  }
}

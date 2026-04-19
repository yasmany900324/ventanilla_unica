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
  buildAuthRequiredReply,
  buildCancelledIncidentReply,
  buildConfirmationActionOptions,
  buildIncidentCreatedReply,
  buildIncidentResumeReply,
  buildPhotoActionOptions,
  buildQuestionForStep,
  buildTreeFlowSeedFromContext,
  createTreeFlowSnapshotPatch,
  getNextTreeFlowStep,
  isTreeFlowActive,
  mergeCollectedDataFromInterpretation,
  parseUserCommandFromText,
  shouldActivateTreeFlow,
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
  return "unknown";
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
  const missingFields = getRequiredMissingFields(collectedData);

  return NextResponse.json({
    sessionId,
    locale,
    replyText,
    intent: snapshot?.lastIntent || null,
    confidence: snapshot?.lastConfidence || null,
    fulfillmentMessages: [],
    action: snapshot?.lastAction || null,
    parameters: {},
    mode: buildModeFromSnapshot(snapshot),
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
          "Puedo ayudarte con reportes de Árbol caído / ramas peligrosas. Si quieres, cuéntame directamente la ubicación para empezar.",
        snapshot: {
          ...snapshot,
          locale: effectiveLocale,
          lastInterpretation: interpretation,
          lastIntent: interpretation?.intent?.kind || "unknown",
          lastAction: effectiveCommand || "none",
          lastConfidence: interpretation?.intent?.confidence || null,
        },
        actionOptions: [],
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

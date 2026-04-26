import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  setConversationState,
} from "../chatSessionStore";
import {
  buildIncidentConfirmationIntroReply,
  buildIncidentDraftPreviewPayload,
  buildPhotoActionOptions,
  buildQuestionForStep,
  createIncidentFlowSnapshotPatch,
  getNextIncidentFlowStep,
  isIncidentFlowActive,
  isProcedureFlowActive,
} from "../chatbotConversationOrchestrator";
import { persistProcedurePhotoForChatSession } from "../chatbotProcedurePhotoUpload";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "../chatbotTelemetry";
import {
  getProcedureFieldDefinition,
  getProcedureMissingFieldsFromDefinition,
  normalizeProcedureCollectedData,
} from "../procedureCatalog";
import { downloadWhatsAppMediaBytes } from "./whatsappMediaClient";

/** @typedef {import("./normalizeInboundMessage").NormalizedIncomingMessage} NormalizedIncomingMessage */

function formatLocationLineForUser({ latitude, longitude, addressText }) {
  const coords = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  if (addressText) {
    return `${addressText} (${coords})`;
  }
  return coords;
}

function buildLocationStorageString({ latitude, longitude, addressText }) {
  const line = formatLocationLineForUser({ latitude, longitude, addressText });
  const base = line.slice(0, 280);
  return `${base} [fuente: WhatsApp ubicación]`.slice(0, 320);
}

function normalizeIncidentFieldDefinitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const out = [];
  const seen = new Set();
  value.forEach((field, index) => {
    if (!field || typeof field !== "object") {
      return;
    }
    const key =
      typeof field.key === "string"
        ? field.key.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60)
        : "";
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({
      key,
      type:
        typeof field.type === "string" && field.type.trim()
          ? field.type.trim().toLowerCase()
          : "text",
      order: Number.isInteger(field.order) ? field.order : index,
    });
  });
  return out.sort((a, b) => a.order - b.order);
}

function getCurrentIncidentField(snapshot) {
  const currentKey = typeof snapshot?.currentStep === "string" ? snapshot.currentStep.trim().toLowerCase() : "";
  if (!currentKey || currentKey === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
    return null;
  }
  const defs = normalizeIncidentFieldDefinitions(snapshot?.collectedData?.incidentRequiredFields || []);
  const fromCatalog = defs.find((field) => field.key === currentKey);
  if (fromCatalog) {
    return fromCatalog;
  }
  if (currentKey === CHATBOT_CURRENT_STEPS.LOCATION) {
    return { key: "location", type: "location" };
  }
  if (currentKey === CHATBOT_CURRENT_STEPS.PHOTO) {
    return { key: "photo", type: "image" };
  }
  if (currentKey === CHATBOT_CURRENT_STEPS.DESCRIPTION) {
    return { key: "description", type: "text" };
  }
  return { key: currentKey, type: "text" };
}

/**
 * Text passed to the LLM when the raw channel message is not plain text.
 * @param {NormalizedIncomingMessage} normalized
 * @returns {string}
 */
export function buildLlmSyntheticUserText(normalized) {
  if (!normalized || typeof normalized !== "object") {
    return "";
  }
  if (normalized.type === "text") {
    return normalized.text;
  }
  if (normalized.type === "location") {
    return `El usuario envió una ubicación de WhatsApp: latitud ${normalized.latitude}, longitud ${normalized.longitude}. Referencia: ${normalized.addressText || "(sin nombre ni dirección)"}.`;
  }
  if (normalized.type === "image") {
    return `El usuario envió una imagen por WhatsApp (media_id=${normalized.mediaId}).`;
  }
  if (normalized.type === "audio") {
    return `El usuario envió un audio por WhatsApp (media_id=${normalized.mediaId}).`;
  }
  if (normalized.type === "interactive") {
    const label = normalized.title || normalized.id || "";
    return label ? `El usuario eligió una opción interactiva: ${label}` : "El usuario eligió una opción interactiva.";
  }
  if (normalized.type === "unknown") {
    return `El usuario envió un tipo de mensaje no soportado (${normalized.rawType || "desconocido"}) por WhatsApp.`;
  }
  return "";
}

/**
 * @param {object} params
 * @param {'whatsapp'} params.channel
 * @param {string} params.sessionId
 * @param {string} params.locale
 * @param {object | null} params.snapshot
 * @param {NormalizedIncomingMessage} params.normalized
 * @returns {Promise<object|null>}
 */
export async function handleWhatsAppStructuredProcedureTurn({
  channel,
  sessionId,
  locale,
  snapshot,
  normalized,
}) {
  if (channel !== "whatsapp" || !snapshot || !normalized) {
    return null;
  }
  if (!isIncidentFlowActive(snapshot) && !isProcedureFlowActive(snapshot)) {
    return null;
  }

  const logBase = {
    channel: "whatsapp",
    currentStep: snapshot.currentStep,
    inboundType: normalized.type,
  };
  const currentField = getCurrentIncidentField(snapshot);

  const track = async (partial) => {
    await trackChatbotEvent({
      sessionId,
      locale,
      userId: snapshot.userId || null,
      command: "whatsapp_structured",
      ...partial,
    });
  };

  if (normalized.type === "unknown" && normalized.rawType) {
    console.info("[whatsapp] inbound unknown message type", logBase);
  }

  if (normalized.type === "image" && isProcedureFlowActive(snapshot)) {
    const procedureData = normalizeProcedureCollectedData(snapshot.collectedData || {});
    const fieldDefinitions = Array.isArray(procedureData.procedureFieldDefinitions)
      ? procedureData.procedureFieldDefinitions
      : Array.isArray(procedureData.procedureRequiredFields)
        ? procedureData.procedureRequiredFields
      : [];
    const currentStepKey =
      typeof snapshot.currentStep === "string" ? snapshot.currentStep.trim().toLowerCase() : "";
    const currentField = getProcedureFieldDefinition(fieldDefinitions, currentStepKey);
    const missingBefore = getProcedureMissingFieldsFromDefinition(fieldDefinitions, procedureData);
    const firstMissingField = getProcedureFieldDefinition(fieldDefinitions, missingBefore[0] || "");
    const targetField =
      currentField?.type === "image"
        ? currentField
        : firstMissingField?.type === "image"
          ? firstMissingField
          : null;

    if (!targetField || targetField.type !== "image") {
      console.info("[whatsapp] procedure image rejected for wrong step", {
        ...logBase,
        expectedStep: currentField?.key || snapshot.currentStep,
      });
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_REJECTED,
        mode: "procedure",
        outcome: "whatsapp_image_wrong_step_procedure",
        details: `expected=${currentField?.key || snapshot.currentStep} got=image`,
      });
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText: `Ahora no estamos pidiendo una foto en este trámite.\n\n${buildQuestionForStep({
            step: snapshot.currentStep,
            channel: "whatsapp",
          })}`,
          intent: snapshot.lastIntent || null,
          confidence: snapshot.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_image_wrong_step_procedure",
          parameters: {},
          mode: "procedure",
          draft: { ...procedureData, missingFields: missingBefore },
          nextStep: { type: "ask_field", field: snapshot.currentStep },
          actionOptions: [],
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: null,
        },
        snapshot,
      };
    }

    const download = await downloadWhatsAppMediaBytes(normalized.mediaId);
    if (!download.ok) {
      console.error("[whatsapp] procedure image download failed", { ...logBase, error: download.error });
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "procedure",
        outcome: "whatsapp_image_download_failed_procedure",
        details: download.error,
      });
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText:
            "Recibimos la foto pero no pudimos descargarla desde WhatsApp. Intentá enviarla de nuevo en unos segundos.",
          intent: snapshot.lastIntent || null,
          confidence: snapshot.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_image_download_failed_procedure",
          parameters: {},
          mode: "procedure",
          draft: { ...procedureData, missingFields: missingBefore },
          nextStep: { type: "ask_field", field: snapshot.currentStep },
          actionOptions: [],
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: null,
        },
        snapshot,
      };
    }

    const upload = await persistProcedurePhotoForChatSession({
      sessionId,
      userId: snapshot.userId || null,
      bytes: download.bytes,
      mimeType: download.mimeType || normalized.mimeType || "image/jpeg",
      originalName: normalized.caption || "whatsapp-imagen.jpg",
      preferredLocale: locale,
      origin: null,
    });
    if (upload.status !== 200 || !upload.snapshot || !upload.body || typeof upload.body !== "object") {
      console.error("[whatsapp] procedure image persist failed", {
        ...logBase,
        status: upload.status,
      });
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText:
            typeof upload?.body?.error === "string" && upload.body.error.trim()
              ? upload.body.error.trim()
              : "No pudimos guardar la foto en este momento. Intentá enviarla nuevamente.",
          intent: snapshot.lastIntent || null,
          confidence: snapshot.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_image_persist_failed_procedure",
          parameters: {},
          mode: "procedure",
          draft: { ...procedureData, missingFields: missingBefore },
          nextStep: { type: "ask_field", field: snapshot.currentStep },
          actionOptions: [],
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: null,
        },
        snapshot,
      };
    }

    console.info("[whatsapp] procedure image persisted", {
      ...logBase,
      nextStep: upload.snapshot.currentStep,
    });
    return {
      status: 200,
      body: {
        ...upload.body,
        replyText: `Foto recibida como evidencia.\n\n${upload.body.replyText || "Seguimos con el siguiente dato."}`,
      },
      snapshot: upload.snapshot,
    };
  }

  if (normalized.type === "location" && currentField?.type === "location") {
    const locationText = buildLocationStorageString({
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      addressText: normalized.addressText,
    });
    const nextCollected = {
      ...snapshot.collectedData,
      location: locationText,
      [currentField.key]: locationText,
      locationLatitude: normalized.latitude,
      locationLongitude: normalized.longitude,
      locationAddressText: (normalized.addressText || "").slice(0, 400),
      locationSource: "whatsapp_location",
    };
    const nextStep = getNextIncidentFlowStep(nextCollected);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";

    const saved = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale,
        userId: snapshot.userId || null,
        collectedData: nextCollected,
        currentStep: nextStep,
        confirmationState,
        lastInterpretation: {
          ...(snapshot.lastInterpretation || {}),
          whatsappInbound: { type: "location", persisted: true },
        },
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: "whatsapp_location_accepted",
        lastConfidence: snapshot.lastConfidence,
        state: nextState,
      })
    );

    console.info("[whatsapp] location persisted for incident flow", {
      ...logBase,
      nextStep,
    });

    await track({
      eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_ACCEPTED,
      mode: "incident",
      outcome: "location_whatsapp_pin",
      details: "structured_handler",
    });

    const locationLine = formatLocationLineForUser({
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      addressText: normalized.addressText,
    });

    if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
        mode: "incident",
        outcome: "ready_after_whatsapp_location",
      });
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText: `Ubicación recibida.\nUbicación registrada: ${locationLine}.\n\n${buildIncidentConfirmationIntroReply(locale, {
            channel: "whatsapp",
            collectedData: nextCollected,
          })}`,
          intent: saved.lastIntent || null,
          confidence: saved.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_location_accepted",
          parameters: {},
          mode: "incident",
          draft: { ...nextCollected, missingFields: [] },
          nextStep: { type: "confirm_incident", field: null },
          actionOptions: [],
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: buildIncidentDraftPreviewPayload(nextCollected),
        },
        snapshot: saved,
      };
    }

    return {
      status: 200,
      body: {
        sessionId,
        locale,
        replyText: `Ubicación recibida.\nUbicación registrada: ${locationLine}.\n\n${buildQuestionForStep({
          step: nextStep,
          channel: "whatsapp",
        })}`,
        intent: saved.lastIntent || null,
        confidence: saved.lastConfidence || null,
        fulfillmentMessages: [],
        action: "whatsapp_location_accepted",
        parameters: {},
        mode: "incident",
        draft: { ...nextCollected, missingFields: [] },
        nextStep: { type: "ask_field", field: nextStep },
        actionOptions: nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        redirectTo: null,
        redirectLabel: null,
        needsClarification: false,
        incident: null,
        statusSummary: null,
        incidentDraftPreview: null,
      },
      snapshot: saved,
    };
  }

  if (normalized.type === "image" && currentField?.type === "image") {
    const photoStatus = snapshot.collectedData?.photoStatus || "not_requested";
    if (photoStatus !== "not_requested" && photoStatus !== "pending_upload") {
      console.warn("[whatsapp] image rejected: photo step already resolved", logBase);
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_REJECTED,
        mode: "incident",
        outcome: "image_wrong_photo_state",
        details: String(photoStatus),
      });
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText:
            "Ya registramos una decisión sobre la foto de este reporte. Si querés cambiarla, cancelá y empezá de nuevo o pedí «corregir datos» desde el resumen.",
          intent: snapshot.lastIntent || null,
          confidence: snapshot.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_image_rejected_state",
          parameters: {},
          mode: "incident",
          draft: { ...(snapshot.collectedData || {}), missingFields: [] },
          nextStep: { type: "confirm_incident", field: null },
          actionOptions: [],
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: null,
        },
        snapshot,
      };
    }

    const download = await downloadWhatsAppMediaBytes(normalized.mediaId);
    if (!download.ok) {
      console.error("[whatsapp] image download failed", { ...logBase, error: download.error });
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "incident",
        outcome: "whatsapp_image_download_failed",
        details: download.error,
      });
      const nextCollected = {
        ...snapshot.collectedData,
        photoWhatsappMediaId: normalized.mediaId,
        photoAttachmentChannel: "whatsapp",
        photoDownloadStatus: "failed",
        photoDownloadError: download.error,
      };
      const savedErr = await setConversationState(
        sessionId,
        createIncidentFlowSnapshotPatch({
          locale,
          userId: snapshot.userId || null,
          collectedData: nextCollected,
          currentStep: CHATBOT_CURRENT_STEPS.PHOTO,
          confirmationState: "none",
          lastInterpretation: snapshot.lastInterpretation || {},
          lastIntent: snapshot.lastIntent || "report_incident",
          lastAction: "whatsapp_image_download_failed",
          lastConfidence: snapshot.lastConfidence,
          state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        })
      );
      return {
        status: 200,
        body: {
          sessionId,
          locale,
          replyText:
            "Recibimos la foto pero no pudimos descargarla desde WhatsApp. Intentá enviarla de nuevo en unos segundos, o respondé «sin foto» si preferís continuar sin evidencia.",
          intent: savedErr.lastIntent || null,
          confidence: savedErr.lastConfidence || null,
          fulfillmentMessages: [],
          action: "whatsapp_image_download_failed",
          parameters: {},
          mode: "incident",
          draft: { ...(savedErr.collectedData || {}), missingFields: [] },
          nextStep: { type: "ask_field", field: CHATBOT_CURRENT_STEPS.PHOTO },
          actionOptions: buildPhotoActionOptions(),
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
          incident: null,
          statusSummary: null,
          incidentDraftPreview: null,
        },
        snapshot: savedErr,
      };
    }

    const upload = await persistProcedurePhotoForChatSession({
      sessionId,
      userId: snapshot.userId || null,
      bytes: download.bytes,
      mimeType: download.mimeType || normalized.mimeType || "image/jpeg",
      originalName: normalized.caption || "whatsapp-imagen.jpg",
      preferredLocale: locale,
      origin: null,
    });

    if (upload.status !== 200 || !upload.snapshot) {
      console.error("[whatsapp] persist photo after download failed", { ...logBase, status: upload.status });
      return upload;
    }

    const patchedCollected = {
      ...upload.snapshot.collectedData,
      photoWhatsappMediaId: normalized.mediaId,
      photoAttachmentChannel: "whatsapp",
      photoDownloadStatus: "ok",
      photoCaption: (normalized.caption || "").slice(0, 500),
    };
    const nextStep = getNextIncidentFlowStep(patchedCollected);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;

    const savedPhoto = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale,
        userId: upload.snapshot.userId || null,
        collectedData: patchedCollected,
        currentStep: nextStep,
        confirmationState: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none",
        lastInterpretation: {
          ...(upload.snapshot.lastInterpretation || {}),
          whatsappInbound: { type: "image", persisted: true, mediaId: normalized.mediaId },
        },
        lastIntent: upload.snapshot.lastIntent || "report_incident",
        lastAction: "whatsapp_image_accepted",
        lastConfidence: upload.snapshot.lastConfidence,
        state: nextState,
      })
    );

    console.info("[whatsapp] image persisted as incident evidence", {
      ...logBase,
      mimeType: download.mimeType,
    });

    if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
      await track({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
        mode: "incident",
        outcome: "ready_after_whatsapp_image",
      });
    }

    return {
      status: 200,
      body: {
        ...upload.body,
        replyText:
          nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
            ? `Foto recibida como evidencia.\n\n${buildIncidentConfirmationIntroReply(locale, {
                channel: "whatsapp",
                collectedData: patchedCollected,
              })}`
            : `Foto recibida como evidencia.\n\n${buildQuestionForStep({
                step: nextStep,
                channel: "whatsapp",
              })}`,
        draft: { ...patchedCollected, missingFields: [] },
        nextStep:
          nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
            ? { type: "confirm_incident", field: null }
            : { type: "ask_field", field: nextStep },
        actionOptions:
          nextStep === CHATBOT_CURRENT_STEPS.PHOTO
            ? buildPhotoActionOptions()
            : [],
        incidentDraftPreview:
          nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
            ? buildIncidentDraftPreviewPayload(patchedCollected)
            : null,
      },
      snapshot: savedPhoto,
    };
  }

  if (
    (normalized.type === "location" || normalized.type === "image") &&
    (!currentField?.type || normalized.type !== currentField.type)
  ) {
    const expected = currentField?.type === "location" ? "location" : "image";
    console.info("[whatsapp] structured message rejected for wrong step", {
      ...logBase,
      expectedStep: expected,
    });
    await track({
      eventName: CHATBOT_TELEMETRY_EVENTS.ENTITIES_REJECTED,
      mode: "incident",
      outcome: `whatsapp_${normalized.type}_wrong_step`,
      details: `expected=${expected} got=${snapshot.currentStep}`,
    });
    const hint =
      normalized.type === "location"
        ? "Ahora no estamos pidiendo ubicación en pin. Seguí el paso actual con texto, o esperá a que el asistente vuelva a pedirte la ubicación."
        : "Ahora no estamos pidiendo foto. Cuando llegue el paso de evidencia podés enviar la imagen, o respondé «sin foto» si no querés adjuntar.";

    return {
      status: 200,
      body: {
        sessionId,
        locale,
        replyText: `${hint}\n\n${buildQuestionForStep({ step: snapshot.currentStep, channel: "whatsapp" })}`,
        intent: snapshot.lastIntent || null,
        confidence: snapshot.lastConfidence || null,
        fulfillmentMessages: [],
        action: "whatsapp_structured_wrong_step",
        parameters: {},
        mode: "incident",
        draft: { ...(snapshot.collectedData || {}), missingFields: [] },
        nextStep: { type: "ask_field", field: snapshot.currentStep },
        actionOptions:
          snapshot.currentStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        redirectTo: null,
        redirectLabel: null,
        needsClarification: false,
        incident: null,
        statusSummary: null,
        incidentDraftPreview: null,
      },
      snapshot,
    };
  }

  return null;
}


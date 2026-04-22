import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  getSessionSnapshot,
  setConversationState,
} from "./chatSessionStore";
import {
  FLOW_KEY_INCIDENT,
  buildConfirmationActionOptions,
  buildIncidentConfirmationIntroReply,
  buildIncidentDraftPreviewPayload,
  createIncidentFlowSnapshotPatch,
} from "./chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "./chatbotTelemetry";
import path from "path";
import { getIncidentAttachmentStorage } from "./attachments/getIncidentAttachmentStorage";

function normalizeNameField(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function buildIncidentPhotoUploadResponseBody({
  sessionId,
  locale,
  replyText,
  snapshot,
  photoPreviewUrl,
}) {
  const collectedData = snapshot?.collectedData || {};
  const missingFields = Array.isArray(snapshot?.missingFields) ? snapshot.missingFields : [];
  return {
    sessionId,
    locale,
    replyText,
    intent: snapshot?.lastIntent || null,
    confidence: snapshot?.lastConfidence || null,
    fulfillmentMessages: [],
    action: snapshot?.lastAction || null,
    parameters: {},
    mode: "incident",
    draft: {
      ...collectedData,
      missingFields,
    },
    nextStep: {
      type: "confirm_incident",
      field: null,
    },
    actionOptions: buildConfirmationActionOptions(),
    redirectTo: null,
    redirectLabel: null,
    needsClarification: false,
    incident: null,
    statusSummary: null,
    photoPreviewUrl: photoPreviewUrl || null,
    incidentDraftPreview: buildIncidentDraftPreviewPayload(collectedData),
  };
}

/**
 * Guarda la imagen vía el proveedor de adjuntos configurado, actualiza la sesión del chat y deja el flujo listo para confirmar.
 */
export async function persistIncidentPhotoForChatSession({
  sessionId,
  userId,
  bytes,
  mimeType,
  originalName,
  preferredLocale,
  origin,
}) {
  const snapshot = await getSessionSnapshot(sessionId);
  if (!snapshot) {
    return { status: 404, body: { error: "No encontramos la sesión del chat." } };
  }
  if (snapshot.flowKey !== FLOW_KEY_INCIDENT) {
    return { status: 400, body: { error: "Esta conversación no admite adjuntar foto en este momento." } };
  }
  if (snapshot.currentStep !== CHATBOT_CURRENT_STEPS.PHOTO) {
    return { status: 400, body: { error: "El adjunto no corresponde al paso actual del reporte." } };
  }
  if (snapshot.state !== CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE) {
    return { status: 400, body: { error: "Esperá a estar en el paso de foto para adjuntar la imagen." } };
  }
  const photoStatus = snapshot.collectedData?.photoStatus || "not_requested";
  if (photoStatus !== "not_requested" && photoStatus !== "pending_upload") {
    return { status: 400, body: { error: "Ya se registró una decisión sobre la foto para este borrador." } };
  }
  if (snapshot.userId && userId && snapshot.userId !== userId) {
    return { status: 403, body: { error: "No podés modificar esta sesión." } };
  }

  const storage = getIncidentAttachmentStorage();
  const uploadResult = await storage.uploadDraftAttachment({
    sessionId,
    bytes,
    mimeType: String(mimeType || "").toLowerCase().trim(),
  });
  if (!uploadResult.ok) {
    return { status: 400, body: { error: uploadResult.error } };
  }

  const safeOriginal = normalizeNameField(originalName, 200) || "imagen";
  const nextCollected = {
    ...snapshot.collectedData,
    photoStatus: "provided",
    photoAttachmentStorageProvider: uploadResult.storageProvider,
    photoAttachmentStorageKey: uploadResult.storageKey,
    photoAttachmentPublicUrl: uploadResult.publicUrl || "",
    photoAttachmentSizeBytes: uploadResult.sizeBytes,
    photoAttachmentOriginalName: safeOriginal,
    photoAttachmentStoredFilename: normalizeNameField(path.basename(uploadResult.storageKey), 120),
    photoAttachmentMimeType: normalizeNameField(mimeType, 80),
    photoAttachmentUploadedAt: new Date().toISOString(),
  };

  const effectiveLocale = normalizeNameField(preferredLocale, 12) || snapshot.locale || "es";

  let updatedSnapshot;
  try {
    updatedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: userId || snapshot.userId || null,
        collectedData: nextCollected,
        currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: "ready",
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: "incident_photo_uploaded",
        lastConfidence: snapshot.lastConfidence,
        state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      })
    );
  } catch (error) {
    console.error("[chatbotIncidentPhotoUpload] Falló la actualización de sesión; se revierte el adjunto.", {
      sessionId,
      message: error?.message,
    });
    try {
      await storage.deleteDraftAttachment({
        storageProvider: uploadResult.storageProvider,
        storageKey: uploadResult.storageKey,
        publicUrl: uploadResult.publicUrl,
        mimeType: normalizeNameField(mimeType, 80) || "application/octet-stream",
        sizeBytes: uploadResult.sizeBytes,
      });
    } catch {
      // ignore
    }
    return {
      status: 500,
      body: {
        error:
          "No se pudo confirmar el adjunto en la conversación. Intentá subir la imagen de nuevo o respondé «sin foto» si no querés adjuntar.",
      },
    };
  }

  try {
    await trackChatbotEvent({
      sessionId,
      locale: effectiveLocale,
      userId: userId || snapshot.userId || null,
      command: "incident_photo_upload",
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
      mode: "incident",
      outcome: "ready_after_photo_upload",
    });
  } catch (error) {
    console.warn("[chatbotIncidentPhotoUpload] Telemetría no registrada", error?.message);
  }

  const baseOrigin =
    typeof origin === "string" && origin.startsWith("http")
      ? origin.replace(/\/$/, "")
      : "";
  const photoPreviewUrl = baseOrigin
    ? `${baseOrigin}/api/chatbot/incident-photo/file?sessionId=${encodeURIComponent(sessionId)}`
    : null;

  const replyText = buildIncidentConfirmationIntroReply(
    updatedSnapshot.locale || effectiveLocale
  );
  return {
    status: 200,
    body: buildIncidentPhotoUploadResponseBody({
      sessionId,
      locale: updatedSnapshot.locale || effectiveLocale,
      replyText,
      snapshot: updatedSnapshot,
      photoPreviewUrl,
    }),
    snapshot: updatedSnapshot,
  };
}

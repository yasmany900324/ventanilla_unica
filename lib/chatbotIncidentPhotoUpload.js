import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  getSessionSnapshot,
  setConversationState,
} from "./chatSessionStore";
import {
  FLOW_KEY_INCIDENT,
  buildConfirmationActionOptions,
  buildIncidentResumeReply,
  createIncidentFlowSnapshotPatch,
} from "./chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "./chatbotTelemetry";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TO_EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function normalizeNameField(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function getChatbotIncidentPhotoDir() {
  return path.join(process.cwd(), "data", "chatbot-incident-photos");
}

export function isSafeStoredPhotoBasename(name) {
  if (typeof name !== "string") {
    return false;
  }
  return /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i.test(name);
}

export async function writeIncidentPhotoFile(bytes, mimeType) {
  const ext = ALLOWED_MIME_TO_EXT.get(mimeType);
  if (!ext) {
    return { ok: false, error: "Tipo de archivo no permitido. Usá JPG, PNG, WebP o GIF." };
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, error: "No se recibió ningún archivo." };
  }
  if (bytes.length > MAX_BYTES) {
    return { ok: false, error: "La imagen supera el tamaño máximo permitido (5 MB)." };
  }
  const storedFilename = `${randomUUID()}.${ext}`;
  const dir = getChatbotIncidentPhotoDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedFilename), bytes);
  return { ok: true, storedFilename };
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
  };
}

/**
 * Guarda la imagen en disco, actualiza la sesión del chat y deja el flujo listo para confirmar.
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
  const writeResult = await writeIncidentPhotoFile(bytes, mimeType);
  if (!writeResult.ok) {
    return { status: 400, body: { error: writeResult.error } };
  }

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

  const safeOriginal = normalizeNameField(originalName, 200) || "imagen";
  const nextCollected = {
    ...snapshot.collectedData,
    photoStatus: "provided",
    photoAttachmentOriginalName: safeOriginal,
    photoAttachmentStoredFilename: writeResult.storedFilename,
    photoAttachmentMimeType: normalizeNameField(mimeType, 80),
    photoAttachmentUploadedAt: new Date().toISOString(),
  };

  const effectiveLocale = normalizeNameField(preferredLocale, 12) || snapshot.locale || "es";

  const updatedSnapshot = await setConversationState(
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

  const baseOrigin =
    typeof origin === "string" && origin.startsWith("http")
      ? origin.replace(/\/$/, "")
      : "";
  const photoPreviewUrl = baseOrigin
    ? `${baseOrigin}/api/chatbot/incident-photo/file?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(writeResult.storedFilename)}`
    : null;

  const replyText = buildIncidentResumeReply(updatedSnapshot.collectedData);
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

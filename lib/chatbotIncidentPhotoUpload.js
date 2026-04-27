import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  getSessionSnapshot,
  setConversationState,
} from "./chatSessionStore";
import {
  FLOW_KEY_INCIDENT,
  FLOW_KEY_PROCEDURE,
  buildIncidentConfirmationIntroReply,
  buildIncidentDraftPreviewPayload,
  buildQuestionForStep,
  createIncidentFlowSnapshotPatch,
  createProcedureFlowSnapshotPatch,
  getNextIncidentFlowStep,
} from "./chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "./chatbotTelemetry";
import path from "path";
import { getIncidentAttachmentStorage } from "./attachments/getIncidentAttachmentStorage";
import {
  buildProcedureDraftConfirmationText,
  getProcedureFieldDefinition,
  getProcedureMissingFieldsFromDefinition,
  normalizeProcedureCollectedData,
} from "./procedureCatalog";

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
  nextStep,
  actionOptions,
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
      type: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "confirm_incident" : "ask_field",
      field: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? null : nextStep,
    },
    actionOptions: Array.isArray(actionOptions) ? actionOptions : [],
    redirectTo: null,
    redirectLabel: null,
    needsClarification: false,
    incident: null,
    statusSummary: null,
    photoPreviewUrl: photoPreviewUrl || null,
    incidentDraftPreview: buildIncidentDraftPreviewPayload(collectedData),
  };
}

function buildProcedurePhotoUploadResponseBody({
  sessionId,
  locale,
  replyText,
  snapshot,
  nextStep,
  missingFields,
  photoPreviewUrl,
}) {
  const collectedData = snapshot?.collectedData || {};
  return {
    sessionId,
    locale,
    replyText,
    intent: snapshot?.lastIntent || null,
    confidence: snapshot?.lastConfidence || null,
    fulfillmentMessages: [],
    action: snapshot?.lastAction || null,
    parameters: {},
    mode: "procedure",
    draft: {
      ...collectedData,
      missingFields: Array.isArray(missingFields) ? missingFields : [],
    },
    nextStep: {
      type: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "procedure_confirm" : "ask_field",
      field: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? null : nextStep,
    },
    actionOptions: [],
    redirectTo: null,
    redirectLabel: null,
    needsClarification: false,
    incident: null,
    statusSummary: null,
    photoPreviewUrl: photoPreviewUrl || null,
    incidentDraftPreview: null,
  };
}

function buildProcedureFieldPrompt(fieldDefinition, procedureName = "") {
  const normalizedProcedureName = normalizeNameField(procedureName, 160);
  if (!fieldDefinition || typeof fieldDefinition !== "object") {
    return normalizedProcedureName
      ? `Para continuar con "${normalizedProcedureName}", indícame el siguiente dato requerido.`
      : "Para continuar con este trámite, indícame el siguiente dato requerido.";
  }
  if (fieldDefinition.type === "location") {
    return "Ahora enviame la ubicación del problema.";
  }
  if (fieldDefinition.prompt) {
    return fieldDefinition.prompt;
  }
  return `Para continuar, indícame ${fieldDefinition.label || "el dato requerido"}.`;
}

async function persistProcedureFlowPhotoForChatSession({
  sessionId,
  userId,
  bytes,
  mimeType,
  originalName,
  preferredLocale,
  snapshot,
}) {
  const procedureData = normalizeProcedureCollectedData(snapshot?.collectedData || {});
  const fieldDefinitions = Array.isArray(procedureData.procedureFieldDefinitions)
    ? procedureData.procedureFieldDefinitions
    : Array.isArray(procedureData.procedureRequiredFields)
      ? procedureData.procedureRequiredFields
    : [];

  const normalizedCurrentStep = normalizeNameField(snapshot?.currentStep, 80).toLowerCase();
  const fieldFromStep = getProcedureFieldDefinition(fieldDefinitions, normalizedCurrentStep);
  const missingFieldsBefore = getProcedureMissingFieldsFromDefinition(fieldDefinitions, procedureData);
  const firstMissingField = missingFieldsBefore[0] || null;
  const fieldFromMissing = getProcedureFieldDefinition(fieldDefinitions, firstMissingField);
  const targetField =
    fieldFromStep?.type === "image"
      ? fieldFromStep
      : fieldFromMissing?.type === "image"
        ? fieldFromMissing
        : null;

  if (!targetField || targetField.type !== "image") {
    return {
      status: 400,
      body: {
        error:
          "El campo actual no espera una imagen. Contame primero qué necesitás hacer para asociar el adjunto al trámite correcto.",
      },
    };
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
  const publicUrl = normalizeNameField(uploadResult.publicUrl, 2000);
  const canonicalImage = publicUrl
    ? Object.fromEntries(
        Object.entries({
          url: publicUrl,
          filename: safeOriginal,
          mimeType: normalizeNameField(mimeType, 80) || null,
          size: Number.isFinite(uploadResult.sizeBytes) ? uploadResult.sizeBytes : null,
        }).filter(([, v]) => v != null && v !== "")
      )
    : { filename: safeOriginal };
  const nextCollected = {
    ...procedureData,
    [targetField.key]: canonicalImage,
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
  const missingFieldsAfter = getProcedureMissingFieldsFromDefinition(fieldDefinitions, nextCollected);
  const nextStep = missingFieldsAfter.length > 0 ? missingFieldsAfter[0] : CHATBOT_CURRENT_STEPS.CONFIRMATION;
  const nextState =
    nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
      ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
      : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
  const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";
  const effectiveLocale = normalizeNameField(preferredLocale, 12) || snapshot.locale || "es";

  let updatedSnapshot;
  try {
    updatedSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: userId || snapshot.userId || null,
        collectedData: nextCollected,
        currentStep: nextStep,
        confirmationState,
        lastInterpretation: snapshot.lastInterpretation || {},
        lastIntent: snapshot.lastIntent || "start_procedure",
        lastAction: "procedure_photo_uploaded",
        lastConfidence: snapshot.lastConfidence,
        state: nextState,
      })
    );
  } catch (error) {
    console.error("[chatbotProcedurePhotoUpload] Falló la actualización de sesión (procedure); se revierte el adjunto.", {
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
        error: "No se pudo confirmar el adjunto en la conversación. Intentá subir la imagen de nuevo.",
      },
    };
  }

  const replyText =
    nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
      ? buildProcedureDraftConfirmationText({
          procedureName: nextCollected.procedureName,
          fieldDefinitions,
          collectedData: nextCollected,
        })
      : buildProcedureFieldPrompt(
          getProcedureFieldDefinition(fieldDefinitions, nextStep),
          nextCollected.procedureName
        );
  const baseOrigin =
    typeof origin === "string" && origin.startsWith("http")
      ? origin.replace(/\/$/, "")
      : "";
  const photoPreviewUrl = baseOrigin
    ? `${baseOrigin}/api/chatbot/procedure-photo/file?sessionId=${encodeURIComponent(sessionId)}`
    : null;

  return {
    status: 200,
    body: buildProcedurePhotoUploadResponseBody({
      sessionId,
      locale: updatedSnapshot.locale || effectiveLocale,
      replyText,
      snapshot: updatedSnapshot,
      nextStep,
      missingFields: missingFieldsAfter,
      photoPreviewUrl,
    }),
    snapshot: updatedSnapshot,
  };
}

/**
 * Guarda la imagen vía el proveedor de adjuntos configurado, actualiza la sesión del chat y deja el flujo listo para confirmar.
 */
export async function persistProcedurePhotoForChatSession({
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
  if (snapshot.flowKey === FLOW_KEY_PROCEDURE) {
    return persistProcedureFlowPhotoForChatSession({
      sessionId,
      userId,
      bytes,
      mimeType,
      originalName,
      preferredLocale,
      snapshot,
    });
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
  const nextStep = getNextIncidentFlowStep(nextCollected);
  const nextState =
    nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
      ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
      : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
  const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";

  let updatedSnapshot;
  try {
    updatedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: userId || snapshot.userId || null,
        collectedData: nextCollected,
        currentStep: nextStep,
        confirmationState,
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: "incident_photo_uploaded",
        lastConfidence: snapshot.lastConfidence,
        state: nextState,
      })
    );
  } catch (error) {
    console.error("[chatbotProcedurePhotoUpload] Falló la actualización de sesión; se revierte el adjunto.", {
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

  if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
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
      console.warn("[chatbotProcedurePhotoUpload] Telemetría no registrada", error?.message);
    }
  }

  const baseOrigin =
    typeof origin === "string" && origin.startsWith("http")
      ? origin.replace(/\/$/, "")
      : "";
  const photoPreviewUrl = baseOrigin
      ? `${baseOrigin}/api/chatbot/procedure-photo/file?sessionId=${encodeURIComponent(sessionId)}`
    : null;

  const replyText =
    nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
      ? buildIncidentConfirmationIntroReply(updatedSnapshot.locale || effectiveLocale, {
          channel: "web",
          collectedData: updatedSnapshot.collectedData,
        })
      : buildQuestionForStep({
          step: nextStep,
          channel: "web",
        });
  return {
    status: 200,
    body: buildIncidentPhotoUploadResponseBody({
      sessionId,
      locale: updatedSnapshot.locale || effectiveLocale,
      replyText,
      snapshot: updatedSnapshot,
      photoPreviewUrl,
      nextStep,
      actionOptions: [],
    }),
    snapshot: updatedSnapshot,
  };
}


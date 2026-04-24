import { CHATBOT_CONVERSATION_STATES, CHATBOT_CURRENT_STEPS } from "./chatSessionStore";
import { extractIncidentDraftFromText } from "./chatbotIncidentMapper";
import { formatIncidentCode } from "./incidentDisplay";

export const FLOW_KEY_INCIDENT = "incident.general";
export const FLOW_KEY_PROCEDURE = "procedure.general_start";

const FLOW_CONFIDENCE_WEAK = 0.6;
const ENTITY_CONFIDENCE_ACCEPT = 0.7;
const ENTITY_CONFIDENCE_REPROMPT = 0.5;
const MAX_FIELD_LENGTH = 320;
const DEFAULT_INCIDENT_REQUIRED_FIELDS = [
  { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
  { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
  { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
];

const CONFIRM_COMMAND_TEXTS = new Set([
  "confirmar",
  "confirmo",
  "confirmacion",
  "confirmar incidencia",
  "confirmar reporte",
  "enviar incidencia",
  "enviar reporte",
]);
const CANCEL_COMMAND_TEXTS = new Set([
  "cancelar",
  "cancela",
  "cancelar incidencia",
  "cancelar reporte",
  "salir",
  "detener",
  "anular",
]);
const PHOTO_SKIP_TEXTS = new Set(["omitir foto", "sin foto", "no tengo foto", "saltar foto"]);
const PHOTO_PENDING_TEXTS = new Set([
  "adjuntar foto",
  "quiero adjuntar foto",
  "subir foto",
  "tengo foto",
]);
const PROCEDURE_INTENT_WORDS = [
  "quiero iniciar un tramite",
  "necesito hacer un tramite",
  "necesito realizar una gestion",
  "quiero realizar una gestion",
  "iniciar tramite",
  "iniciar un tramite",
  "hacer un tramite",
  "tramite",
  "trámite",
  "gestionar",
  "gestion",
  "gestion",
  "solicitud",
  "procedimiento",
];
const INCIDENT_INTENT_WORDS = [
  "quiero reportar una incidencia",
  "necesito reportar una incidencia",
  "quiero reportar un problema",
  "reportar incidencia",
  "reportar problema",
  "quiero crear una incidencia",
  "necesito crear una incidencia",
  "crear una incidencia",
  "crear incidencia",
  "incidencia",
  "problema",
  "reclamo",
];

function normalizeForLookup(value) {
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

function normalizeFieldValue(value, maxLength = MAX_FIELD_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function extractLikelyLocationFromText(text) {
  const normalizedText = normalizeFieldValue(text);
  if (!normalizedText) {
    return "";
  }

  const match = normalizedText.match(/\ben\s+([A-Za-zÀ-ÿ0-9\s#.,-]{4,120})/i);
  if (!match?.[1]) {
    return "";
  }

  return normalizeFieldValue(match[1])
    .replace(/\s+(?:y|e)\s+(?:no|ni)\b.*$/i, "")
    .replace(/\s+(?:porque|ya que|donde)\b.*$/i, "")
    .trim();
}

function normalizeIncidentRequiredFields(value) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_INCIDENT_REQUIRED_FIELDS];
  }
  const seen = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    if (!field || typeof field !== "object") {
      return;
    }
    const key = normalizeFieldValue(field.key, 60)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    const type = normalizeFieldValue(field.type, 24).toLowerCase() || "text";
    normalized.push({
      key,
      label: normalizeFieldValue(field.label || key, 120),
      prompt: normalizeFieldValue(field.prompt, 280),
      type,
      required: field.required !== false,
      order: Number.isInteger(field.order) ? field.order : index,
    });
  });
  if (!normalized.length) {
    return [...DEFAULT_INCIDENT_REQUIRED_FIELDS];
  }
  return normalized.sort((a, b) => a.order - b.order);
}

function getIncidentFieldDefinition(collectedData, fieldKey) {
  const normalizedKey = normalizeFieldValue(fieldKey, 60)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (!normalizedKey) {
    return null;
  }
  const defs = normalizeIncidentRequiredFields(collectedData?.incidentRequiredFields || []);
  return defs.find((field) => field.key === normalizedKey) || null;
}

function getIncidentRequiredMissingFields(collectedData) {
  const defs = normalizeIncidentRequiredFields(collectedData?.incidentRequiredFields || []);
  return defs
    .filter((field) => field.required !== false)
    .map((field) => field.key)
    .filter((fieldKey) => {
      const field = defs.find((item) => item.key === fieldKey);
      if (field?.type === "image") {
        const photoStatus = collectedData?.photoStatus || "not_requested";
        return photoStatus !== "provided";
      }
      return !normalizeFieldValue(collectedData?.[fieldKey], 320);
    });
}

/** Texto de cierre afirmativo (solo debe usarse cuando el snapshot ya está en etapa de confirmación). */
const AFFIRMATIVE_CONFIRMATION_PHRASES = new Set([
  "si",
  "sip",
  "sii",
  "dale",
  "ok",
  "oka",
  "oki",
  "okey",
  "correcto",
  "es correcto",
  "esta correcto",
  "esta bien",
  "de acuerdo",
  "perfecto",
  "listo",
  "vale",
  "bien",
  "confirmo",
  "confirmamos",
  "confirmado",
  "adelante",
  "genial",
  "claro",
  "exacto",
  "asi es",
  "todo bien",
  "todo listo",
  "todo ok",
  "dale si",
  "si dale",
  "si confirmo",
  "ok dale",
  "va bien",
  "crear",
  "registrar",
]);

/**
 * Afirmación corta natural (WhatsApp / español rioplatense o neutro).
 * Centraliza variantes con/sin tilde y espacios; evita frases largas ambiguas.
 * @param {string} text
 * @returns {boolean}
 */
export function isAffirmativeText(text) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return false;
  }
  if (AFFIRMATIVE_CONFIRMATION_PHRASES.has(normalized)) {
    return true;
  }
  if (normalized.length > 44) {
    return false;
  }
  if (/^(si|sip|sii)([!.]+)?$/.test(normalized)) {
    return true;
  }
  if (/^(ok|dale|vale)\s*[!.]*$/.test(normalized)) {
    return true;
  }
  if (/^(si|sip)\s*,\s*(dale|ok|listo|genial|va)\b/.test(normalized)) {
    return true;
  }
  if (/^(dale|va)\s*,\s*(si|sip|ok)\b/.test(normalized)) {
    return true;
  }
  if (/^si\s+esta\s+bien\b/.test(normalized) && normalized.length <= 22) {
    return true;
  }
  if (/^(exacto|perfecto)\b/.test(normalized) && normalized.length <= 22) {
    return true;
  }
  return false;
}

export function matchesAffirmativeConfirmationText(text) {
  return isAffirmativeText(text);
}

const CANCELLATION_TEXTS = new Set(["no", "cancelar", "cancela", "salir", "detener"]);

export function matchesCancellationText(text) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return false;
  }
  return CANCELLATION_TEXTS.has(normalized);
}

export function parseUserCommandFromText(text) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return { command: "none", commandField: null };
  }

  if (CONFIRM_COMMAND_TEXTS.has(normalized)) {
    return { command: "confirm", commandField: null };
  }
  if (CANCEL_COMMAND_TEXTS.has(normalized)) {
    return { command: "cancel", commandField: null };
  }
  if (PHOTO_SKIP_TEXTS.has(normalized)) {
    return { command: "skip_photo", commandField: null };
  }
  if (PHOTO_PENDING_TEXTS.has(normalized)) {
    return { command: "set_photo_pending", commandField: null };
  }

  if (normalized === "editar ubicacion") {
    return { command: "edit_field", commandField: "location" };
  }
  if (normalized === "editar descripcion") {
    return { command: "edit_field", commandField: "description" };
  }
  if (normalized === "editar foto") {
    return { command: "edit_field", commandField: "photo" };
  }

  const CORRECTION_MENU_TEXTS = new Set([
    "corregir datos",
    "quiero corregir datos",
    "cambiar datos",
    "quiero cambiar datos",
    "corregir algo",
    "hay que corregir algo",
  ]);
  if (CORRECTION_MENU_TEXTS.has(normalized)) {
    return { command: "request_text_correction", commandField: null };
  }

  const correctionPrefixMatch = normalized.match(
    /^(?:corregir|editar|cambiar|modificar)\s+(.{2,120})$/u
  );
  if (correctionPrefixMatch?.[1]) {
    return { command: "request_text_correction", commandField: correctionPrefixMatch[1].trim() };
  }

  return { command: "none", commandField: null };
}

export function shouldSwitchToProcedureFlow({ text, interpretation }) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return false;
  }

  const hasProcedureKeyword = PROCEDURE_INTENT_WORDS.some((keyword) =>
    normalized.includes(normalizeForLookup(keyword))
  );
  if (hasProcedureKeyword) {
    return true;
  }

  const intentKind = interpretation?.intent?.kind || "unknown";
  const confidence = interpretation?.intent?.confidence || 0;
  return intentKind === "start_procedure" && confidence >= FLOW_CONFIDENCE_WEAK;
}

export function shouldSwitchToIncidentFlow({ text, interpretation }) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return false;
  }

  const hasIncidentKeyword = INCIDENT_INTENT_WORDS.some((keyword) =>
    normalized.includes(normalizeForLookup(keyword))
  );
  if (hasIncidentKeyword) {
    return true;
  }

  const intentKind = interpretation?.intent?.kind || "unknown";
  const confidence = interpretation?.intent?.confidence || 0;
  return intentKind === "report_incident" && confidence >= FLOW_CONFIDENCE_WEAK;
}

function isReliableValue(entity) {
  if (!entity || typeof entity !== "object") {
    return false;
  }

  if (typeof entity.value !== "string" || !entity.value.trim()) {
    return false;
  }

  const confidence =
    typeof entity.confidence === "number" && Number.isFinite(entity.confidence)
      ? entity.confidence
      : 0;

  return confidence >= ENTITY_CONFIDENCE_ACCEPT;
}

function isLowConfidenceValue(entity) {
  if (!entity || typeof entity !== "object") {
    return false;
  }

  if (typeof entity.value !== "string" || !entity.value.trim()) {
    return false;
  }

  const confidence =
    typeof entity.confidence === "number" && Number.isFinite(entity.confidence)
      ? entity.confidence
      : 0;

  return confidence >= ENTITY_CONFIDENCE_REPROMPT && confidence < ENTITY_CONFIDENCE_ACCEPT;
}

export function buildIncidentFlowSeedFromContext(contextEntry) {
  return {
    category: "incidencia_general",
    subcategory: "reporte_general",
    description: normalizeFieldValue(contextEntry?.description || ""),
    location: "",
    incidentRequiredFields: [...DEFAULT_INCIDENT_REQUIRED_FIELDS],
    photoStatus: "not_requested",
  };
}

export function shouldActivateIncidentFlow({ interpretation, text, contextEntry }) {
  if (contextEntry?.kind === "incidencia") {
    return true;
  }

  return shouldSwitchToIncidentFlow({ text, interpretation });
}

export function mergeCollectedDataFromInterpretation({
  collectedData,
  interpretation,
  text,
  currentStep,
}) {
  const incidentRequiredFields = normalizeIncidentRequiredFields(
    collectedData?.incidentRequiredFields || []
  );
  const nextData = {
    category: normalizeFieldValue(collectedData?.category, 80),
    subcategory: normalizeFieldValue(collectedData?.subcategory, 120),
    location: normalizeFieldValue(collectedData?.location),
    description: normalizeFieldValue(collectedData?.description),
    incidentRequiredFields,
    photoStatus: collectedData?.photoStatus || "not_requested",
  };
  incidentRequiredFields.forEach((field) => {
    if (field.key === "photo") {
      return;
    }
    nextData[field.key] = normalizeFieldValue(collectedData?.[field.key], 320);
  });
  const acceptedEntities = [];
  const rejectedEntities = [];
  const lowConfidenceFields = [];

  const locationEntity = interpretation?.entities?.location || null;
  const descriptionEntity = interpretation?.entities?.description || null;
  const photoIntentEntity = interpretation?.entities?.photoIntent || null;
  const currentFieldDefinition = getIncidentFieldDefinition(nextData, currentStep) || null;
  const currentFieldKey = currentFieldDefinition?.key || normalizeFieldValue(currentStep, 60).toLowerCase();
  const isImageField = currentFieldDefinition?.type === "image";
  const isLocationField = currentFieldDefinition?.type === "location";

  // Solo aceptar entidades del LLM alineadas al paso actual: el texto libre del turno
  // se interpreta primero como respuesta al dato pendiente, no como nueva intención.
  if (isLocationField) {
    if (isReliableValue(locationEntity)) {
      nextData.location = normalizeFieldValue(locationEntity.value);
      nextData[currentFieldKey] = nextData.location;
      acceptedEntities.push(currentFieldKey);
    } else if (isLowConfidenceValue(locationEntity)) {
      lowConfidenceFields.push(currentFieldKey);
    } else if (locationEntity?.value) {
      rejectedEntities.push(currentFieldKey);
    }
  }

  if (!isImageField && !isLocationField && currentFieldKey) {
    if (isReliableValue(descriptionEntity)) {
      const normalizedValue = normalizeFieldValue(descriptionEntity.value);
      nextData[currentFieldKey] = normalizedValue;
      if (currentFieldKey === "description") {
        nextData.description = normalizedValue;
      }
      acceptedEntities.push(currentFieldKey);
    } else if (isLowConfidenceValue(descriptionEntity)) {
      lowConfidenceFields.push(currentFieldKey);
    } else if (descriptionEntity?.value) {
      rejectedEntities.push(currentFieldKey);
    }
  }

  if (isImageField && photoIntentEntity && typeof photoIntentEntity === "object") {
    const confidence =
      typeof photoIntentEntity.confidence === "number" ? photoIntentEntity.confidence : 0;
    if (confidence >= ENTITY_CONFIDENCE_ACCEPT) {
      if (photoIntentEntity.value === "wants_upload") {
        nextData.photoStatus = "pending_upload";
        acceptedEntities.push(currentFieldKey);
      } else if (photoIntentEntity.value === "skip_photo") {
        nextData.photoStatus = "skipped";
        acceptedEntities.push(currentFieldKey);
      }
    } else if (photoIntentEntity.value && confidence >= ENTITY_CONFIDENCE_REPROMPT) {
      lowConfidenceFields.push(currentFieldKey);
    }
  }

  const textFallback = extractIncidentDraftFromText(text || "");
  const locationFromText = extractLikelyLocationFromText(text || "");
  if (!nextData.location && textFallback.location && isLocationField) {
    nextData.location = normalizeFieldValue(textFallback.location);
    nextData[currentFieldKey] = nextData.location;
    acceptedEntities.push(currentFieldKey);
  }
  if (isLocationField && locationFromText) {
    nextData.location = normalizeFieldValue(locationFromText);
    nextData[currentFieldKey] = nextData.location;
    if (!acceptedEntities.includes(currentFieldKey)) {
      acceptedEntities.push(currentFieldKey);
    }
  }
  if (
    !isImageField &&
    !isLocationField &&
    currentFieldKey &&
    !nextData[currentFieldKey] &&
    textFallback.description &&
    currentFieldKey === "description"
  ) {
    nextData.description = normalizeFieldValue(textFallback.description);
    nextData[currentFieldKey] = nextData.description;
    acceptedEntities.push(currentFieldKey);
  }

  const lat = Number(collectedData?.locationLatitude);
  const lng = Number(collectedData?.locationLongitude);
  const preserved = {
    photoAttachmentStorageProvider: collectedData?.photoAttachmentStorageProvider || "",
    photoAttachmentStorageKey: collectedData?.photoAttachmentStorageKey || "",
    photoAttachmentPublicUrl: collectedData?.photoAttachmentPublicUrl || "",
    photoAttachmentSizeBytes: collectedData?.photoAttachmentSizeBytes || 0,
    photoAttachmentOriginalName: collectedData?.photoAttachmentOriginalName || "",
    photoAttachmentStoredFilename: collectedData?.photoAttachmentStoredFilename || "",
    photoAttachmentMimeType: collectedData?.photoAttachmentMimeType || "",
    photoAttachmentUploadedAt: collectedData?.photoAttachmentUploadedAt || "",
    photoWhatsappMediaId: collectedData?.photoWhatsappMediaId || "",
    photoAttachmentChannel: collectedData?.photoAttachmentChannel || "",
    photoDownloadStatus: collectedData?.photoDownloadStatus || "",
    photoCaption: typeof collectedData?.photoCaption === "string" ? collectedData.photoCaption.slice(0, 500) : "",
    photoDownloadError: typeof collectedData?.photoDownloadError === "string" ? collectedData.photoDownloadError.slice(0, 200) : "",
    locationLatitude: Number.isFinite(lat) ? lat : null,
    locationLongitude: Number.isFinite(lng) ? lng : null,
    locationAddressText: normalizeFieldValue(collectedData?.locationAddressText, 400),
    locationSource: normalizeFieldValue(collectedData?.locationSource, 80),
  };
  Object.assign(nextData, preserved);

  if (text && isLocationField && !nextData.location) {
    nextData.location = normalizeFieldValue(locationFromText || text);
    nextData[currentFieldKey] = nextData.location;
  }
  if (
    text &&
    !isImageField &&
    !isLocationField &&
    currentFieldKey &&
    !normalizeFieldValue(nextData[currentFieldKey], 320)
  ) {
    const normalizedValue = normalizeFieldValue(text);
    nextData[currentFieldKey] = normalizedValue;
    if (currentFieldKey === "description") {
      nextData.description = normalizedValue;
    }
  }

  return {
    collectedData: nextData,
    acceptedEntities,
    rejectedEntities,
    lowConfidenceFields,
  };
}

export function getNextIncidentFlowStep(collectedData) {
  const missingFields = getIncidentRequiredMissingFields(collectedData);
  if (missingFields.length > 0) {
    return missingFields[0];
  }
  return CHATBOT_CURRENT_STEPS.CONFIRMATION;
}

export function buildQuestionForStep({
  step,
  lowConfidence = false,
  channel = "web",
  fieldDefinition = null,
}) {
  const resolvedField =
    fieldDefinition && typeof fieldDefinition === "object"
      ? fieldDefinition
      : {
          key: normalizeFieldValue(step, 60).toLowerCase(),
          label: "",
          type:
            step === "photo" || step === CHATBOT_CURRENT_STEPS.PHOTO
              ? "image"
              : step === "location" || step === CHATBOT_CURRENT_STEPS.LOCATION
                ? "location"
                : "text",
        };
  let fallbackText = "Contame un poco más para seguir con el reporte.";

  if (resolvedField.type === "location") {
    if (channel === "whatsapp") {
      fallbackText = lowConfidence
        ? "No me quedó clara la ubicación. Enviá tu ubicación actual desde el clip (📎) o escribí una dirección o referencia."
        : "¿Dónde ocurrió? Podés enviar tu ubicación actual desde el clip (📎) o escribir una dirección o referencia.";
    } else {
      fallbackText = lowConfidence
        ? "No me quedó clara la ubicación. Indicá una dirección o referencia, o usá el mapa o tu ubicación actual."
        : "¿Dónde ocurrió? Indicá una dirección o referencia, o usá el mapa o tu ubicación actual.";
    }
  } else if (resolvedField.type === "image") {
    fallbackText =
      channel === "whatsapp"
        ? "Enviá una foto como evidencia. Si no podés adjuntarla en este momento, decímelo y te ayudo a continuar."
        : "Podés adjuntar una foto como evidencia. Si no podés cargarla en este momento, avisame y seguimos.";
  } else if (resolvedField.prompt) {
    fallbackText = resolvedField.prompt;
  } else if (resolvedField.label) {
    fallbackText = lowConfidence
      ? `No me quedó claro el dato "${resolvedField.label}". ¿Podés repetirlo?`
      : `Necesito ${resolvedField.label} para continuar.`;
  } else {
    fallbackText = lowConfidence
      ? "No me quedó claro ese dato. ¿Podés repetirlo?"
      : "¿Qué dato querés registrar para continuar?";
  }

  return fallbackText;
}

export function buildIncidentDescriptionStartReply() {
  return "Bien, cuentame que sucede.";
}

export function buildPhotoActionOptions({ canSkip = true } = {}) {
  const options = [
    {
      label: "Adjuntar foto",
      command: "set_photo_pending",
      value: "",
      commandField: null,
    },
  ];
  if (canSkip) {
    options.push({
      label: "Omitir foto",
      command: "skip_photo",
      value: "",
      commandField: null,
    });
  }
  return options;
}

/** Acciones principales en el paso de confirmación (portable a otros canales). */
export function buildConfirmationActionOptions() {
  return [
    {
      label: "Confirmar y crear incidencia",
      command: "confirm",
      value: "",
      commandField: null,
    },
    {
      label: "Corregir datos",
      command: "open_incident_correction_menu",
      value: "",
      commandField: null,
    },
    {
      label: "Cancelar",
      command: "cancel",
      value: "",
      commandField: null,
    },
  ];
}

/** Segunda capa: qué campo reabrir antes de volver al resumen. */
export function buildIncidentCorrectionMenuActionOptions(collectedData = null) {
  const definitions = normalizeIncidentRequiredFields(collectedData?.incidentRequiredFields || []);
  const fieldOptions = definitions
    .filter((field) => field.required !== false)
    .map((field) => ({
      label: field.label || field.key,
      command: "edit_field",
      value: "",
      commandField: field.key,
    }));
  return [
    ...fieldOptions,
    {
      label: "Volver al resumen",
      command: "resume_confirmation",
      value: "",
      commandField: null,
    },
  ];
}

export function buildIncidentCorrectionMenuReply() {
  return "Decime qué dato querés corregir. Cuando termines, podés volver al resumen para revisar todo junto otra vez.";
}

export function buildCancelledIncidentReply() {
  return "Listo, cancele este borrador. Si queres, puedo ayudarte a iniciar un nuevo reporte.";
}

export function buildAuthRequiredReply() {
  return "Para crear la incidencia necesitas iniciar sesion. Cuando ingreses, vuelve al chat y retomamos desde la confirmacion.";
}

function sanitizePhotoDisplayName(name) {
  if (typeof name !== "string") {
    return "";
  }
  return name.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 160);
}

function normalizeConfirmationLocale(locale) {
  const raw = typeof locale === "string" ? locale.trim().toLowerCase() : "";
  if (raw.startsWith("en")) {
    return "en";
  }
  if (raw.startsWith("pt")) {
    return "pt";
  }
  return "es";
}

const INCIDENT_CONFIRMATION_INTRO = {
  es: "Perfecto. Te muestro el resumen para que lo revises antes de registrarlo.",
  en: "Great—here's a quick summary of the report so you can review it before we register it.",
  pt: "Perfeito. Segue o resumo para você revisar antes de registrarmos o relato.",
};

/**
 * Resumen en texto plano para WhatsApp antes de confirmar la incidencia.
 * @param {object} collectedData
 * @returns {string}
 */
export function buildWhatsAppIncidentSummaryPlainText(collectedData) {
  const preview = buildIncidentDraftPreviewPayload(collectedData);
  const procedureLine = preview?.procedureLabel || "Registrar incidencia";
  const typeLine = preview?.typeLabel || "Incidencia";
  const fieldLines = Array.isArray(preview?.fields)
    ? preview.fields.map((field) => `- ${field.label}: ${field.value}`)
    : [];
  return [`Resumen del reporte:`, `- Procedimiento: ${procedureLine}`, `- Tipo: ${typeLine}`, ...fieldLines].join(
    "\n"
  );
}

/**
 * Texto breve antes del bloque estructurado de vista previa (confirmación de incidencia).
 * @param {string} [locale]
 * @param {{ channel?: 'web'|'whatsapp', collectedData?: object } | null} [options]
 */
export function buildIncidentConfirmationIntroReply(locale = "es", options = null) {
  const key = normalizeConfirmationLocale(locale);
  const intro = INCIDENT_CONFIRMATION_INTRO[key] || INCIDENT_CONFIRMATION_INTRO.es;
  if (options?.collectedData) {
    const summary = buildWhatsAppIncidentSummaryPlainText(options.collectedData);
    const closing =
      key === "en"
        ? "Do you confirm that I should register this report with this data? Reply yes to confirm, no to cancel, or write what you want to correct."
        : key === "pt"
          ? "Você confirma que devo registrar este relato com esses dados? Responda sim para confirmar, não para cancelar, ou escreva qual dado deseja corrigir."
          : "¿Confirmás que registre esta incidencia con estos datos?\n\nRespondé sí para confirmar, no para cancelar, o escribí qué dato querés corregir.";
    return `${intro}\n\n${summary}\n\n${closing}`;
  }
  return intro;
}

/**
 * Cuando el usuario escribe texto ambiguo en el paso de confirmación (solo texto; la UI web tiene botones).
 * @param {'web'|'whatsapp'} channel
 */
export function buildIncidentConfirmationGateReply(channel = "web") {
  void channel;
  return "No terminé de entenderte. Respondé sí para confirmar, no para cancelar, o escribí qué dato querés corregir.";
}

function toReadableProcedureNameFromCode(code) {
  const normalized = normalizeFieldValue(code || "", 120).toLowerCase();
  if (!normalized) {
    return "Registrar incidencia";
  }
  const spaced = normalized.replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatIncidentLocationValue(collectedData, fieldKey) {
  const fromField = normalizeFieldValue(collectedData?.[fieldKey] || "", 320);
  if (fromField) {
    return fromField;
  }
  const fromAddress = normalizeFieldValue(collectedData?.locationAddressText || "", 320);
  if (fromAddress) {
    return fromAddress;
  }
  const lat = Number(collectedData?.locationLatitude);
  const lng = Number(collectedData?.locationLongitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  return "(pendiente)";
}

function formatIncidentFieldSummaryValue(field, collectedData) {
  if (!field || typeof field !== "object") {
    return "(pendiente)";
  }
  if (field.type === "image") {
    const hasPhoto =
      collectedData?.photoStatus === "provided" ||
      Boolean(normalizeFieldValue(collectedData?.photoAttachmentStorageKey || "", 200)) ||
      Boolean(normalizeFieldValue(collectedData?.photoAttachmentPublicUrl || "", 200));
    if (hasPhoto) {
      const fileName = sanitizePhotoDisplayName(collectedData?.photoAttachmentOriginalName || "");
      return fileName || "Adjunta";
    }
    return field.required === false ? "No adjunta" : "(pendiente)";
  }
  if (field.type === "location") {
    return formatIncidentLocationValue(collectedData, field.key);
  }
  const value = normalizeFieldValue(collectedData?.[field.key] || "", 320);
  return value || "(pendiente)";
}

function buildIncidentSummaryFieldRows(collectedData) {
  const definitions = normalizeIncidentRequiredFields(collectedData?.incidentRequiredFields || []);
  return definitions.map((field) => ({
    key: field.key,
    label: field.label || field.key,
    type: field.type || "text",
    value: formatIncidentFieldSummaryValue(field, collectedData),
  }));
}

function buildIncidentProcedureLabel(collectedData) {
  const fromCode = normalizeFieldValue(collectedData?.catalogItemCode || "", 120);
  if (fromCode) {
    return toReadableProcedureNameFromCode(fromCode);
  }
  return "Registrar incidencia";
}

/**
 * Carga útil para vista previa estructurada antes de crear la incidencia (web / otros canales).
 * Sin número de ticket ni nombre de archivo.
 */
export function buildIncidentDraftPreviewPayload(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  return {
    kind: "incident_draft",
    procedureLabel: buildIncidentProcedureLabel(collectedData),
    typeLabel: "Incidencia",
    fields: buildIncidentSummaryFieldRows(collectedData),
  };
}

/** @deprecated Usar buildIncidentConfirmationIntroReply; se mantiene por compatibilidad con llamadas antiguas. */
export function buildIncidentResumeReply(collectedData, locale = "es") {
  void collectedData;
  return buildIncidentConfirmationIntroReply(locale);
}

export function buildIncidentCreatedReply({ incidentId, channel = "web" } = {}) {
  const displayCode = formatIncidentCode(incidentId);
  if (channel === "whatsapp") {
    return `Incidencia creada correctamente. Código del caso: ${displayCode}.
Guardá ese código: desde este mismo chat podés consultarme el estado cuando quieras enviándolo en un mensaje.`;
  }
  return `Incidencia creada correctamente. Código del caso: ${displayCode}.
Podés consultar el seguimiento más adelante desde «Mis incidencias».`;
}

export function buildProcedureStartReply() {
  return "Entiendo. Voy a ayudarte con este trámite.";
}

export function buildProcedureDetailsReply(procedureName) {
  return `Perfecto. Para avanzar con el trámite "${procedureName}", cuéntame brevemente qué necesitas gestionar y, si tienes un dato clave, inclúyelo ahora.`;
}

export function buildProcedureSummaryReply({ procedureName, procedureDetails }) {
  return `Quedó registrado para orientarte:\n- Trámite: ${procedureName}\n- Necesidad: ${procedureDetails}\n\nSiguiente acción: continuaré con la clasificación específica y te indicaré el canal o requisito inicial para iniciarlo.`;
}

export function createIncidentFlowSnapshotPatch({
  locale,
  userId,
  collectedData,
  currentStep,
  confirmationState,
  lastInterpretation,
  lastIntent,
  lastAction,
  lastConfidence,
  state,
}) {
  return {
    locale,
    userId,
    state,
    flowKey: FLOW_KEY_INCIDENT,
    currentStep,
    confirmationState,
    collectedData,
    lastInterpretation,
    lastIntent,
    lastAction,
    lastConfidence,
  };
}

export function createProcedureFlowSnapshotPatch({
  locale,
  userId,
  collectedData,
  currentStep,
  confirmationState,
  lastInterpretation,
  lastIntent,
  lastAction,
  lastConfidence,
  state = CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
}) {
  return {
    locale,
    userId,
    state,
    flowKey: FLOW_KEY_PROCEDURE,
    currentStep,
    confirmationState,
    collectedData,
    lastInterpretation,
    lastIntent,
    lastAction,
    lastConfidence,
  };
}

export function isIncidentFlowActive(snapshot) {
  return (
    snapshot?.flowKey === FLOW_KEY_INCIDENT &&
    snapshot?.state !== CHATBOT_CONVERSATION_STATES.CLOSED
  );
}

export function isProcedureFlowActive(snapshot) {
  return (
    snapshot?.flowKey === FLOW_KEY_PROCEDURE &&
    snapshot?.state !== CHATBOT_CONVERSATION_STATES.CLOSED
  );
}

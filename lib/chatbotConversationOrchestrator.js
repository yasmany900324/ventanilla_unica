import { CHATBOT_CONVERSATION_STATES, CHATBOT_CURRENT_STEPS } from "./chatSessionStore";
import { extractIncidentDraftFromText } from "./chatbotIncidentMapper";

export const FLOW_KEY_INCIDENT = "incident.general";
export const FLOW_KEY_PROCEDURE = "procedure.general_start";

const FLOW_CONFIDENCE_WEAK = 0.6;
const ENTITY_CONFIDENCE_ACCEPT = 0.7;
const ENTITY_CONFIDENCE_REPROMPT = 0.5;
const MAX_FIELD_LENGTH = 320;
const RISK_VALUES = ["alto", "medio", "bajo"];

const CONFIRM_COMMAND_TEXTS = new Set([
  "confirmar",
  "confirmo",
  "confirmar incidencia",
  "confirmar reporte",
  "enviar incidencia",
  "enviar reporte",
]);
const CANCEL_COMMAND_TEXTS = new Set([
  "cancelar",
  "cancelar incidencia",
  "cancelar reporte",
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

function normalizeRiskValue(rawValue) {
  const value = normalizeForLookup(rawValue);
  if (!value) {
    return "";
  }

  if (
    value.includes("alto") ||
    value.includes("urgente") ||
    value.includes("inmediato") ||
    value.includes("muy peligroso")
  ) {
    return "alto";
  }
  if (
    value.includes("medio") ||
    value.includes("moderado") ||
    value.includes("parcial") ||
    value.includes("intermedio")
  ) {
    return "medio";
  }
  if (
    value.includes("bajo") ||
    value.includes("leve") ||
    value.includes("menor") ||
    value.includes("controlado")
  ) {
    return "bajo";
  }
  if (RISK_VALUES.includes(value)) {
    return value;
  }

  return normalizeFieldValue(rawValue, 120);
}

/** Texto de cierre afirmativo (solo debe usarse cuando el snapshot ya está en etapa de confirmación). */
const AFFIRMATIVE_CONFIRMATION_PHRASES = new Set([
  "si",
  "dale",
  "ok",
  "oka",
  "okey",
  "correcto",
  "esta bien",
  "de acuerdo",
  "perfecto",
  "listo",
  "vale",
  "bien",
  "confirmo",
  "confirmamos",
  "adelante",
  "genial",
  "claro",
  "todo bien",
  "todo listo",
  "dale si",
  "si dale",
  "si confirmo",
  "ok dale",
  "va bien",
]);

export function matchesAffirmativeConfirmationText(text) {
  const normalized = normalizeForLookup(text);
  if (!normalized) {
    return false;
  }
  return AFFIRMATIVE_CONFIRMATION_PHRASES.has(normalized);
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
  if (normalized === "editar riesgo") {
    return { command: "edit_field", commandField: "risk" };
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
    return { command: "open_incident_correction_menu", commandField: null };
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
    location: "",
    description: normalizeFieldValue(contextEntry?.description || ""),
    risk: "",
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
  const nextData = {
    category: normalizeFieldValue(collectedData?.category, 80),
    subcategory: normalizeFieldValue(collectedData?.subcategory, 120),
    location: normalizeFieldValue(collectedData?.location),
    description: normalizeFieldValue(collectedData?.description),
    risk: normalizeFieldValue(collectedData?.risk, 120),
    photoStatus: collectedData?.photoStatus || "not_requested",
  };
  const acceptedEntities = [];
  const rejectedEntities = [];
  const lowConfidenceFields = [];

  const locationEntity = interpretation?.entities?.location || null;
  const descriptionEntity = interpretation?.entities?.description || null;
  const riskEntity = interpretation?.entities?.risk || null;
  const photoIntentEntity = interpretation?.entities?.photoIntent || null;

  // Solo aceptar entidades del LLM alineadas al paso actual: el texto libre del turno
  // se interpreta primero como respuesta al dato pendiente, no como nueva intención.
  if (currentStep === CHATBOT_CURRENT_STEPS.LOCATION) {
    if (isReliableValue(locationEntity)) {
      nextData.location = normalizeFieldValue(locationEntity.value);
      acceptedEntities.push("location");
    } else if (isLowConfidenceValue(locationEntity)) {
      lowConfidenceFields.push("location");
    } else if (locationEntity?.value) {
      rejectedEntities.push("location");
    }
  }

  if (currentStep === CHATBOT_CURRENT_STEPS.DESCRIPTION) {
    if (isReliableValue(descriptionEntity)) {
      nextData.description = normalizeFieldValue(descriptionEntity.value);
      acceptedEntities.push("description");
    } else if (isLowConfidenceValue(descriptionEntity)) {
      lowConfidenceFields.push("description");
    } else if (descriptionEntity?.value) {
      rejectedEntities.push("description");
    }
  }

  if (currentStep === CHATBOT_CURRENT_STEPS.RISK) {
    if (isReliableValue(riskEntity)) {
      nextData.risk = normalizeRiskValue(riskEntity.value);
      acceptedEntities.push("risk");
    } else if (isLowConfidenceValue(riskEntity)) {
      lowConfidenceFields.push("risk");
    } else if (riskEntity?.value) {
      rejectedEntities.push("risk");
    }
  }

  if (currentStep === CHATBOT_CURRENT_STEPS.PHOTO && photoIntentEntity && typeof photoIntentEntity === "object") {
    const confidence =
      typeof photoIntentEntity.confidence === "number" ? photoIntentEntity.confidence : 0;
    if (confidence >= ENTITY_CONFIDENCE_ACCEPT) {
      if (photoIntentEntity.value === "wants_upload") {
        nextData.photoStatus = "pending_upload";
        acceptedEntities.push("photo");
      } else if (photoIntentEntity.value === "skip_photo") {
        nextData.photoStatus = "skipped";
        acceptedEntities.push("photo");
      }
    } else if (photoIntentEntity.value && confidence >= ENTITY_CONFIDENCE_REPROMPT) {
      lowConfidenceFields.push("photo");
    }
  }

  const textFallback = extractIncidentDraftFromText(text || "");
  const locationFromText = extractLikelyLocationFromText(text || "");
  if (!nextData.location && textFallback.location && currentStep === CHATBOT_CURRENT_STEPS.LOCATION) {
    nextData.location = normalizeFieldValue(textFallback.location);
    acceptedEntities.push("location");
  }
  if (currentStep === CHATBOT_CURRENT_STEPS.LOCATION && locationFromText) {
    nextData.location = normalizeFieldValue(locationFromText);
    if (!acceptedEntities.includes("location")) {
      acceptedEntities.push("location");
    }
  }
  if (
    !nextData.description &&
    textFallback.description &&
    currentStep === CHATBOT_CURRENT_STEPS.DESCRIPTION
  ) {
    nextData.description = normalizeFieldValue(textFallback.description);
    acceptedEntities.push("description");
  }
  if (!nextData.risk && currentStep === CHATBOT_CURRENT_STEPS.RISK) {
    const inferredRisk = normalizeRiskValue(text || "");
    if (inferredRisk) {
      nextData.risk = inferredRisk;
      acceptedEntities.push("risk");
    }
  }

  if (text && currentStep === CHATBOT_CURRENT_STEPS.LOCATION && !nextData.location) {
    nextData.location = normalizeFieldValue(locationFromText || text);
  }
  if (text && currentStep === CHATBOT_CURRENT_STEPS.DESCRIPTION && !nextData.description) {
    nextData.description = normalizeFieldValue(text);
  }
  if (text && currentStep === CHATBOT_CURRENT_STEPS.RISK && !nextData.risk) {
    nextData.risk = normalizeRiskValue(text);
  }

  return {
    collectedData: nextData,
    acceptedEntities,
    rejectedEntities,
    lowConfidenceFields,
  };
}

export function getNextIncidentFlowStep(collectedData) {
  if (!normalizeFieldValue(collectedData?.location)) {
    return CHATBOT_CURRENT_STEPS.LOCATION;
  }
  if (!normalizeFieldValue(collectedData?.description)) {
    return CHATBOT_CURRENT_STEPS.DESCRIPTION;
  }
  if (!normalizeFieldValue(collectedData?.risk, 120)) {
    return CHATBOT_CURRENT_STEPS.RISK;
  }
  const photoStatus = collectedData?.photoStatus || "not_requested";
  // Quedar en el paso foto hasta que haya archivo (`provided`) o decisión explícita de omitir (`skipped`).
  // `pending_upload`: el usuario indicó que quiere adjuntar o el asistente lo interpretó; aún no hay archivo ni omisión.
  if (photoStatus === "not_requested" || photoStatus === "pending_upload") {
    return CHATBOT_CURRENT_STEPS.PHOTO;
  }
  if (photoStatus === "skipped" || photoStatus === "provided") {
    return CHATBOT_CURRENT_STEPS.CONFIRMATION;
  }
  return CHATBOT_CURRENT_STEPS.PHOTO;
}

export function buildQuestionForStep({
  step,
  lowConfidence = false,
}) {
  let fallbackText = "Contame un poco más para seguir con el reporte.";

  if (step === CHATBOT_CURRENT_STEPS.LOCATION) {
    fallbackText = lowConfidence
      ? "No me quedó clara la ubicación. Indicá una dirección o referencia, o usá el mapa o tu ubicación actual."
      : "¿Dónde ocurrió? Indicá una dirección o referencia, o usá el mapa o tu ubicación actual.";
  } else if (step === CHATBOT_CURRENT_STEPS.DESCRIPTION) {
    fallbackText = lowConfidence
      ? "Para afinar el registro, describí en pocas palabras qué está pasando."
      : "¿Qué está pasando? Contame en pocas palabras.";
  } else if (step === CHATBOT_CURRENT_STEPS.RISK) {
    fallbackText = lowConfidence
      ? "No interpreté bien el nivel de riesgo. Indicá si es alto, medio o bajo."
      : "¿Qué nivel de riesgo le darías? (alto, medio o bajo).";
  } else if (step === CHATBOT_CURRENT_STEPS.PHOTO) {
    fallbackText =
      "Si querés, podés sumar una foto como evidencia (es opcional). Si no tenés o preferís no adjuntar, respondé «sin foto» o tocá «Omitir foto».";
  }

  return fallbackText;
}

export function buildIncidentDescriptionStartReply() {
  return "Bien, cuentame que sucede.";
}

export function buildPhotoActionOptions() {
  return [
    {
      label: "Adjuntar foto",
      command: "set_photo_pending",
      value: "",
      commandField: null,
    },
    {
      label: "Omitir foto",
      command: "skip_photo",
      value: "",
      commandField: null,
    },
  ];
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
export function buildIncidentCorrectionMenuActionOptions() {
  return [
    {
      label: "Ubicación",
      command: "edit_field",
      value: "",
      commandField: "location",
    },
    {
      label: "Descripción",
      command: "edit_field",
      value: "",
      commandField: "description",
    },
    {
      label: "Riesgo",
      command: "edit_field",
      value: "",
      commandField: "risk",
    },
    {
      label: "Foto",
      command: "edit_field",
      value: "",
      commandField: "photo",
    },
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
  es: "Perfecto. Revisá el resumen antes de confirmar la incidencia.",
  en: "All set—review the summary below before you confirm the report.",
  pt: "Perfeito. Revise o resumo antes de confirmar a ocorrência.",
};

/** Texto breve antes del bloque estructurado de vista previa (confirmación de incidencia). */
export function buildIncidentConfirmationIntroReply(locale = "es") {
  const key = normalizeConfirmationLocale(locale);
  return INCIDENT_CONFIRMATION_INTRO[key] || INCIDENT_CONFIRMATION_INTRO.es;
}

function humanizeIncidentCategoryForPreview(category) {
  const normalized = normalizeFieldValue(category || "").toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "incidencia_general" || normalized === "reporte_general") {
    return "Incidencia general";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function buildIncidentTypeLineForPreview(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return "Incidencia general";
  }
  const category = normalizeFieldValue(collectedData.category || "");
  const description = normalizeFieldValue(collectedData.description || "");
  const humanCategory = humanizeIncidentCategoryForPreview(category);
  const isGeneric =
    !category ||
    category.toLowerCase() === "incidencia_general" ||
    category.toLowerCase() === "reporte_general";
  if (isGeneric && description) {
    return normalizeFieldValue(description, 160) || "Incidencia general";
  }
  if (description && humanCategory && !isGeneric) {
    const tail = normalizeFieldValue(description, 90);
    return normalizeFieldValue(`${humanCategory} · ${tail}`, 200);
  }
  return humanCategory || "Incidencia general";
}

function normalizeRiskRawForPreview(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return "";
  }
  const direct = normalizeFieldValue(collectedData.risk || "", 40).toLowerCase();
  if (direct && ["alto", "medio", "bajo"].includes(direct)) {
    return direct;
  }
  const description = normalizeFieldValue(collectedData.description || "", 500);
  const match = description.match(/\(\s*Riesgo:\s*([^)]+)\)\s*$/iu);
  if (match?.[1]) {
    const parsed = normalizeRiskValue(match[1]);
    const lower = typeof parsed === "string" ? parsed.toLowerCase() : "";
    if (["alto", "medio", "bajo"].includes(lower)) {
      return lower;
    }
  }
  return "";
}

/**
 * Carga útil para vista previa estructurada antes de crear la incidencia (web / otros canales).
 * Sin número de ticket ni nombre de archivo.
 */
export function buildIncidentDraftPreviewPayload(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const photoStatus = collectedData.photoStatus || "not_requested";
  const photoAttached = photoStatus === "provided";
  return {
    kind: "incident_draft",
    typeLine: buildIncidentTypeLineForPreview(collectedData),
    location: normalizeFieldValue(collectedData.location || "", 400),
    riskRaw: normalizeRiskRawForPreview(collectedData),
    photoAttached,
  };
}

/** @deprecated Usar buildIncidentConfirmationIntroReply; se mantiene por compatibilidad con llamadas antiguas. */
export function buildIncidentResumeReply(collectedData, locale = "es") {
  void collectedData;
  return buildIncidentConfirmationIntroReply(locale);
}

export function buildIncidentCreatedReply({ incidentId }) {
  return `Incidencia creada correctamente. Codigo del caso: ${incidentId}.
Puedes consultar su seguimiento más adelante desde ‘Mis incidencias’.`;
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
  return snapshot?.flowKey === FLOW_KEY_INCIDENT;
}

export function isProcedureFlowActive(snapshot) {
  return snapshot?.flowKey === FLOW_KEY_PROCEDURE;
}

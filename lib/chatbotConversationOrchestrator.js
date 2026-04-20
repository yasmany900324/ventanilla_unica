import { CHATBOT_CONVERSATION_STATES, CHATBOT_CURRENT_STEPS } from "./chatSessionStore";
import { extractIncidentDraftFromText } from "./chatbotIncidentMapper";

export const FLOW_KEY_TREE = "incident.tree_fallen_branches";
export const FLOW_KEY_PROCEDURE = "procedure.general_start";

const FLOW_CONFIDENCE_STRONG = 0.75;
const FLOW_CONFIDENCE_WEAK = 0.6;
const ENTITY_CONFIDENCE_ACCEPT = 0.7;
const ENTITY_CONFIDENCE_REPROMPT = 0.5;
const MAX_FIELD_LENGTH = 320;
const RISK_VALUES = ["alto", "medio", "bajo"];

const TREE_SIGNAL_WORDS = [
  "arbol",
  "arboles",
  "rama",
  "ramas",
  "caido",
  "caida",
  "caidas",
  "peligrosa",
  "peligrosas",
];
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

function hasTreeSignals(text) {
  const lookup = normalizeForLookup(text);
  if (!lookup) {
    return false;
  }

  return TREE_SIGNAL_WORDS.some((keyword) => lookup.includes(keyword));
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

export function shouldActivateTreeFlow({ interpretation, text, contextEntry }) {
  if (contextEntry?.kind === "incidencia") {
    const contextSeed = `${contextEntry.title || ""} ${contextEntry.description || ""}`;
    if (hasTreeSignals(contextSeed)) {
      return true;
    }
  }

  const flowKey = interpretation?.flowCandidate?.flowKey || null;
  const flowConfidence = interpretation?.flowCandidate?.confidence || 0;
  if (flowKey === FLOW_KEY_TREE && flowConfidence >= FLOW_CONFIDENCE_STRONG) {
    return true;
  }
  if (flowKey === FLOW_KEY_TREE && flowConfidence >= FLOW_CONFIDENCE_WEAK && hasTreeSignals(text)) {
    return true;
  }

  const intentKind = interpretation?.intent?.kind || "unknown";
  const intentConfidence = interpretation?.intent?.confidence || 0;
  if (intentKind === "report_incident" && intentConfidence >= FLOW_CONFIDENCE_STRONG) {
    return true;
  }
  if (intentKind === "report_incident" && intentConfidence >= FLOW_CONFIDENCE_WEAK && hasTreeSignals(text)) {
    return true;
  }

  return hasTreeSignals(text);
}

export function buildTreeFlowSeedFromContext(contextEntry) {
  if (!contextEntry || contextEntry.kind !== "incidencia") {
    return {
      category: "infraestructura",
      subcategory: "arbol_caido_ramas_peligrosas",
      location: "",
      description: "",
      risk: "",
      photoStatus: "not_requested",
    };
  }

  return {
    category: "infraestructura",
    subcategory: "arbol_caido_ramas_peligrosas",
    location: "",
    description: normalizeFieldValue(contextEntry.description || ""),
    risk: "",
    photoStatus: "not_requested",
  };
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

  if (isReliableValue(locationEntity)) {
    nextData.location = normalizeFieldValue(locationEntity.value);
    acceptedEntities.push("location");
  } else if (isLowConfidenceValue(locationEntity)) {
    lowConfidenceFields.push("location");
  } else if (locationEntity?.value) {
    rejectedEntities.push("location");
  }

  if (isReliableValue(descriptionEntity)) {
    nextData.description = normalizeFieldValue(descriptionEntity.value);
    acceptedEntities.push("description");
  } else if (isLowConfidenceValue(descriptionEntity)) {
    lowConfidenceFields.push("description");
  } else if (descriptionEntity?.value) {
    rejectedEntities.push("description");
  }

  if (isReliableValue(riskEntity)) {
    nextData.risk = normalizeRiskValue(riskEntity.value);
    acceptedEntities.push("risk");
  } else if (isLowConfidenceValue(riskEntity)) {
    lowConfidenceFields.push("risk");
  } else if (riskEntity?.value) {
    rejectedEntities.push("risk");
  }

  if (photoIntentEntity && typeof photoIntentEntity === "object") {
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
    (currentStep === CHATBOT_CURRENT_STEPS.DESCRIPTION ||
      (currentStep === CHATBOT_CURRENT_STEPS.LOCATION &&
        hasTreeSignals(text) &&
        normalizeFieldValue(text).length > 24))
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

export function getNextTreeFlowStep(collectedData) {
  if (!normalizeFieldValue(collectedData?.location)) {
    return CHATBOT_CURRENT_STEPS.LOCATION;
  }
  if (!normalizeFieldValue(collectedData?.description)) {
    return CHATBOT_CURRENT_STEPS.DESCRIPTION;
  }
  if (!normalizeFieldValue(collectedData?.risk, 120)) {
    return CHATBOT_CURRENT_STEPS.RISK;
  }
  if (collectedData?.photoStatus === "not_requested") {
    return CHATBOT_CURRENT_STEPS.PHOTO;
  }
  return CHATBOT_CURRENT_STEPS.CONFIRMATION;
}

function getSafeSuggestedReply({ step, suggestedReply }) {
  if (
    step !== CHATBOT_CURRENT_STEPS.LOCATION &&
    step !== CHATBOT_CURRENT_STEPS.DESCRIPTION &&
    step !== CHATBOT_CURRENT_STEPS.RISK &&
    step !== CHATBOT_CURRENT_STEPS.PHOTO
  ) {
    return null;
  }
  if (typeof suggestedReply !== "string") {
    return null;
  }

  const trimmed = suggestedReply.trim();
  if (!trimmed || trimmed.length < 12 || trimmed.length > 220) {
    return null;
  }

  const blockedTokens = [
    "incidencia creada",
    "ticket creado",
    "confirmado",
    "creada exitosamente",
    "mis incidencias",
  ];
  const lookup = normalizeForLookup(trimmed);
  if (blockedTokens.some((token) => lookup.includes(token))) {
    return null;
  }

  return trimmed;
}

export function buildQuestionForStep({ step, lowConfidence = false, suggestedReply = null }) {
  let fallbackText = "Contame un poco mas para continuar con el reporte.";

  if (step === CHATBOT_CURRENT_STEPS.LOCATION) {
    fallbackText = lowConfidence
      ? "No me quedo clara la ubicacion. Indicame la ubicacion exacta del arbol caido o de las ramas peligrosas."
      : "Indicame la ubicacion exacta del arbol caido o de las ramas peligrosas.";
  } else if (step === CHATBOT_CURRENT_STEPS.DESCRIPTION) {
    fallbackText = lowConfidence
      ? "Para evitar errores, describime brevemente que esta ocurriendo."
      : "Describime brevemente que esta ocurriendo.";
  } else if (step === CHATBOT_CURRENT_STEPS.RISK) {
    fallbackText = lowConfidence
      ? "No logre interpretar el nivel de riesgo. Indicame si es alto, medio o bajo."
      : "Indicame el nivel de riesgo: alto, medio o bajo.";
  } else if (step === CHATBOT_CURRENT_STEPS.PHOTO) {
    fallbackText =
      "Si queres, podes adjuntar una foto (opcional). Si no tenes foto, presiona 'Omitir foto'.";
  }

  return getSafeSuggestedReply({ step, suggestedReply }) || fallbackText;
}

export function buildIncidentDescriptionStartReply() {
  return "Bien, cuentame que sucede.";
}

function formatPhotoStatus(photoStatus) {
  if (photoStatus === "provided") {
    return "Adjunta";
  }
  if (photoStatus === "pending_upload") {
    return "Pendiente de adjuntar";
  }
  if (photoStatus === "skipped") {
    return "Sin foto";
  }

  return "No definida";
}

export function buildIncidentSummary(collectedData) {
  return [
    "Resumen del reporte:",
    `- Categoria: Árbol caído / ramas peligrosas`,
    `- Ubicacion: ${collectedData.location}`,
    `- Descripcion: ${collectedData.description}`,
    `- Riesgo: ${collectedData.risk}`,
    `- Foto: ${formatPhotoStatus(collectedData.photoStatus)}`,
  ].join("\n");
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

export function buildConfirmationActionOptions() {
  return [
    {
      label: "Confirmar y crear incidencia",
      command: "confirm",
      value: "",
      commandField: null,
    },
    {
      label: "Editar ubicacion",
      command: "edit_field",
      value: "",
      commandField: "location",
    },
    {
      label: "Editar descripcion",
      command: "edit_field",
      value: "",
      commandField: "description",
    },
    {
      label: "Editar riesgo",
      command: "edit_field",
      value: "",
      commandField: "risk",
    },
    {
      label: "Cancelar",
      command: "cancel",
      value: "",
      commandField: null,
    },
  ];
}

export function buildCancelledIncidentReply() {
  return "Listo, cancele este borrador. Si queres, puedo ayudarte a iniciar un nuevo reporte.";
}

export function buildAuthRequiredReply() {
  return "Para crear la incidencia necesitas iniciar sesion. Cuando ingreses, vuelve al chat y retomamos desde la confirmacion.";
}

export function buildIncidentResumeReply(collectedData) {
  return `${buildIncidentSummary(collectedData)}

Si esta todo correcto, confirma para crear la incidencia.`;
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

export function createTreeFlowSnapshotPatch({
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
    flowKey: FLOW_KEY_TREE,
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

export function isTreeFlowActive(snapshot) {
  return snapshot?.flowKey === FLOW_KEY_TREE;
}

export function isProcedureFlowActive(snapshot) {
  return snapshot?.flowKey === FLOW_KEY_PROCEDURE;
}

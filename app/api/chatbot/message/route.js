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
import { createIncident, findIncidentByIdentifier } from "../../../../lib/incidents";
import {
  createProcedureRequest,
  findProcedureRequestByIdentifier,
} from "../../../../lib/procedureRequests";
import {
  FLOW_KEY_INCIDENT,
  FLOW_KEY_PROCEDURE,
  buildAuthRequiredReply,
  buildCancelledIncidentReply,
  buildConfirmationActionOptions,
  buildIncidentCreatedReply,
  buildIncidentResumeReply,
  buildProcedureStartReply,
  buildPhotoActionOptions,
  buildQuestionForStep,
  buildIncidentFlowSeedFromContext,
  createIncidentFlowSnapshotPatch,
  getNextIncidentFlowStep,
  isProcedureFlowActive,
  isIncidentFlowActive,
  mergeCollectedDataFromInterpretation,
  parseUserCommandFromText,
  shouldActivateIncidentFlow,
  shouldSwitchToIncidentFlow,
  shouldSwitchToProcedureFlow,
  createProcedureFlowSnapshotPatch,
} from "../../../../lib/chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "../../../../lib/chatbotTelemetry";
import { interpretUserMessage } from "../../../../lib/llmService";
import {
  hasProcedureSpecificSignals,
  normalizeIntentLookup,
} from "../../../../lib/chatbotIntentUtils";
import {
  findMatchingProcedure,
  getProcedureByCode,
  ensureProcedureCatalogSchema,
  listActiveProcedureCatalog,
  normalizeProcedureCollectedData,
  getProcedureMissingFieldsFromDefinition,
  getProcedureFieldDefinition,
  validateProcedureFieldInput,
  buildProcedureSummaryText,
} from "../../../../lib/procedureCatalog";

export const runtime = "nodejs";

const EMPTY_COLLECTED_DATA = {
  category: "",
  subcategory: "",
  location: "",
  description: "",
  risk: "",
  photoStatus: "not_requested",
  procedureName: "",
  procedureDetails: "",
  procedureCode: "",
  procedureCategory: "",
  procedureRequiredFields: [],
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
  if (snapshot?.flowKey === FLOW_KEY_INCIDENT) {
    return "incident";
  }
  if (snapshot?.flowKey === FLOW_KEY_PROCEDURE) {
    return "procedure";
  }
  return "unknown";
}

function getProcedureMissingFields(collectedData) {
  return getProcedureMissingFieldsFromDefinition(collectedData?.procedureRequiredFields, collectedData);
}

function normalizeProcedureText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStringField(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const STATUS_ACKNOWLEDGEMENT_SET = new Set([
  "ok",
  "oka",
  "okey",
  "dale",
  "si",
  "sí",
  "bien",
  "perfecto",
  "entendido",
  "de acuerdo",
]);

const STATUS_LABELS = {
  recibido: "Recibido",
  "en revision": "En revisión",
  "en proceso": "En proceso",
  resuelto: "Resuelto",
};

function normalizeStatusIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, "").trim();
}

function isLikelyStatusIdentifierToken(value) {
  const normalized = normalizeStatusIdentifier(value).toUpperCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length < 6 || normalized.length > 120) {
    return false;
  }
  if (!/^[A-Z0-9-]+$/u.test(normalized)) {
    return false;
  }
  if (
    /^(ID|TICKET|IDENTIFICADOR|CODIGO|EXPEDIENTE|SOLICITUD|CASO|TRAMITE|INCIDENCIA)$/u.test(
      normalized
    )
  ) {
    return false;
  }
  if (/^(INC|TRA|PROC|SOL)-?[A-Z0-9]{4,}$/u.test(normalized)) {
    return true;
  }
  if (/^[A-F0-9]{8,}$/u.test(normalized)) {
    return true;
  }
  if (normalized.includes("-")) {
    return true;
  }
  return /[0-9]/u.test(normalized);
}

function extractStatusIdentifierFromText(text) {
  if (typeof text !== "string") {
    return "";
  }

  const rawText = text.trim();
  if (!rawText) {
    return "";
  }

  const keywordMatch = rawText.match(
    /\b(?:ticket|id|identificador|codigo|c[oó]digo|expediente|solicitud|caso)\b\s*(?:es|:|#)?\s*([A-Za-z0-9-]{4,120})\b/iu
  );
  if (keywordMatch?.[1] && isLikelyStatusIdentifierToken(keywordMatch[1])) {
    return normalizeStatusIdentifier(keywordMatch[1]);
  }

  const prefixedMatch = rawText.match(
    /\b(?:INC|TRA|PROC|SOL)(?:[-:#][A-Za-z0-9]{4,120}|[0-9][A-Za-z0-9]{3,120})\b/iu
  );
  if (prefixedMatch?.[0]) {
    return normalizeStatusIdentifier(prefixedMatch[0]);
  }

  if (/\s/u.test(rawText)) {
    return "";
  }
  const cleanSingleToken = rawText.replace(/\s+/g, "");
  if (isLikelyStatusIdentifierToken(cleanSingleToken)) {
    return normalizeStatusIdentifier(cleanSingleToken);
  }

  return "";
}

function isStatusContinuationAcknowledgement(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }
  return STATUS_ACKNOWLEDGEMENT_SET.has(normalized);
}

function isStatusCasesListRequest(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("mis incidencias") ||
    normalized.includes("mis casos") ||
    normalized.includes("ver casos")
  );
}

function formatStatusDate(value) {
  if (!value) {
    return "Sin fecha";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Sin fecha";
  }
  return new Intl.DateTimeFormat("es-UY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function shortenStatusText(value, limit = 180) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  if (value.length <= limit) {
    return value.trim();
  }
  return `${value.slice(0, limit).trim()}...`;
}

function toStatusTimestamp(value) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function mapIncidentToStatusSummaryEntry(incident) {
  if (!incident) {
    return null;
  }
  return {
    kind: "incident",
    id: incident.id,
    displayCode: `INC-${String(incident.id || "").slice(0, 8).toUpperCase()}`,
    status: incident.status,
    category: incident.category,
    location: incident.location,
    description: incident.description,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    updatedTimestamp: toStatusTimestamp(incident.updatedAt || incident.createdAt),
  };
}

function mapProcedureRequestToStatusSummaryEntry(procedureRequest) {
  if (!procedureRequest) {
    return null;
  }
  return {
    kind: "procedure",
    id: procedureRequest.id,
    displayCode: procedureRequest.requestCode,
    status: procedureRequest.status,
    procedureName: procedureRequest.procedureName,
    procedureCategory: procedureRequest.procedureCategory,
    summary: procedureRequest.summary,
    collectedData: procedureRequest.collectedData || {},
    createdAt: procedureRequest.createdAt,
    updatedAt: procedureRequest.updatedAt,
    updatedTimestamp: toStatusTimestamp(procedureRequest.updatedAt || procedureRequest.createdAt),
  };
}

async function resolveStatusSummaryByIdentifier({ userId, identifier }) {
  if (!userId || !identifier) {
    return null;
  }

  const normalizedIdentifier = normalizeStatusIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const [incidentMatch, procedureMatch] = await Promise.all([
    findIncidentByIdentifier({ userId, identifier: normalizedIdentifier }),
    findProcedureRequestByIdentifier({ userId, identifier: normalizedIdentifier }),
  ]);

  const candidates = [
    mapIncidentToStatusSummaryEntry(incidentMatch),
    mapProcedureRequestToStatusSummaryEntry(procedureMatch),
  ].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.updatedTimestamp - a.updatedTimestamp);
  return candidates[0];
}

function shouldSwitchToStatusIntent({ text, interpretation }) {
  const normalized = normalizeIntentLookup(text);
  if (normalized) {
    const statusWordSignals = [
      "estado",
      "seguimiento",
      "status",
      "consultar",
      "consulta",
      "ver",
      "saber",
      "conocer",
      "conozco",
      "conosco",
      "avance",
      "avanza",
      "progreso",
      "notificacion",
      "notifica",
      "respuesta",
      "respuesta",
      "avisaron",
      "avisar",
    ];
    const statusPhraseSignals = ["como va", "en que va"];
    const statusObjectSignals = [
      "tramite",
      "solicitud",
      "ticket",
      "expediente",
      "caso",
      "gestion",
      "reporte",
      "incidencia",
    ];
    const tokens = new Set(normalized.split(" "));
    const hasPotentialTypos = [
      "no eh",
      "no he",
      "recivido",
      "resivido",
      "resibido",
      "notificacion",
      "notificacion de mi solicitud",
      "no recibi",
      "no recibi notificacion",
      "no he recibido",
      "no he recibido notificacion",
      "no recibi respuesta",
    ].some((snippet) => normalized.includes(snippet));
    const hasStatusSignal =
      statusWordSignals.some((signal) => tokens.has(signal)) ||
      statusPhraseSignals.some((signal) => normalized.includes(signal));
    const hasStatusObjectSignal = statusObjectSignals.some((signal) => tokens.has(signal));
    const hasStatusByPattern = /(?:estado|seguimiento|status)\s+de(?:l| la| mi| un| una)?\s*(?:tramite|solicitud|ticket|expediente|caso|gestion|reporte|incidencia)\b/u.test(
      normalized
    );
    const hasNotificationStatusPattern =
      /(no\s+(?:eh|he)\s+)?(?:recibi|recibido|recivido|resibido|resivido)?\s*(?:notificacion|respuesta|aviso)/u.test(
        normalized
      ) && hasStatusObjectSignal;
    if (
      hasStatusByPattern ||
      (hasStatusSignal && hasStatusObjectSignal) ||
      hasNotificationStatusPattern ||
      (hasPotentialTypos && hasStatusObjectSignal)
    ) {
      return true;
    }

    const statusKeywords = [
      "consultar estado",
      "estado de tramite",
      "estado de mi tramite",
      "estado del tramite",
      "estado de solicitud",
      "estado de mi solicitud",
      "seguimiento",
      "ver estado",
      "consultar tramite",
    ];
    if (statusKeywords.some((keyword) => normalized.includes(keyword))) {
      return true;
    }
  }

  const intentKind = interpretation?.intent?.kind || "unknown";
  const confidence = interpretation?.intent?.confidence || 0;
  return intentKind === "check_status" && confidence >= 0.6;
}

function isGenericIncidentStartRequest(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }

  const genericIncidentSignals = [
    "quiero crear una incidencia",
    "quiero reportar una incidencia",
    "quiero reportar un problema",
    "quiero crear incidencia",
    "crear incidencia",
    "reportar incidencia",
    "reportar problema",
    "necesito reportar una incidencia",
    "necesito crear una incidencia",
  ];
  if (genericIncidentSignals.some((signal) => normalized === signal)) {
    return true;
  }

  return normalized === "incidencia" || normalized === "problema";
}

function isGenericProcedureStartRequest(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }

  const genericProcedureSignals = [
    "necesito hacer un tramite",
    "quiero hacer un tramite",
    "quiero iniciar un tramite",
    "necesito iniciar un tramite",
    "quisiera iniciar un tramite",
    "necesito realizar una gestion",
    "quiero realizar una gestion",
    "iniciar un tramite",
    "hacer un tramite",
    "tramite",
  ];

  return genericProcedureSignals.includes(normalized);
}

function buildProcedureActionOptions({ nextMissingField = null, isCompleted = false } = {}) {
  if (isCompleted) {
    return [
      {
        label: "Confirmar datos del trámite",
        command: "confirm",
        value: "",
        commandField: null,
      },
      {
        label: "Consultar estado de trámite",
        command: "none",
        value: "Quiero consultar el estado de un trámite.",
        commandField: null,
      },
    ];
  }

  if (!nextMissingField) {
    return [];
  }

  return [
    {
      label: "Cancelar",
      command: "cancel",
      value: "",
      commandField: null,
    },
    {
      label: "Consultar estado de trámite",
      command: "none",
      value: "Quiero consultar el estado de un trámite.",
      commandField: null,
    },
  ];
}

function buildClarificationActionOptions() {
  return [
    {
      label: "Iniciar trámite",
      command: "none",
      value: "Quiero iniciar un trámite.",
      commandField: null,
    },
    {
      label: "Reportar incidencia",
      command: "none",
      value: "Quiero reportar una incidencia.",
      commandField: null,
    },
    {
      label: "Consultar estado",
      command: "none",
      value: "Quiero consultar el estado de mi solicitud.",
      commandField: null,
    },
  ];
}

function buildStatusActionOptions() {
  return [
    {
      label: "Ver mis incidencias",
      command: "none",
      value: "Quiero ver mis incidencias.",
      commandField: null,
    },
    {
      label: "Consultar con identificador",
      command: "none",
      value: "Mi identificador es INC-1234ABCD",
      commandField: null,
    },
    {
      label: "Iniciar trámite",
      command: "none",
      value: "Quiero iniciar un trámite.",
      commandField: null,
    },
    {
      label: "Reportar incidencia",
      command: "none",
      value: "Quiero reportar una incidencia.",
      commandField: null,
    },
  ];
}

function buildStatusReply({ identifierRequested = false } = {}) {
  if (identifierRequested) {
    return "Perfecto. Para resumirte el estado aquí en el chat, compárteme el identificador de tu solicitud (por ejemplo: INC-1234ABCD o TRA-1234ABCD).";
  }
  return "Entiendo. Te ayudo a consultar el estado de tu solicitud. Puedes revisar tus casos en 'Mis incidencias' o, si prefieres, indícame el identificador y te resumo el estado aquí mismo.";
}

function buildGreetingReply() {
  return "Hola, ¿en qué te ayudo hoy? Puedo ayudarte a iniciar un trámite, reportar una incidencia o consultar el estado de tu solicitud.";
}

function buildIncidentStartReply() {
  return "Bien, cuéntame qué sucede para ayudarte a registrar la incidencia.";
}

function buildUnsupportedProcedureReply() {
  return "Lo siento, de momento no puedo ayudarte con este trámite.";
}

function buildProcedureCatalogIntroReply(procedures) {
  const supported = Array.isArray(procedures) ? procedures : [];
  if (supported.length === 0) {
    return "Lo siento, de momento no puedo ayudarte con este trámite.";
  }

  const names = supported
    .slice(0, 6)
    .map((procedure) => procedure?.name)
    .filter((name) => typeof name === "string" && name.trim());
  if (names.length === 0) {
    return "Lo siento, de momento no puedo ayudarte con este trámite.";
  }

  const listedNames = names.map((name) => `"${name}"`).join(", ");
  const totalSupported = supported.length;
  return `Actualmente puedo ayudarte con ${totalSupported} tipos de trámites: ${listedNames}. Indícame cuál deseas iniciar.`;
}

function buildProcedureCatalogActionOptions(procedures) {
  const supported = Array.isArray(procedures) ? procedures : [];
  return supported.slice(0, 6).map((procedure) => ({
    label: procedure.name,
    command: "none",
    value: `Quiero iniciar el trámite ${procedure.name}.`,
    commandField: null,
  }));
}

function buildProcedureCompletedReply(activeProcedure, requestCode = null) {
  const completionFromCatalog = activeProcedure?.flowDefinition?.completionMessage;
  if (requestCode) {
    const codeLine = `\n\nIdentificador de solicitud: ${requestCode}. Puedes consultarlo luego por este chat o desde 'Mis incidencias'.`;
    if (typeof completionFromCatalog === "string" && completionFromCatalog.trim()) {
      return `${completionFromCatalog.trim()}${codeLine}`;
    }
    const procedureName = activeProcedure?.name || "el trámite";
    return `Perfecto. Confirmé los datos para ${procedureName}.${codeLine}`;
  }
  if (typeof completionFromCatalog === "string" && completionFromCatalog.trim()) {
    return completionFromCatalog.trim();
  }
  const procedureName = activeProcedure?.name || "el trámite";
  return `Perfecto. Confirmé los datos para ${procedureName} y cerré esta conversación de forma guiada.`;
}

function buildStatusSummaryReply(statusEntry) {
  if (!statusEntry || typeof statusEntry !== "object") {
    return "No pude obtener el estado de ese identificador.";
  }
  const statusLabel = STATUS_LABELS[statusEntry.status] || statusEntry.status || "Sin estado";
  const createdAt = formatStatusDate(statusEntry.createdAt);
  const updatedAt = formatStatusDate(statusEntry.updatedAt || statusEntry.createdAt);
  const identifier = statusEntry.displayCode || statusEntry.id || "Sin identificador";

  if (statusEntry.kind === "incident") {
    const description = shortenStatusText(statusEntry.description, 160);
    return `Resumen del caso ${identifier}:
- Tipo: Incidencia
- Estado: ${statusLabel}
- Categoría: ${statusEntry.category || "Sin categoría"}
- Ubicación: ${statusEntry.location || "Sin ubicación"}
- Última actualización: ${updatedAt}
- Descripción: ${description || "Sin descripción"}`;
  }

  const details = shortenStatusText(
    statusEntry.summary ||
      statusEntry.collectedData?.procedureDetails ||
      statusEntry.collectedData?.description ||
      "",
    160
  );
  return `Resumen de la solicitud ${identifier}:
- Tipo: Trámite
- Estado: ${statusLabel}
- Trámite: ${statusEntry.procedureName || "Sin nombre"}
- Categoría: ${statusEntry.procedureCategory || "Sin categoría"}
- Ingresado: ${createdAt}
- Última actualización: ${updatedAt}
- Detalle: ${details || "Sin detalle"}`;
}

function buildStatusNotFoundReply(identifier) {
  const normalized = normalizeStatusIdentifier(identifier);
  if (!normalized) {
    return "No encontré resultados. Verifica el identificador y vuelve a intentarlo.";
  }
  return `No encontré resultados para "${normalized}". Verifica el identificador y vuelve a intentarlo. Si quieres, también puedes revisar tus casos en 'Mis incidencias'.`;
}

function buildProcedureFieldPrompt(fieldDefinition) {
  if (!fieldDefinition || typeof fieldDefinition !== "object") {
    return "Para continuar con este trámite, indícame el siguiente dato requerido.";
  }

  if (fieldDefinition.prompt) {
    return fieldDefinition.prompt;
  }

  return `Para continuar, indícame ${fieldDefinition.label || "el dato requerido"}.`;
}

function mapProcedureFieldToStep(fieldName) {
  if (fieldName === "procedureName") {
    return CHATBOT_CURRENT_STEPS.LOCATION;
  }
  if (fieldName === "procedureDetails") {
    return CHATBOT_CURRENT_STEPS.DESCRIPTION;
  }
  return CHATBOT_CURRENT_STEPS.DESCRIPTION;
}

function buildProcedureFieldValidationReply(validationError, fieldDefinition) {
  const safeError =
    typeof validationError === "string" && validationError.trim()
      ? validationError.trim()
      : "El valor ingresado no es válido para este campo.";
  const prompt = buildProcedureFieldPrompt(fieldDefinition);
  return `${safeError}\n\n${prompt}`;
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
  statusSummary = null,
}) {
  const collectedData = snapshot?.collectedData || EMPTY_COLLECTED_DATA;
  const mode = buildModeFromSnapshot(snapshot);
  const missingFields =
    mode === "procedure"
      ? getProcedureMissingFields(collectedData)
      : mode === "incident"
        ? getRequiredMissingFields(collectedData)
        : [];

  return NextResponse.json({
    sessionId,
    locale,
    replyText,
    intent: snapshot?.lastIntent || null,
    confidence: snapshot?.lastConfidence || null,
    fulfillmentMessages: [],
    action: snapshot?.lastAction || null,
    parameters: {},
    mode,
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
    statusSummary,
  });
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }
  return {
    locale: snapshot.locale || null,
    state: snapshot.state || null,
    flowKey: snapshot.flowKey || null,
    currentStep: snapshot.currentStep || null,
    confirmationState: snapshot.confirmationState || null,
    lastIntent: snapshot.lastIntent || null,
    lastAction: snapshot.lastAction || null,
    collectedData: snapshot.collectedData || null,
  };
}

function buildChatDebugHeaders(snapshot) {
  if (process.env.CHATBOT_DEBUG !== "1") {
    return null;
  }
  const safeSnapshot = sanitizeSnapshot(snapshot || {});
  if (!safeSnapshot) {
    return null;
  }
  return {
    "x-chatbot-debug-flow-key": safeSnapshot.flowKey || "",
    "x-chatbot-debug-state": safeSnapshot.state || "",
    "x-chatbot-debug-current-step": safeSnapshot.currentStep || "",
    "x-chatbot-debug-confirmation-state": safeSnapshot.confirmationState || "",
    "x-chatbot-debug-procedure-code":
      normalizeStringField(safeSnapshot.collectedData?.procedureCode || "", 120),
  };
}

function applyChatDebugHeaders(response, snapshot) {
  const headers = buildChatDebugHeaders(snapshot);
  if (!headers || !response || !response.headers) {
    return response;
  }
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function buildChatDebugPayload({
  sessionId,
  text,
  command,
  commandField,
  contextEntry,
  snapshotBefore,
  snapshotAfter,
  interpretation,
  llmMeta,
  decision = {},
}) {
  return {
    sessionId,
    text,
    command,
    commandField,
    contextEntry: contextEntry || null,
    snapshotBefore: sanitizeSnapshot(snapshotBefore),
    snapshotAfter: sanitizeSnapshot(snapshotAfter),
    interpretation: interpretation || {},
    llmMeta: llmMeta || null,
    decision,
  };
}

function logChatDebug(label, payload) {
  if (process.env.CHATBOT_DEBUG !== "1") {
    return;
  }
  console.info(`[chatbot-debug] ${label}`, payload);
}

function isChatDebugRequested(request) {
  const debugHeader = normalizeStringField(request.headers.get("x-chatbot-debug"), 10);
  if (debugHeader === "1" || debugHeader.toLowerCase() === "true") {
    return true;
  }
  return process.env.CHATBOT_DEBUG === "1";
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
  const chatDebugEnabled = isChatDebugRequested(request);

  const authenticatedUser = await requireAuthenticatedUser(request);
  await ensureProcedureCatalogSchema();
  let snapshot = (await getSessionSnapshot(sessionId)) || getDefaultSnapshot();
  if (chatDebugEnabled) {
    logChatDebug(
      "request_received",
      buildChatDebugPayload({
        sessionId,
        text,
        command: commandFromPayload,
        commandField: commandFieldFromPayload,
        contextEntry,
        snapshotBefore: snapshot,
      })
    );
  }
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

  const isIncidentContextStart =
    (effectiveCommand === "start_contextual_flow" ||
      effectiveCommand === "start_contextual_entry") &&
    contextEntry &&
    shouldActivateIncidentFlow({
      interpretation: null,
      text: `${contextEntry.title || ""} ${contextEntry.description || ""}`,
      contextEntry,
    });

  if (isIncidentContextStart) {
    const seededData = buildIncidentFlowSeedFromContext(contextEntry);
    const nextStep = getNextIncidentFlowStep(seededData);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";
    const patch = createIncidentFlowSnapshotPatch({
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
    const wasProcedureFlow = isProcedureFlowActive(snapshot);
    await clearIncidentDraft(sessionId);
    const clearedSnapshot = await getSessionSnapshot(sessionId);
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CANCELLED,
      funnelStep: CHATBOT_FUNNEL_STEPS.CANCELLED,
      mode: buildModeFromSnapshot(snapshot),
      outcome: "cancelled_by_user",
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: wasProcedureFlow
        ? "Listo, cancelé este trámite en curso. Si quieres, puedo ayudarte a iniciar otro trámite o reportar una incidencia."
        : buildCancelledIncidentReply(),
      snapshot: clearedSnapshot || getDefaultSnapshot(),
      nextStepType: "cancelled",
      nextStepField: null,
    });
  }

  if (effectiveCommand === "edit_field" && isIncidentFlowActive(snapshot)) {
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
      createIncidentFlowSnapshotPatch({
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
    isIncidentFlowActive(snapshot)
  ) {
    const updatedData = {
      ...snapshot.collectedData,
      photoStatus: effectiveCommand === "set_photo_pending" ? "pending_upload" : "skipped",
    };
    const nextStep = getNextIncidentFlowStep(updatedData);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";

    const updatedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
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

  if (effectiveCommand === "resume_confirmation" && isIncidentFlowActive(snapshot)) {
    const missingFields = getRequiredMissingFields(snapshot.collectedData);
    if (missingFields.length > 0) {
      const nextStep = mapFieldToStep(missingFields[0]);
      const updatedSnapshot = await setConversationState(
        sessionId,
        createIncidentFlowSnapshotPatch({
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
      createIncidentFlowSnapshotPatch({
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

  if (effectiveCommand === "confirm" && isIncidentFlowActive(snapshot)) {
    const missingFields = getRequiredMissingFields(snapshot.collectedData);
    if (missingFields.length > 0) {
      const nextStep = mapFieldToStep(missingFields[0]);
      const updatedSnapshot = await setConversationState(
        sessionId,
        createIncidentFlowSnapshotPatch({
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
        category: snapshot.collectedData.category || "incidencia_general",
        description: descriptionWithRisk,
        location: snapshot.collectedData.location,
      });

      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser.id,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: FLOW_KEY_INCIDENT,
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

  if (effectiveCommand === "confirm" && isProcedureFlowActive(snapshot)) {
    const activeProcedure = await getProcedureByCode(snapshot.collectedData?.procedureCode);
    if (!activeProcedure) {
      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: snapshot.lastInterpretation,
        lastIntent: "start_procedure",
        lastAction: "procedure_catalog_entry_missing",
        lastConfidence: snapshot.lastConfidence,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildUnsupportedProcedureReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }

    const normalizedProcedureData = normalizeProcedureCollectedData({
      ...snapshot.collectedData,
      procedureCode: activeProcedure.code,
      procedureName: activeProcedure.name,
      procedureCategory: activeProcedure.category || "",
      procedureRequiredFields: activeProcedure.requiredFields || [],
    });
    const missingFields = getProcedureMissingFields(normalizedProcedureData);
    if (missingFields.length > 0) {
      const missingField = missingFields[0];
      const fieldDefinition = getProcedureFieldDefinition(
        normalizedProcedureData.procedureRequiredFields,
        missingField
      );
      const updatedProcedureSnapshot = await setConversationState(
        sessionId,
        createProcedureFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: normalizedProcedureData,
          currentStep: mapProcedureFieldToStep(missingField),
          confirmationState: "none",
          lastInterpretation: snapshot.lastInterpretation || {},
          lastIntent: "start_procedure",
          lastAction: "confirm_with_missing_fields",
          lastConfidence: snapshot.lastConfidence || null,
          state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        })
      );
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureFieldPrompt(fieldDefinition),
        snapshot: updatedProcedureSnapshot,
        actionOptions: buildProcedureActionOptions({
          nextMissingField: missingField,
          isCompleted: false,
        }),
        nextStepType: "ask_field",
        nextStepField: missingField,
      });
    }

    let createdProcedureRequest = null;
    if (authenticatedUser?.id) {
      try {
        createdProcedureRequest = await createProcedureRequest({
          userId: authenticatedUser.id,
          procedureCode: normalizedProcedureData.procedureCode,
          procedureName: normalizedProcedureData.procedureName,
          procedureCategory: normalizedProcedureData.procedureCategory,
          summary: buildProcedureSummaryText({
            procedureName: normalizedProcedureData.procedureName,
            requiredFields: normalizedProcedureData.procedureRequiredFields,
            collectedData: normalizedProcedureData,
          }),
          collectedData: normalizedProcedureData,
        });
      } catch (error) {
        await trackEvent({
          eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
          mode: "procedure",
          outcome: "procedure_request_persist_failed",
          details: error?.message || null,
        });
      }
    }

    const closedProcedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: normalizedProcedureData,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "confirmed",
        lastInterpretation: snapshot.lastInterpretation || {},
        lastIntent: "start_procedure",
        lastAction: "procedure_confirmed",
        lastConfidence: snapshot.lastConfidence || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
      })
    );
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      mode: "procedure",
      outcome: "procedure_confirmed",
      details: activeProcedure.code,
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildProcedureCompletedReply(
        activeProcedure,
        createdProcedureRequest?.requestCode || null
      ),
      snapshot: closedProcedureSnapshot,
      actionOptions: [],
      nextStepType: "closed",
      nextStepField: null,
    });
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

  const switchToProcedure = shouldSwitchToProcedureFlow({ text, interpretation });
  const switchToIncident = shouldSwitchToIncidentFlow({ text, interpretation });
  const switchToStatus = shouldSwitchToStatusIntent({ text, interpretation });
  const isGreeting = Boolean(interpretation?.userSignals?.greetingOpen);
  if (chatDebugEnabled) {
    logChatDebug(
      "intent_switch_evaluation",
      buildChatDebugPayload({
        sessionId,
        text,
        command: effectiveCommand,
        commandField: effectiveCommandField,
        contextEntry,
        snapshotBefore: snapshot,
        interpretation,
        llmMeta,
        decision: {
          isGreeting,
          switchToProcedure,
          switchToIncident,
          switchToStatus,
        },
      })
    );
  }

  if (
    isGreeting &&
    !switchToProcedure &&
    !switchToIncident &&
    !switchToStatus &&
    effectiveCommand === "none"
  ) {
    const greetingSnapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      confirmationState: "none",
      collectedData: { ...EMPTY_COLLECTED_DATA },
      lastInterpretation: interpretation,
      lastIntent: interpretation?.intent?.kind || "small_talk",
      lastAction: "greeting",
      lastConfidence: interpretation?.intent?.confidence || null,
    });
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildGreetingReply(),
      snapshot: greetingSnapshot,
      actionOptions: buildClarificationActionOptions(),
      nextStepType: "clarify",
      nextStepField: null,
      needsClarification: false,
    });
  }

  const statusIdentifierFromText = extractStatusIdentifierFromText(text);
  const statusFlowActive = snapshot?.lastIntent === "check_status" && !switchToIncident && !switchToProcedure;
  const isStatusFollowUp =
    statusFlowActive &&
    effectiveCommand === "none" &&
    (
      isStatusContinuationAcknowledgement(text) ||
      isStatusCasesListRequest(text) ||
      Boolean(statusIdentifierFromText)
    );
  if (switchToStatus || isStatusFollowUp) {
    const statusIdentifier = statusIdentifierFromText;
    if (statusIdentifier && authenticatedUser?.id) {
      const statusSummaryEntry = await resolveStatusSummaryByIdentifier({
        userId: authenticatedUser.id,
        identifier: statusIdentifier,
      });
      if (statusSummaryEntry) {
        const statusLookupSnapshot = await setConversationState(sessionId, {
          locale: effectiveLocale,
          userId: authenticatedUser.id,
          state: CHATBOT_CONVERSATION_STATES.IDLE,
          flowKey: null,
          currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
          confirmationState: "none",
          collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
          lastInterpretation: interpretation,
          lastIntent: "check_status",
          lastAction: "status_lookup_success",
          lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
        });
        return buildChatResponse({
          sessionId,
          locale: effectiveLocale,
          replyText: buildStatusSummaryReply(statusSummaryEntry),
          snapshot: statusLookupSnapshot,
          actionOptions: buildStatusActionOptions(),
          nextStepType: "check_status",
          nextStepField: "identifier",
          redirectTo: "/mis-incidencias",
          redirectLabel: "Ver mis incidencias",
          statusSummary: statusSummaryEntry,
          needsClarification: false,
        });
      }
      const statusNotFoundSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser.id,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "check_status",
        lastAction: "status_lookup_not_found",
        lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildStatusNotFoundReply(statusIdentifier),
        snapshot: statusNotFoundSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: "/mis-incidencias",
        redirectLabel: "Ver mis incidencias",
        needsClarification: false,
      });
    }

    if (statusIdentifier && !authenticatedUser?.id && !isStatusCasesListRequest(text)) {
      const statusAuthSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "check_status",
        lastAction: "status_lookup_requires_auth",
        lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Para resumirte el estado por identificador necesitas iniciar sesión, así verifico tus casos de forma segura.",
        snapshot: statusAuthSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "auth_required",
        nextStepField: "identifier",
        redirectTo: "/login",
        redirectLabel: "Iniciar sesión",
        needsClarification: false,
      });
    }

    if (
      statusFlowActive &&
      effectiveCommand === "none" &&
      isStatusContinuationAcknowledgement(text) &&
      authenticatedUser?.id
    ) {
      const statusPromptSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser.id,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "check_status",
        lastAction: "status_waiting_identifier",
        lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildStatusReply({ identifierRequested: true }),
        snapshot: statusPromptSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: "/mis-incidencias",
        redirectLabel: "Ver mis incidencias",
        needsClarification: false,
      });
    }

    if (statusFlowActive && effectiveCommand === "none" && isStatusCasesListRequest(text)) {
      const statusCasesSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "check_status",
        lastAction: "status_redirect_cases",
        lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Perfecto, puedes verlos en 'Mis incidencias'. Si quieres, también puedo resumirte uno aquí: envíame su identificador.",
        snapshot: statusCasesSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: "/mis-incidencias",
        redirectLabel: "Ver mis incidencias",
        needsClarification: false,
      });
    }

    const statusSnapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      confirmationState: "none",
      collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
      lastInterpretation: interpretation,
      lastIntent: "check_status",
      lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
      lastConfidence: interpretation?.intent?.confidence || null,
    });

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildStatusReply(),
      snapshot: statusSnapshot,
      actionOptions: buildStatusActionOptions(),
      nextStepType: "check_status",
      nextStepField: "identifier",
      redirectTo: "/mis-incidencias",
      redirectLabel: "Ver mis incidencias",
      needsClarification: false,
    });
  }

  if (switchToIncident && !isIncidentFlowActive(snapshot) && !isProcedureFlowActive(snapshot)) {
    const isGenericIncidentStart = isGenericIncidentStartRequest(text);
    const seedData = {
      ...EMPTY_COLLECTED_DATA,
      category: "incidencia_general",
      subcategory: "reporte_general",
    };
    const mergedFromIntent = mergeCollectedDataFromInterpretation({
      collectedData: seedData,
      interpretation,
      text: isGenericIncidentStart ? "" : text,
      currentStep: CHATBOT_CURRENT_STEPS.DESCRIPTION,
    });
    const hasDescription = Boolean(mergedFromIntent.collectedData?.description);
    const nextStep = hasDescription
      ? getNextIncidentFlowStep(mergedFromIntent.collectedData)
      : CHATBOT_CURRENT_STEPS.DESCRIPTION;
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const savedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: mergedFromIntent.collectedData,
        currentStep: nextStep,
        confirmationState: nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none",
        lastInterpretation: interpretation,
        lastIntent: "report_incident",
        lastAction: "switch_to_incident",
        lastConfidence: interpretation?.intent?.confidence || null,
        state: nextState,
      })
    );
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      funnelStep: CHATBOT_FUNNEL_STEPS.ENTERED_INCIDENT_FLOW,
      mode: "incident",
      outcome: "explicit_incident_intent",
    });

    if (nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
        funnelStep: CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION,
        mode: "incident",
        outcome: "ready_after_incident_intent_start",
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentResumeReply(mergedFromIntent.collectedData),
        snapshot: savedSnapshot,
        actionOptions: buildConfirmationActionOptions(),
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText:
        nextStep === CHATBOT_CURRENT_STEPS.DESCRIPTION
          ? buildIncidentStartReply()
          : buildQuestionForStep({
              step: nextStep,
              suggestedReply: interpretation?.assistantStyle?.suggestedReply || null,
            }),
      snapshot: savedSnapshot,
      actionOptions: nextStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
      nextStepType: "ask_field",
      nextStepField: nextStep,
      needsClarification: false,
    });
  }

  if (switchToProcedure && !isProcedureFlowActive(snapshot)) {
    const activeProcedures = await listActiveProcedureCatalog();
    const canListSupportedProcedures = activeProcedures.length > 0;
    const hasSpecificProcedureRequest = hasProcedureSpecificSignals(text);

    if (!hasSpecificProcedureRequest && canListSupportedProcedures) {
      const idleSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "list_supported_procedures",
        lastConfidence: interpretation?.intent?.confidence || null,
      });

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureCatalogIntroReply(activeProcedures),
        snapshot: idleSnapshot,
        actionOptions: buildProcedureCatalogActionOptions(activeProcedures),
        nextStepType: "clarify_procedure",
        nextStepField: "procedureName",
        needsClarification: false,
      });
    }

    const procedureMatch = await findMatchingProcedure({
      text,
      interpretation,
    });
    if (chatDebugEnabled) {
      logChatDebug(
        "procedure_match_initial",
        buildChatDebugPayload({
          sessionId,
          text,
          command: effectiveCommand,
          commandField: effectiveCommandField,
          contextEntry,
          snapshotBefore: snapshot,
          interpretation,
          llmMeta,
          decision: {
            hasSpecificProcedureRequest,
            activeProcedures: activeProcedures.map((procedure) => procedure.code),
            procedureMatch: procedureMatch
              ? {
                  code: procedureMatch.code,
                  name: procedureMatch.name,
                  matchScore: procedureMatch.matchScore,
                }
              : null,
          },
        })
      );
    }
    if (!procedureMatch) {
      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "unsupported_procedure",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
        mode: "procedure",
        outcome: "unsupported_procedure",
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildUnsupportedProcedureReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }

    const collectedData = normalizeProcedureCollectedData({
      ...EMPTY_COLLECTED_DATA,
      procedureCode: procedureMatch.code,
      procedureName: procedureMatch.name,
      procedureCategory: procedureMatch.category || "",
      procedureRequiredFields: procedureMatch.requiredFields || [],
    });
    const missingFields = getProcedureMissingFields(collectedData);
    const nextField = missingFields[0] || null;
    const nextStep = nextField
      ? mapProcedureFieldToStep(nextField)
      : CHATBOT_CURRENT_STEPS.CONFIRMATION;
    const procedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData,
        currentStep: nextStep,
        confirmationState: nextField ? "none" : "ready",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "switch_to_procedure_catalog",
        lastConfidence: procedureMatch.matchScore ?? interpretation?.intent?.confidence ?? null,
      })
    );

    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
      mode: "procedure",
      outcome: "procedure_catalog_match",
      details: procedureMatch.code,
    });

    if (!nextField) {
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureSummaryText({
          procedureName: collectedData.procedureName,
          requiredFields: collectedData.procedureRequiredFields,
          collectedData,
        }),
        snapshot: procedureSnapshot,
        actionOptions: buildProcedureActionOptions({
          isCompleted: true,
        }),
        nextStepType: "procedure_confirm",
        nextStepField: null,
      });
    }

    const fieldDefinition = getProcedureFieldDefinition(collectedData.procedureRequiredFields, nextField);
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: `${buildProcedureStartReply()}\n\n${buildProcedureFieldPrompt(fieldDefinition)}`,
      snapshot: procedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField: nextField,
        isCompleted: false,
      }),
      nextStepType: "ask_field",
      nextStepField: nextField,
      needsClarification: false,
    });
  }

  if (isProcedureFlowActive(snapshot)) {
    const genericProcedureRestartRequest = isGenericProcedureStartRequest(text);
    if (genericProcedureRestartRequest) {
      const activeProcedures = await listActiveProcedureCatalog();
      if (activeProcedures.length > 0) {
        const resetSnapshot = await setConversationState(sessionId, {
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          state: CHATBOT_CONVERSATION_STATES.IDLE,
          flowKey: null,
          currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
          confirmationState: "none",
          collectedData: { ...EMPTY_COLLECTED_DATA },
          lastInterpretation: interpretation,
          lastIntent: "start_procedure",
          lastAction: "restart_procedure_selection",
          lastConfidence: interpretation?.intent?.confidence || null,
        });
        return buildChatResponse({
          sessionId,
          locale: effectiveLocale,
          replyText: buildProcedureCatalogIntroReply(activeProcedures),
          snapshot: resetSnapshot,
          actionOptions: buildProcedureCatalogActionOptions(activeProcedures),
          nextStepType: "clarify_procedure",
          nextStepField: "procedureName",
          needsClarification: false,
        });
      }

      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "unsupported_procedure",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildUnsupportedProcedureReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }

    const procedureSwitchToIncident =
      shouldSwitchToIncidentFlow({ text, interpretation }) ||
      shouldActivateIncidentFlow({
        interpretation,
        text,
        contextEntry,
      });
    if (procedureSwitchToIncident) {
      const incidentSeed = {
        ...EMPTY_COLLECTED_DATA,
        category: "incidencia_general",
        subcategory: "reporte_general",
      };
      const mergedFromSwitch = mergeCollectedDataFromInterpretation({
        collectedData: incidentSeed,
        interpretation,
        text,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      });
      const nextIncidentStep = getNextIncidentFlowStep(mergedFromSwitch.collectedData);
      const switchedSnapshot = await setConversationState(
        sessionId,
        createIncidentFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: mergedFromSwitch.collectedData,
          currentStep: nextIncidentStep,
          confirmationState:
            nextIncidentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none",
          lastInterpretation: interpretation,
          lastIntent: "report_incident",
          lastAction: "switch_to_incident",
          lastConfidence: interpretation?.intent?.confidence || null,
        })
      );
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.FLOW_ACTIVATED,
        mode: "incident",
        outcome: "switch_procedure_to_incident",
      });

      if (nextIncidentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) {
        return buildChatResponse({
          sessionId,
          locale: effectiveLocale,
          replyText: buildIncidentResumeReply(mergedFromSwitch.collectedData),
          snapshot: switchedSnapshot,
          actionOptions: buildConfirmationActionOptions(),
          nextStepType: "confirm_incident",
          nextStepField: null,
        });
      }

      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({
          step: nextIncidentStep,
          suggestedReply: interpretation?.assistantStyle?.suggestedReply || null,
        }),
        snapshot: switchedSnapshot,
        actionOptions:
          nextIncidentStep === CHATBOT_CURRENT_STEPS.PHOTO ? buildPhotoActionOptions() : [],
        nextStepType: "ask_field",
        nextStepField: nextIncidentStep,
      });
    }

    const activeProcedure = await getProcedureByCode(snapshot.collectedData?.procedureCode);
    if (chatDebugEnabled) {
      logChatDebug(
        "procedure_flow_active",
        buildChatDebugPayload({
          sessionId,
          text,
          command: effectiveCommand,
          commandField: effectiveCommandField,
          contextEntry,
          snapshotBefore: snapshot,
          interpretation,
          llmMeta,
          decision: {
            procedureCodeFromSnapshot: snapshot.collectedData?.procedureCode || null,
            activeProcedureFound: Boolean(activeProcedure),
            activeProcedureCode: activeProcedure?.code || null,
          },
        })
      );
    }
    if (!activeProcedure) {
      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "procedure_catalog_entry_missing",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildUnsupportedProcedureReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }

    const normalizedText = typeof text === "string" ? normalizeProcedureText(text, 320) : "";
    const procedureData = normalizeProcedureCollectedData({
      ...snapshot.collectedData,
      procedureCode: activeProcedure.code,
      procedureName: activeProcedure.name,
      procedureCategory: activeProcedure.category || "",
      procedureRequiredFields: activeProcedure.requiredFields || [],
    });

    const procedureMissingBefore = getProcedureMissingFields(procedureData);
    const currentMissingField = procedureMissingBefore[0] || null;
    const currentFieldDefinition = getProcedureFieldDefinition(
      procedureData.procedureRequiredFields,
      currentMissingField
    );
    let hasProcedureUpdate = false;
    let validationError = null;
    if (normalizedText && currentMissingField) {
      const validationResult = validateProcedureFieldInput({
        fieldDefinition: currentFieldDefinition,
        inputValue: normalizedText,
      });
      if (validationResult.ok) {
        procedureData[currentMissingField] = validationResult.normalizedValue;
        hasProcedureUpdate = true;
      } else {
        validationError = validationResult.error;
      }
    }

    const procedureMissing = getProcedureMissingFields(procedureData);
    const nextMissingField = procedureMissing[0] || null;
    const procedureStep = nextMissingField
      ? mapProcedureFieldToStep(nextMissingField)
      : CHATBOT_CURRENT_STEPS.CONFIRMATION;
    const updatedProcedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: procedureData,
        currentStep: procedureStep,
        confirmationState: procedureMissing.length > 0 ? "none" : "ready",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
        lastConfidence: interpretation?.intent?.confidence || null,
      })
    );
    if (chatDebugEnabled) {
      logChatDebug(
        "procedure_field_processing",
        buildChatDebugPayload({
          sessionId,
          text,
          command: effectiveCommand,
          commandField: effectiveCommandField,
          contextEntry,
          snapshotBefore: snapshot,
          snapshotAfter: updatedProcedureSnapshot,
          interpretation,
          llmMeta,
          decision: {
            normalizedText,
            currentMissingField,
            hasProcedureUpdate,
            validationError,
            nextMissingField,
          },
        })
      );
    }

    if (procedureMissing.length === 0) {
      const replyText = hasProcedureUpdate
        ? buildProcedureSummaryText({
            procedureName: procedureData.procedureName,
            requiredFields: procedureData.procedureRequiredFields,
            collectedData: procedureData,
          })
        : "Ya tengo toda la información requerida para este trámite. Si está correcto, confirma para continuar.";
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText,
        snapshot: updatedProcedureSnapshot,
        actionOptions: buildProcedureActionOptions({
          isCompleted: true,
        }),
        nextStepType: "procedure_confirm",
        nextStepField: null,
      });
    }

    const nextFieldDefinition = getProcedureFieldDefinition(
      procedureData.procedureRequiredFields,
      nextMissingField
    );
    const procedureReply = validationError
      ? buildProcedureFieldValidationReply(validationError, currentFieldDefinition || nextFieldDefinition)
      : buildProcedureFieldPrompt(nextFieldDefinition);
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: procedureReply,
      snapshot: updatedProcedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField,
        isCompleted: false,
      }),
      nextStepType: "ask_field",
      nextStepField: nextMissingField,
    });
  }

  if (
    isIncidentFlowActive(snapshot) &&
    shouldSwitchToProcedureFlow({ text, interpretation })
  ) {
    const procedureMatch = await findMatchingProcedure({
      text,
      interpretation,
    });
    if (!procedureMatch) {
      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "unsupported_procedure",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildUnsupportedProcedureReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }
    const collectedData = normalizeProcedureCollectedData({
      ...EMPTY_COLLECTED_DATA,
      procedureCode: procedureMatch.code,
      procedureName: procedureMatch.name,
      procedureCategory: procedureMatch.category || "",
      procedureRequiredFields: procedureMatch.requiredFields || [],
    });
    const missingFields = getProcedureMissingFields(collectedData);
    const nextMissingField = missingFields[0] || null;
    const procedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData,
        currentStep: nextMissingField
          ? mapProcedureFieldToStep(nextMissingField)
          : CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: nextMissingField ? "none" : "ready",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: "switch_incident_to_procedure_catalog",
        lastConfidence: procedureMatch.matchScore ?? interpretation?.intent?.confidence ?? null,
      })
    );
    if (!nextMissingField) {
      return buildChatResponse({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureSummaryText({
          procedureName: collectedData.procedureName,
          requiredFields: collectedData.procedureRequiredFields,
          collectedData,
        }),
        snapshot: procedureSnapshot,
        actionOptions: buildProcedureActionOptions({
          isCompleted: true,
        }),
        nextStepType: "procedure_confirm",
        nextStepField: null,
      });
    }
    const nextFieldDefinition = getProcedureFieldDefinition(
      collectedData.procedureRequiredFields,
      nextMissingField
    );
    return buildChatResponse({
      sessionId,
      locale: effectiveLocale,
      replyText: buildProcedureFieldPrompt(nextFieldDefinition),
      snapshot: procedureSnapshot,
      actionOptions: buildProcedureActionOptions({
        nextMissingField,
        isCompleted: false,
      }),
      nextStepType: "ask_field",
      nextStepField: nextMissingField,
    });
  }

  if (!isIncidentFlowActive(snapshot)) {
    const shouldActivate = shouldActivateIncidentFlow({
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
          "Puedo ayudarte a reportar una incidencia o a iniciar un trámite. Dime qué quieres hacer y te guío con el siguiente paso.",
        snapshot: {
          ...snapshot,
          locale: effectiveLocale,
          lastInterpretation: interpretation,
          lastIntent: interpretation?.intent?.kind || "unknown",
          lastAction: effectiveCommand || "none",
          lastConfidence: interpretation?.intent?.confidence || null,
        },
        actionOptions: buildClarificationActionOptions(),
        nextStepType: "clarify",
        nextStepField: null,
        needsClarification: true,
      });
    }

    const seedData = contextEntry
      ? buildIncidentFlowSeedFromContext(contextEntry)
      : {
          ...EMPTY_COLLECTED_DATA,
          category: "incidencia_general",
          subcategory: "reporte_general",
        };
    snapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
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
  const nextStep = getNextIncidentFlowStep(mergedData);
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
    createIncidentFlowSnapshotPatch({
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

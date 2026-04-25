import {
  CHATBOT_CONVERSATION_STATES,
  CHATBOT_CURRENT_STEPS,
  clearIncidentDraft,
  getSessionSnapshot,
  setConversationState,
  setSessionUserId,
} from "../chatSessionStore";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../i18n";
import { detectLocaleFromText } from "../languageDetection";
import { extractDraftAttachmentRefFromCollectedData } from "../attachments/draftAttachmentRef";
import { getIncidentAttachmentStorageByProvider } from "../attachments/getIncidentAttachmentStorage";
import { createIncident, findIncidentByIdentifier } from "../incidents";
import {
  syncIncidentToCamundaAfterCreate,
  syncTramiteToCamundaAfterCreate,
} from "../camunda/syncLocalCaseToCamunda";
import { tryHandleWaitingCitizenInfoMessage } from "../camunda/handleCitizenInfoForWaitingProcedure";
import {
  PROCEDURE_REQUEST_STATUSES,
  createProcedureRequest,
  findProcedureRequestByIdentifier,
} from "../procedureRequests";
import {
  FLOW_KEY_INCIDENT,
  FLOW_KEY_PROCEDURE,
  buildAuthRequiredReply,
  buildCancelledIncidentReply,
  buildIncidentConfirmationIntroReply,
  buildIncidentConfirmationGateReply,
  buildIncidentCreatedReply,
  buildIncidentDraftPreviewPayload,
  buildProcedureStartReply,
  buildPhotoActionOptions,
  buildQuestionForStep,
  buildIncidentFlowSeedFromContext,
  createIncidentFlowSnapshotPatch,
  getNextIncidentFlowStep,
  isProcedureFlowActive,
  isIncidentFlowActive,
  mergeCollectedDataFromInterpretation,
  matchesAffirmativeConfirmationText,
  matchesCancellationText,
  parseUserCommandFromText,
  shouldActivateIncidentFlow,
  shouldSwitchToIncidentFlow,
  shouldSwitchToProcedureFlow,
  createProcedureFlowSnapshotPatch,
} from "../chatbotConversationOrchestrator";
import {
  CHATBOT_FUNNEL_STEPS,
  CHATBOT_TELEMETRY_EVENTS,
  trackChatbotEvent,
} from "../chatbotTelemetry";
import { interpretUserMessage } from "../llmService";
import {
  handleWhatsAppStructuredIncidentTurn,
  buildLlmSyntheticUserText,
} from "../whatsapp/whatsappStructuredTurn";
import { inferWhatsAppWaIdFromAssistantSessionId } from "../whatsapp/whatsappSessionId";
import {
  assessSttCriticalIncidentTurn,
  assessSttCriticalProcedureTurn,
  formatSttCriticalEchoUserReply,
} from "./sttCriticalData";
import {
  hasProcedureSpecificSignals,
  normalizeIntentLookup,
} from "../chatbotIntentUtils";
import {
  findMatchingProcedure,
  getProcedureByCode,
  ensureProcedureCatalogSchema,
  listActiveProcedureCatalog,
  resolveCatalogItemForIncident,
  normalizeProcedureCollectedData,
  getProcedureMissingFieldsFromDefinition,
  getProcedureFieldDefinition,
  validateProcedureFieldInput,
  buildProcedureSummaryText,
  buildProcedureDraftConfirmationText,
} from "../procedureCatalog";

// Optional mode: treat procedure catalog as single source of truth
// for chatbot-reported cases (incident intents are routed to procedure flow).
function isProcedureOnlyCatalogMode() {
  const raw = String(process.env.CHATBOT_CATALOG_CASE_TYPE || "")
    .trim()
    .toLowerCase();
  if (!raw) {
    return true;
  }
  return raw === "procedure";
}

function isProcedureOnlyCatalogReportText(text) {
  const normalized = normalizeIntentLookup(text || "");
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("reportar") ||
    normalized.includes("reporte") ||
    normalized.includes("reclamo") ||
    normalized.includes("denuncia") ||
    normalized.includes("incidencia") ||
    normalized.includes("problema") ||
    normalized.includes("solicitud")
  );
}

const DEFAULT_INCIDENT_REQUIRED_FIELDS = [
  { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
  { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
  { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
];

const EMPTY_COLLECTED_DATA = {
  category: "",
  catalogItemId: "",
  catalogItemCode: "",
  incidentRequiredFields: [],
  subcategory: "",
  location: "",
  description: "",
  photoStatus: "not_requested",
  photoAttachmentStorageProvider: "",
  photoAttachmentStorageKey: "",
  photoAttachmentPublicUrl: "",
  photoAttachmentSizeBytes: 0,
  photoAttachmentOriginalName: "",
  photoAttachmentStoredFilename: "",
  photoAttachmentMimeType: "",
  photoAttachmentUploadedAt: "",
  photoWhatsappMediaId: "",
  photoAttachmentChannel: "",
  photoDownloadStatus: "",
  photoCaption: "",
  photoDownloadError: "",
  locationLatitude: null,
  locationLongitude: null,
  locationAddressText: "",
  locationSource: "",
  procedureName: "",
  procedureDetails: "",
  procedureCode: "",
  procedureCategory: "",
  procedureRequiredFields: [],
  sttCriticalEchoPending: false,
};

function getDefaultSnapshot() {
  return {
    locale: null,
    userId: null,
    whatsappWaId: null,
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
  const requiredFieldDefinitions = getIncidentFieldDefinitions(collectedData);
  return requiredFieldDefinitions
    .filter((field) => field.required !== false)
    .map((field) => field.key)
    .filter((fieldKey) => {
      const definition = getIncidentFieldDefinition(collectedData, fieldKey);
      if (definition?.type === "image") {
        return (collectedData?.photoStatus || "not_requested") !== "provided";
      }
      return !normalizeStringField(collectedData?.[fieldKey], 320);
    });
}

function mapFieldToStep(fieldName) {
  const normalized = normalizeStringField(fieldName, 60).toLowerCase();
  if (!normalized) {
    return CHATBOT_CURRENT_STEPS.DESCRIPTION;
  }
  return normalized;
}

function getIncidentFieldDefinitions(collectedData) {
  const configured = Array.isArray(collectedData?.incidentRequiredFields)
    ? collectedData.incidentRequiredFields.filter((field) => field && typeof field === "object")
    : [];
  if (configured.length > 0) {
    const unique = new Set();
    return configured
      .map((field, index) => {
        const key = normalizeStringField(field.key, 60)
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "");
        if (!key || unique.has(key)) {
          return null;
        }
        unique.add(key);
        return {
          key,
          label: normalizeStringField(field.label || key, 120),
          prompt: normalizeStringField(field.prompt, 280),
          type: normalizeStringField(field.type, 30).toLowerCase() || "text",
          required: field.required !== false,
          order: Number.isInteger(field.order) ? field.order : index,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }
  return [...DEFAULT_INCIDENT_REQUIRED_FIELDS];
}

function getIncidentFieldDefinition(collectedData, fieldKey) {
  const normalizedFieldKey = normalizeStringField(fieldKey, 60)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (!normalizedFieldKey) {
    return null;
  }
  return getIncidentFieldDefinitions(collectedData).find((field) => field.key === normalizedFieldKey) || null;
}

function canSkipImageField(collectedData, fieldKey) {
  const definition = getIncidentFieldDefinition(collectedData, fieldKey);
  if (!definition || definition.type !== "image") {
    return false;
  }
  return definition.required === false;
}

function normalizeLookupText(value) {
  return normalizeStringField(value, 200)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveIncidentFieldFromCorrectionText(collectedData, rawCommandField, rawUserText) {
  const fields = getIncidentFieldDefinitions(collectedData);
  const direct = normalizeLookupText(rawCommandField || "");
  const text = normalizeLookupText(rawUserText || "");
  const aliasByKey = {
    description: ["descripcion", "detalle"],
    photo: ["foto", "imagen", "evidencia", "adjunto", "adjuntar"],
    location: ["ubicacion", "direccion", "referencia", "lugar", "mapa", "coordenadas"],
  };
  const candidates = [direct, text].filter(Boolean);
  for (const candidate of candidates) {
    const withoutPrefix = candidate.replace(/^(?:corregir|editar|cambiar|modificar)\s+/u, "").trim();
    for (const field of fields) {
      const keyLookup = normalizeLookupText(field.key);
      const labelLookup = normalizeLookupText(field.label);
      const aliases = aliasByKey[field.key] || [];
      const keysToCheck = [keyLookup, labelLookup, ...aliases].filter(Boolean);
      if (
        keysToCheck.some(
          (token) =>
            candidate === token ||
            withoutPrefix === token ||
            candidate.includes(token) ||
            withoutPrefix.includes(token)
        )
      ) {
        return field;
      }
    }
  }
  return null;
}

function resolveProcedureFieldFromCorrectionText(requiredFields, rawCommandField, rawUserText) {
  const normalizedFields = Array.isArray(requiredFields)
    ? requiredFields.filter((field) => field && typeof field === "object")
    : [];
  const candidates = [normalizeLookupText(rawCommandField || ""), normalizeLookupText(rawUserText || "")].filter(
    Boolean
  );
  for (const candidate of candidates) {
    const withoutPrefix = candidate.replace(/^(?:corregir|editar|cambiar|modificar)\s+/u, "").trim();
    for (const field of normalizedFields) {
      const keyLookup = normalizeLookupText(field.key || "");
      const labelLookup = normalizeLookupText(field.label || "");
      if (
        (keyLookup && (candidate.includes(keyLookup) || withoutPrefix.includes(keyLookup))) ||
        (labelLookup && (candidate.includes(labelLookup) || withoutPrefix.includes(labelLookup)))
      ) {
        return normalizeStringField(field.key, 60).toLowerCase();
      }
    }
  }
  return null;
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

function isGenericIncidentCategory(value) {
  const normalized = normalizeStringField(value, 80).toLowerCase();
  return !normalized || normalized === "incidencia_general" || normalized === "reporte_general";
}

function mergeIncidentCatalogSelection(collectedData, catalogItem) {
  const base = collectedData && typeof collectedData === "object" ? collectedData : {};
  if (!catalogItem || catalogItem.caseType !== "incident") {
    return base;
  }
  const requiredFields = Array.isArray(catalogItem.requiredFields)
    ? catalogItem.requiredFields
        .filter((field) => field && typeof field === "object")
        .map((field, index) => ({
          key: normalizeStringField(field.key, 60).toLowerCase().replace(/[^a-z0-9_]/g, ""),
          label: normalizeStringField(field.label || field.key, 120),
          prompt: normalizeStringField(field.prompt, 280),
          type: normalizeStringField(field.type, 24).toLowerCase() || "text",
          required: field.required !== false,
          order: Number.isInteger(field.order) ? field.order : index,
        }))
        .filter((field) => field.key)
    : [];
  const next = {
    ...base,
    catalogItemId: normalizeStringField(catalogItem.id, 80),
    catalogItemCode: normalizeStringField(catalogItem.code, 120).toLowerCase(),
    incidentRequiredFields: requiredFields.length > 0 ? requiredFields : base.incidentRequiredFields || [],
    procedureName:
      getProcedureDisplayName(catalogItem) || normalizeStringField(base.procedureName, 160) || "",
  };
  if (isGenericIncidentCategory(next.category) && normalizeStringField(catalogItem.category, 80)) {
    next.category = normalizeStringField(catalogItem.category, 80);
  }
  if (!normalizeStringField(next.subcategory, 120)) {
    next.subcategory = "reporte_general";
  }
  return next;
}

async function enrichIncidentDataWithCatalog({ collectedData, text, interpretation }) {
  const base = collectedData && typeof collectedData === "object" ? collectedData : {};
  const catalogItem = await resolveCatalogItemForIncident({
    catalogItemId: base.catalogItemId || null,
    code: base.catalogItemCode || null,
    text,
    description: base.description || "",
    category: base.category || "",
    interpretation,
  });
  return mergeIncidentCatalogSelection(base, catalogItem);
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

async function resolveStatusSummaryByIdentifier({ userId, whatsappWaId, identifier }) {
  const portalUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  const waDigits =
    typeof whatsappWaId === "string" ? whatsappWaId.replace(/\D/g, "").slice(0, 32) || null : null;
  if (!identifier || (!portalUserId && !waDigits)) {
    return null;
  }

  const normalizedIdentifier = normalizeStatusIdentifier(identifier);
  if (!normalizedIdentifier) {
    return null;
  }

  const [incidentMatch, procedureMatch] = await Promise.all([
    findIncidentByIdentifier({
      userId: portalUserId,
      whatsappWaId: waDigits,
      identifier: normalizedIdentifier,
    }),
    findProcedureRequestByIdentifier({
      userId: portalUserId,
      whatsappWaId: waDigits,
      identifier: normalizedIdentifier,
    }),
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
    const statusNarrativeSignals = [
      "no se nada",
      "sin novedades",
      "no tengo novedades",
      "no tuve novedades",
      "ya registre",
      "hace unos dias registre",
      "hace dias registre",
      "como puedo ver su estado",
      "como ver su estado",
      "quiero ver su estado",
      "consultar su estado",
    ];
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
    const hasIdentifierSignal = Boolean(extractStatusIdentifierFromText(text));
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
    const hasStatusNarrativeSignal = statusNarrativeSignals.some((signal) =>
      normalized.includes(signal)
    );
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
      (hasStatusNarrativeSignal && hasStatusObjectSignal) ||
      hasNotificationStatusPattern ||
      (hasIdentifierSignal &&
        (hasStatusObjectSignal ||
          /\b(?:id|identificador|ticket|codigo|expediente)\b/u.test(normalized))) ||
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

const START_CLASSIFIER_CONFIDENCE_ACCEPT = 0.6;
const START_CLASSIFIER_CONFIDENCE_WEAK = 0.45;

function resolveConversationStartClassification(interpretation, llmMeta) {
  const source = llmMeta?.source === "llm" ? "llm" : "fallback";
  const start = interpretation?.conversationStart || {};
  const rawIntent = normalizeStringField(start.intent || "", 40).toLowerCase();
  const allowedIntents = new Set([
    "greeting_or_start",
    "start_case",
    "check_status",
    "unsupported",
    "ambiguous",
  ]);
  const intent = allowedIntents.has(rawIntent) ? rawIntent : "ambiguous";
  const confidence =
    typeof start.confidence === "number" && Number.isFinite(start.confidence)
      ? Math.max(0, Math.min(1, start.confidence))
      : 0;
  const caseKindRaw = normalizeStringField(start?.extractedData?.caseKind || "", 20).toLowerCase();
  let caseKind = caseKindRaw === "incident" || caseKindRaw === "procedure" ? caseKindRaw : null;
  const userMessage = normalizeStringField(start.userMessage || "", 240);

  let resolvedIntent = intent;
  if (resolvedIntent === "ambiguous") {
    const fallbackIntentKind = normalizeStringField(interpretation?.intent?.kind || "", 40).toLowerCase();
    const fallbackIntentConfidence =
      typeof interpretation?.intent?.confidence === "number" &&
      Number.isFinite(interpretation.intent.confidence)
        ? interpretation.intent.confidence
        : 0;
    if (fallbackIntentKind === "check_status" && fallbackIntentConfidence >= START_CLASSIFIER_CONFIDENCE_ACCEPT) {
      resolvedIntent = "check_status";
    } else if (
      (fallbackIntentKind === "report_incident" || fallbackIntentKind === "start_procedure") &&
      fallbackIntentConfidence >= START_CLASSIFIER_CONFIDENCE_ACCEPT
    ) {
      resolvedIntent = "start_case";
      if (!caseKind) {
        caseKind = fallbackIntentKind === "report_incident" ? "incident" : "procedure";
      }
    } else if (Boolean(interpretation?.userSignals?.greetingOpen)) {
      resolvedIntent = "greeting_or_start";
    }
  }

  const reliable =
    source === "llm" &&
    (confidence >= START_CLASSIFIER_CONFIDENCE_ACCEPT ||
      (resolvedIntent === "greeting_or_start" && confidence >= START_CLASSIFIER_CONFIDENCE_WEAK) ||
      (resolvedIntent !== "ambiguous" && confidence === 0));
  return {
    source,
    intent: resolvedIntent,
    confidence,
    caseKind,
    userMessage: userMessage || null,
    reliable,
  };
}

function isPoliteThanksMessageAtStart(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }
  return ["gracias", "muchas gracias", "mil gracias", "gracias!", "thanks", "thank you"].includes(
    normalized
  );
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

function parseOptionNumberFromText(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(?:opcion\s*)?(\d{1,2})$/i);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function buildNumberedListLines(entries) {
  return entries.map((entry, index) => `${index + 1}. ${entry}`);
}

function getProcedureDisplayName(procedure, fallback = "") {
  if (!procedure || typeof procedure !== "object") {
    return normalizeStringField(fallback, 160);
  }
  const candidates = [
    procedure?.displayName,
    procedure?.label,
    procedure?.title,
    procedure?.name,
    procedure?.procedureName,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeStringField(candidate, 160);
    if (normalized) {
      return normalized;
    }
  }
  return normalizeStringField(fallback, 160);
}

const START_OPTIONS_BLOCK = [
  "Puedo ayudarte con:",
  "",
  "1. Iniciar un trámite o reportar una incidencia",
  "2. Consultar el estado de un caso",
  "",
  "Respondé con el número o contame qué necesitás.",
].join("\n");

function buildIntentClarificationReply() {
  return `No me quedó claro qué querés hacer.\n\n${START_OPTIONS_BLOCK}`;
}

function buildWelcomeReply() {
  return `Hola 👋 Soy el asistente del Sistema de Atención Ciudadana.

${START_OPTIONS_BLOCK}`;
}

function buildRepeatedGreetingReply() {
  return `Hola de nuevo 👋

${START_OPTIONS_BLOCK}`;
}

function buildThanksAtStartReply() {
  return `De nada.

${START_OPTIONS_BLOCK}`;
}

function buildNoActiveProceduresReply() {
  return "Por el momento no tengo procedimientos disponibles para iniciar desde el chat.";
}

function buildInvalidProcedureOptionNumberReply() {
  return "No encontré una opción con ese número. Probá con uno de la lista o escribí el nombre del procedimiento.";
}

function buildProcedureCatalogIntroReply(procedures) {
  const supported = Array.isArray(procedures) ? procedures : [];
  if (supported.length === 0) {
    return buildNoActiveProceduresReply();
  }

  const names = supported
    .slice(0, 6)
    .map((procedure) => getProcedureDisplayName(procedure))
    .filter(Boolean);
  if (names.length === 0) {
    return buildNoActiveProceduresReply();
  }

  const lines = [
    "Puedo ayudarte con:",
    "",
    ...buildNumberedListLines(names),
    "",
    "Respondé con el número o escribí el nombre del procedimiento.",
  ];
  return lines.join("\n");
}

function buildProcedureCatalogDisambiguationReply(procedures) {
  return `No me quedó clara la opción.\n\n${buildProcedureCatalogIntroReply(procedures)}`;
}

function buildProcedureSelectionTerms(procedure) {
  const terms = [
    procedure?.name,
    ...(Array.isArray(procedure?.aliases) ? procedure.aliases : []),
    ...(Array.isArray(procedure?.keywords) ? procedure.keywords : []),
  ]
    .map((term) => normalizeIntentLookup(term))
    .filter(Boolean);
  return Array.from(new Set(terms));
}

function isIncidentLikeProcedureCatalogEntry(procedure) {
  if (!procedure || typeof procedure !== "object") {
    return false;
  }
  const haystack = [
    procedure?.code,
    procedure?.name,
    procedure?.category,
    ...(Array.isArray(procedure?.aliases) ? procedure.aliases : []),
    ...(Array.isArray(procedure?.keywords) ? procedure.keywords : []),
  ]
    .map((value) => normalizeIntentLookup(value))
    .filter(Boolean)
    .join(" ");
  if (!haystack) {
    return false;
  }
  return /\b(?:incidencia|reporte|reportar|problema|reclamo|denuncia)\b/u.test(haystack);
}

function scoreProcedureByUserText(procedure, normalizedText) {
  if (!normalizedText) {
    return 0;
  }
  const terms = buildProcedureSelectionTerms(procedure);
  if (terms.length === 0) {
    return 0;
  }

  let score = 0;
  for (const term of terms) {
    if (normalizedText === term) {
      score = Math.max(score, 100);
      continue;
    }
    if (normalizedText.includes(term)) {
      score = Math.max(score, 92);
      continue;
    }
    if (term.includes(normalizedText) && normalizedText.length >= 4) {
      score = Math.max(score, 85);
      continue;
    }
    const normalizedTokens = normalizedText.split(" ").filter(Boolean);
    const termTokens = term.split(" ").filter(Boolean);
    if (!normalizedTokens.length || !termTokens.length) {
      continue;
    }
    const overlap = normalizedTokens.filter((token) => termTokens.includes(token)).length;
    if (overlap > 0) {
      const ratio = overlap / normalizedTokens.length;
      if (ratio >= 0.75) {
        score = Math.max(score, 80);
      } else if (ratio >= 0.5) {
        score = Math.max(score, 72);
      } else if (ratio >= 0.34) {
        score = Math.max(score, 64);
      }
    }
  }

  return score;
}

async function resolveProcedureCatalogSelection({ text, activeProcedures, interpretation }) {
  const procedures = Array.isArray(activeProcedures) ? activeProcedures.slice(0, 6) : [];
  if (procedures.length === 0) {
    return { status: "no_catalog", procedure: null };
  }

  const optionNumber = parseOptionNumberFromText(text);
  if (optionNumber !== null) {
    if (optionNumber < 1 || optionNumber > procedures.length) {
      return { status: "invalid_number", procedure: null };
    }
    return { status: "matched", procedure: procedures[optionNumber - 1] };
  }

  const normalizedText = normalizeIntentLookup(text);
  if (normalizedText) {
    const scored = procedures
      .map((procedure) => ({
        procedure,
        score: scoreProcedureByUserText(procedure, normalizedText),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0] || null;
    const second = scored[1] || null;
    if (best && best.score >= 72) {
      if (second && best.score - second.score <= 6) {
        return { status: "ambiguous", procedure: null };
      }
      return { status: "matched", procedure: best.procedure };
    }
    if (scored.length > 1 && best && best.score >= 64) {
      return { status: "ambiguous", procedure: null };
    }
  }

  const fallbackMatch = await findMatchingProcedure({
    text,
    interpretation,
  });
  if (fallbackMatch) {
    const found = procedures.find((procedure) => procedure.code === fallbackMatch.code);
    if (found) {
      return { status: "matched", procedure: found };
    }
  }

  return { status: "no_match", procedure: null };
}

function buildProcedureActionOptions({ nextMissingField = null, isCompleted = false } = {}) {
  void nextMissingField;
  void isCompleted;
  return [];
}

function buildStatusActionOptions({ afterSummary = false } = {}) {
  if (afterSummary) {
    return [
      {
        label: "Ver mis incidencias",
        command: "none",
        value: "Quiero ver mis incidencias.",
        commandField: null,
      },
      {
        label: "Consultar otro caso",
        command: "none",
        value: "Quiero consultar otro caso con identificador.",
        commandField: null,
      },
      {
        label: "Reportar nueva incidencia",
        command: "none",
        value: "Quiero reportar una nueva incidencia.",
        commandField: null,
      },
    ];
  }
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

function buildStatusResultActionOptions({ isIncident = false } = {}) {
  const options = [
    {
      label: "Ver mis incidencias",
      command: "none",
      value: "Quiero ver mis incidencias.",
      commandField: null,
    },
    {
      label: "Consultar otro caso",
      command: "none",
      value: "Quiero consultar otro caso con identificador.",
      commandField: null,
    },
  ];
  if (isIncident) {
    options.push({
      label: "Reportar nueva incidencia",
      command: "none",
      value: "Quiero reportar una incidencia.",
      commandField: null,
    });
  } else {
    options.push({
      label: "Iniciar trámite",
      command: "none",
      value: "Quiero iniciar un trámite.",
      commandField: null,
    });
  }
  return options;
}

function buildStatusReply({ identifierRequested = false, channel = "web" } = {}) {
  if (identifierRequested) {
    return "Perfecto. Para resumirte el estado aquí en el chat, compárteme el identificador de tu solicitud (por ejemplo: INC-1234ABCD o TRA-1234ABCD).";
  }
  if (channel === "whatsapp") {
    return "Entiendo. Te ayudo a consultar el estado. Enviá el código del caso (por ejemplo INC-… o TRA-…) y te resumo el avance acá en el chat.";
  }
  return "Entiendo. Te ayudo a consultar el estado de tu solicitud. Puedes revisar tus casos en 'Mis incidencias' o, si prefieres, indícame el identificador y te resumo el estado aquí mismo.";
}

function buildGreetingReply() {
  return buildWelcomeReply();
}

function buildIncidentStartReply() {
  return "Bien, cuéntame qué sucede para ayudarte a registrar la incidencia.";
}

function buildUnsupportedProcedureReply() {
  return "De momento no puedo ayudarte con ese trámite desde este chat.";
}

function buildProcedureCompletedReply(activeProcedure, requestCode = null, channel = "web") {
  const completionFromCatalog = activeProcedure?.flowDefinition?.completionMessage;
  const procedureName = getProcedureDisplayName(activeProcedure, "el trámite");
  const catalogLine =
    typeof completionFromCatalog === "string" && completionFromCatalog.trim()
      ? completionFromCatalog.trim().slice(0, 280)
      : `Listo: registré la solicitud de ${procedureName}.`;
  if (requestCode) {
    if (channel === "whatsapp") {
      return `${catalogLine} Identificador: ${requestCode}. Guardalo: desde este mismo chat podés consultarme el estado cuando quieras enviándolo en un mensaje.`;
    }
    return `${catalogLine} Identificador: ${requestCode}. Podés consultarlo después desde «Mis incidencias».`;
  }
  return `${catalogLine} Si necesitás otro trámite o una incidencia, decime y seguimos.`;
}

function humanizeIncidentTypeLabel(value) {
  const normalized = normalizeIntentLookup(value);
  if (!normalized) {
    return "Incidencia ciudadana";
  }
  if (normalized === "incidencia_general" || normalized === "reporte_general") {
    return "Incidencia general";
  }
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function buildIncidentStatusExplanation(statusLabel) {
  const normalized = normalizeIntentLookup(statusLabel);
  if (normalized.includes("recibido")) {
    return "Tu incidencia fue registrada correctamente y está pendiente de revisión por el equipo correspondiente.";
  }
  if (normalized.includes("revision")) {
    return "Tu incidencia está siendo revisada por el equipo correspondiente.";
  }
  if (normalized.includes("proceso")) {
    return "Tu incidencia está en proceso de atención.";
  }
  if (normalized.includes("resuelto")) {
    return "Tu incidencia figura como resuelta. Si necesitas, puedo ayudarte a revisar otro caso.";
  }
  return "Te comparto el estado actualizado de tu incidencia.";
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
    const typeLabel = humanizeIncidentTypeLabel(statusEntry.category || statusEntry.subcategory || "");
    const friendlyExplanation = buildIncidentStatusExplanation(statusLabel);
    return `Incidencia ${identifier}

Estado actual: ${statusLabel}
${friendlyExplanation}

Detalles del caso:
- Última actualización: ${updatedAt}
- Ubicación: ${statusEntry.location || "Sin ubicación informada"}
- Tipo: ${typeLabel}
- Descripción: ${description || "Sin descripción disponible"}

Si quieres, puedo ayudarte con otro identificador o con una nueva incidencia.`;
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

function buildProcedureFieldPrompt(fieldDefinition, procedureName = "") {
  const normalizedProcedureName = normalizeStringField(procedureName, 160);
  if (!fieldDefinition || typeof fieldDefinition !== "object") {
    return normalizedProcedureName
      ? `Para continuar con "${normalizedProcedureName}", indícame el siguiente dato requerido.`
      : "Para continuar con este trámite, indícame el siguiente dato requerido.";
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
  return `${safeError} ${prompt}`.replace(/\s+/g, " ").trim();
}

function buildAssistantTurnResult({
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

  let incidentDraftPreview = null;
  if (
    nextStepType === "confirm_incident" &&
    mode === "incident" &&
    missingFields.length === 0
  ) {
    incidentDraftPreview = buildIncidentDraftPreviewPayload(collectedData);
  }

  const body = {
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
    incidentDraftPreview,
  };

  return { status: 200, body, snapshot };
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

export function buildChatDebugHeaders(snapshot) {
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

function resolveEffectiveLocale({ preferredLocale, sessionLocale, text, acceptLanguage }) {
  const detectedTextLocale = detectLocaleFromText(text);
  const selectedLocale =
    preferredLocale ||
    sessionLocale ||
    detectedTextLocale ||
    resolveLocaleFromAcceptLanguage(acceptLanguage) ||
    normalizeLocale(acceptLanguage) ||
    getDefaultLocale();

  return normalizeLocale(selectedLocale) || getDefaultLocale();
}

function incidentConfirmationIntro(locale, ch, collectedData) {
  return buildIncidentConfirmationIntroReply(locale, {
    channel: ch === "whatsapp" ? "whatsapp" : "web",
    collectedData,
  });
}

/**
 * Core assistant / chatbot turn. Shared by the web API route and other channels (e.g. WhatsApp).
 *
 * @param {object} params
 * @param {'web'|'whatsapp'} [params.channel='web'] — telemetry / future branching
 * @param {string} params.sessionId — chat session key (web: client id; WhatsApp: derived from wa id)
 * @param {string} [params.text]
 * @param {string|null} [params.preferredLocale]
 * @param {string} [params.command='none']
 * @param {string|null} [params.commandField]
 * @param {object|null} [params.contextEntry]
 * @param {object|null} [params.authenticatedUser] — solo canal web: usuario del portal (cookie)
 * @param {string|null} [params.whatsappWaId] — solo WhatsApp: `wa_id` del remitente (identidad del solicitante)
 * @param {string|null} [params.acceptLanguage] — Accept-Language (web); optional for WhatsApp
 * @param {boolean} [params.chatDebugEnabled]
 * @param {import("../whatsapp/normalizeInboundMessage").NormalizedIncomingMessage | null} [params.channelInbound]
 *   — solo WhatsApp: mensaje entrante ya tipado (ubicación, imagen, etc.).
 * @param {'speech_to_text'|null} [params.inboundUserTextSource]
 * @param {{ originalMessageType?: string, whatsappMessageId?: string|null, mediaId?: string|null }|null} [params.inboundOriginalChannelMeta]
 *   — metadatos del mensaje de canal cuando el texto provino de STT (p. ej. audio).
 */
export async function processAssistantTurn({
  channel = "web",
  sessionId,
  text,
  preferredLocale,
  command: commandFromPayload = "none",
  commandField: commandFieldFromPayload = null,
  contextEntry,
  authenticatedUser = null,
  whatsappWaId: whatsappWaIdParam = null,
  acceptLanguage = null,
  chatDebugEnabled = false,
  channelInbound = null,
  inboundUserTextSource = null,
  inboundOriginalChannelMeta = null,
} = {}) {
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

  if (channel === "web" && authenticatedUser?.id && snapshot.userId !== authenticatedUser.id) {
    await setSessionUserId(sessionId, authenticatedUser.id);
    snapshot = {
      ...snapshot,
      userId: authenticatedUser.id,
    };
  }

  if (channel === "whatsapp") {
    const rawWa =
      (typeof whatsappWaIdParam === "string" && whatsappWaIdParam.trim()) ||
      inferWhatsAppWaIdFromAssistantSessionId(sessionId) ||
      "";
    const normalizedWa = rawWa.replace(/\D/g, "").slice(0, 32) || null;
    if (
      normalizedWa &&
      (snapshot.whatsappWaId !== normalizedWa || snapshot.userId !== null)
    ) {
      snapshot = await setConversationState(sessionId, {
        whatsappWaId: normalizedWa,
        userId: null,
      });
    }
  }

  const effectiveLocale = resolveEffectiveLocale({
    preferredLocale,
    sessionLocale: snapshot.locale,
    text,
    acceptLanguage,
  });
  const copyChannel = channel === "whatsapp" ? "whatsapp" : "web";
  const procedureOnlyCatalogMode = isProcedureOnlyCatalogMode();

  if (channel === "whatsapp" && channelInbound) {
    console.info("[whatsapp] assistant inbound", {
      inboundType: channelInbound.type,
      currentStep: snapshot.currentStep,
      flowKey: snapshot.flowKey,
    });
  } else if (channel === "whatsapp" && inboundUserTextSource === "speech_to_text") {
    console.info("[whatsapp] assistant inbound", {
      inboundType: "audio_transcribed",
      currentStep: snapshot.currentStep,
      flowKey: snapshot.flowKey,
    });
  }

  const trackEvent = async (partialPayload) => {
    const details =
      channel && channel !== "web"
        ? `[ch=${channel}] ${partialPayload.details || ""}`.trim()
        : partialPayload.details;
    await trackChatbotEvent({
      sessionId,
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      command: commandFromPayload,
      ...partialPayload,
      details,
    });
  };

  await trackEvent({
    eventName: CHATBOT_TELEMETRY_EVENTS.TURN_RECEIVED,
    mode: buildModeFromSnapshot(snapshot),
    details: text ? "user_turn_with_text" : "user_turn_command_only",
  });

  if (
    effectiveLocale &&
    typeof text === "string" &&
    text.trim() &&
    commandFromPayload === "none" &&
    !isIncidentFlowActive(snapshot) &&
    !isProcedureFlowActive(snapshot)
  ) {
    const waitingCitizenInfo = await tryHandleWaitingCitizenInfoMessage({
      userId: channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null,
      whatsappWaId: channel === "whatsapp" ? snapshot.whatsappWaId || null : null,
      userMessageText: text,
    });
    if (waitingCitizenInfo?.handled) {
      const closedOrIdleSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null,
        whatsappWaId: channel === "whatsapp" ? snapshot.whatsappWaId || null : null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: snapshot.collectedData,
        lastInterpretation: snapshot.lastInterpretation || {},
        lastIntent: "provide_citizen_info",
        lastAction: waitingCitizenInfo.ok ? "waiting_citizen_info_sent" : "waiting_citizen_info_missing",
        lastConfidence: snapshot.lastConfidence || null,
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: waitingCitizenInfo.replyText,
        snapshot: closedOrIdleSnapshot,
        actionOptions: [],
        nextStepType: waitingCitizenInfo.ok ? "closed" : "ask_field",
        nextStepField: null,
      });
    }
  }

  let effectiveCommand = commandFromPayload;
  let effectiveCommandField = commandFieldFromPayload;
  if (effectiveCommand === "none" && text) {
    const parsedCommand = parseUserCommandFromText(text);
    if (parsedCommand.command !== "none") {
      effectiveCommand = parsedCommand.command;
      effectiveCommandField = parsedCommand.commandField;
    }
  }

  if (
    effectiveCommand === "set_geo_location" &&
    isIncidentFlowActive(snapshot) &&
    snapshot.currentStep === CHATBOT_CURRENT_STEPS.LOCATION
  ) {
    effectiveCommand = "edit_field";
    effectiveCommandField = "location";
  }

  // Cierre operativo: "sí", "dale", "ok", etc. cuentan como confirmar solo en etapa de confirmación con datos completos.
  if (effectiveCommand === "none" && text && matchesAffirmativeConfirmationText(text)) {
    if (
      isIncidentFlowActive(snapshot) &&
      snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
      getRequiredMissingFields(snapshot.collectedData).length === 0 &&
      !snapshot.collectedData?.sttCriticalEchoPending
    ) {
      effectiveCommand = "confirm";
    } else if (isProcedureFlowActive(snapshot)) {
      const procedureSnapshotData = normalizeProcedureCollectedData(snapshot.collectedData || {});
      if (
        getProcedureMissingFields(procedureSnapshotData).length === 0 &&
        snapshot.confirmationState === "ready" &&
        snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
        !procedureSnapshotData.sttCriticalEchoPending
      ) {
        effectiveCommand = "confirm";
      }
    }
  }

  const shouldMigrateLegacyIncidentSnapshot =
    procedureOnlyCatalogMode &&
    snapshot?.flowKey === FLOW_KEY_INCIDENT &&
    snapshot?.state === CHATBOT_CONVERSATION_STATES.IDLE;
  if (shouldMigrateLegacyIncidentSnapshot) {
    snapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null,
      whatsappWaId: snapshot.whatsappWaId || null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      confirmationState: "none",
      collectedData: { ...EMPTY_COLLECTED_DATA },
      lastInterpretation: snapshot.lastInterpretation || {},
      lastIntent: "start_procedure",
      lastAction: "procedure_only_migrated_from_incident",
      lastConfidence: snapshot.lastConfidence || null,
    });
  }

  if (
    effectiveCommand === "none" &&
    text &&
    matchesCancellationText(text) &&
    ((isIncidentFlowActive(snapshot) &&
      snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION) ||
      (isProcedureFlowActive(snapshot) &&
        snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
        snapshot.confirmationState === "ready"))
  ) {
    effectiveCommand = "cancel";
  }

  if (
    effectiveCommand === "request_text_correction" &&
    isIncidentFlowActive(snapshot) &&
    snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
  ) {
    const resolvedField = resolveIncidentFieldFromCorrectionText(
      snapshot.collectedData,
      effectiveCommandField,
      text || ""
    );
    if (resolvedField?.key) {
      effectiveCommand = "edit_field";
      effectiveCommandField = resolvedField.key;
    }
  }

  if (
    effectiveCommand === "none" &&
    text &&
    matchesAffirmativeConfirmationText(text) &&
    isIncidentFlowActive(snapshot) &&
    snapshot.state === CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION &&
    snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
    snapshot.collectedData?.sttCriticalEchoPending === true
  ) {
    const clearedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: { ...snapshot.collectedData, sttCriticalEchoPending: false },
        currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: "ready",
        lastInterpretation: snapshot.lastInterpretation || {},
        lastIntent: snapshot.lastIntent || "report_incident",
        lastAction: "stt_critical_echo_cleared",
        lastConfidence: snapshot.lastConfidence,
        state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      })
    );
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: incidentConfirmationIntro(effectiveLocale, channel, clearedSnapshot.collectedData),
      snapshot: clearedSnapshot,
      actionOptions: [],
      nextStepType: "confirm_incident",
      nextStepField: null,
      needsClarification: false,
    });
  }

  if (
    effectiveCommand === "none" &&
    text &&
    matchesAffirmativeConfirmationText(text) &&
    isProcedureFlowActive(snapshot) &&
    snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
    normalizeProcedureCollectedData(snapshot.collectedData || {}).sttCriticalEchoPending === true
  ) {
    const pd = normalizeProcedureCollectedData(snapshot.collectedData || {});
    const clearedProcedure = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: { ...pd, sttCriticalEchoPending: false },
        currentStep: CHATBOT_CURRENT_STEPS.CONFIRMATION,
        confirmationState: "ready",
        lastInterpretation: snapshot.lastInterpretation || {},
        lastIntent: snapshot.lastIntent || "start_procedure",
        lastAction: "stt_critical_echo_cleared",
        lastConfidence: snapshot.lastConfidence,
        state: CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
      })
    );
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildProcedureDraftConfirmationText({
        procedureName: clearedProcedure.collectedData.procedureName,
        requiredFields: clearedProcedure.collectedData.procedureRequiredFields,
        collectedData: clearedProcedure.collectedData,
      }),
      snapshot: clearedProcedure,
      actionOptions: buildProcedureActionOptions({ isCompleted: true }),
      nextStepType: "procedure_confirm",
      nextStepField: null,
      needsClarification: false,
    });
  }

  const isIncidentContextStart =
    !procedureOnlyCatalogMode &&
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
    const seededDataWithCatalog = await enrichIncidentDataWithCatalog({
      collectedData: seededData,
      text: `${contextEntry?.title || ""} ${contextEntry?.description || ""}`,
      interpretation: null,
    });
    const nextStep = getNextIncidentFlowStep(seededDataWithCatalog);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const confirmationState = nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "ready" : "none";
    const patch = createIncidentFlowSnapshotPatch({
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      collectedData: seededDataWithCatalog,
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: incidentConfirmationIntro(effectiveLocale, channel, savedSnapshot.collectedData),
        snapshot: savedSnapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    const actionOptions =
      getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep)?.type === "image"
        ? buildPhotoActionOptions({
            canSkip: canSkipImageField(savedSnapshot.collectedData, nextStep),
          })
        : [];
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({
        step: nextStep,
        channel: copyChannel,
        fieldDefinition: getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep),
      }),
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
    return buildAssistantTurnResult({
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

  if (effectiveCommand === "request_text_correction") {
    if (!isIncidentFlowActive(snapshot)) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: "Todavía no hay un reporte de incidencia en curso para corregir.",
        snapshot,
        actionOptions: [],
        nextStepType: "idle",
        nextStepField: null,
      });
    }
    const missingForConfirm = getRequiredMissingFields(snapshot.collectedData);
    if (
      snapshot.state !== CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION ||
      snapshot.currentStep !== CHATBOT_CURRENT_STEPS.CONFIRMATION ||
      missingForConfirm.length > 0
    ) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: "Cuando lleguemos al resumen final del reporte vas a poder corregir un dato por texto.",
        snapshot,
        actionOptions: [],
        nextStepType: snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION ? "confirm_incident" : "ask_field",
        nextStepField: snapshot.currentStep || null,
      });
    }

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText:
        "Decime qué dato querés corregir (por ejemplo: descripción, foto o ubicación) y lo volvemos a pedir.",
      snapshot,
      actionOptions: [],
      nextStepType: "confirm_incident",
      nextStepField: null,
    });
  }

  // Reabrir un campo para reingreso (vacía el valor y vuelve a preguntar).
  // No aplicar a set_geo_location: ese comando ya se normaliza a edit_field + location
  // para persistir el texto de ubicación y avanzar de paso (ver merge más abajo).
  if (
    effectiveCommand === "edit_field" &&
    isIncidentFlowActive(snapshot) &&
    commandFromPayload !== "set_geo_location"
  ) {
    const targetStep = mapFieldToStep(effectiveCommandField);
    const targetDefinition = getIncidentFieldDefinition(snapshot.collectedData, targetStep);
    if (!targetDefinition) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: "Ese campo no forma parte del catálogo activo de este procedimiento.",
        snapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }
    const resetCollectedData = {
      ...snapshot.collectedData,
    };
    if (targetDefinition.type === "location") {
      resetCollectedData.location = "";
    }
    if (targetDefinition.type === "image") {
      const draftRef = extractDraftAttachmentRefFromCollectedData(snapshot.collectedData);
      if (draftRef) {
        try {
          const storage = getIncidentAttachmentStorageByProvider(draftRef.storageProvider);
          await storage.deleteDraftAttachment(draftRef);
        } catch (error) {
          console.warn("[assistant] No se pudo eliminar el borrador de foto al reabrir el paso.", {
            message: error?.message,
          });
        }
      }
      resetCollectedData.photoStatus = "not_requested";
      resetCollectedData.photoAttachmentStorageProvider = "";
      resetCollectedData.photoAttachmentStorageKey = "";
      resetCollectedData.photoAttachmentPublicUrl = "";
      resetCollectedData.photoAttachmentSizeBytes = 0;
      resetCollectedData.photoAttachmentOriginalName = "";
      resetCollectedData.photoAttachmentStoredFilename = "";
      resetCollectedData.photoAttachmentMimeType = "";
      resetCollectedData.photoAttachmentUploadedAt = "";
    } else {
      resetCollectedData[targetDefinition.key] = "";
      if (targetDefinition.key === "description") {
        resetCollectedData.description = "";
      }
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

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({
        step: targetStep,
        channel: copyChannel,
        fieldDefinition: targetDefinition,
      }),
      snapshot: updatedSnapshot,
      actionOptions:
        targetDefinition.type === "image"
          ? buildPhotoActionOptions({ canSkip: canSkipImageField(updatedSnapshot.collectedData, targetDefinition.key) })
          : [],
      nextStepType: "ask_field",
      nextStepField: targetStep,
    });
  }

  if (
    (effectiveCommand === "set_photo_pending" || effectiveCommand === "skip_photo") &&
    isIncidentFlowActive(snapshot)
  ) {
    const currentFieldDefinition = getIncidentFieldDefinition(
      snapshot.collectedData,
      snapshot.currentStep
    );
    if (!currentFieldDefinition || currentFieldDefinition.type !== "image") {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: "En este paso no estamos registrando imágenes.",
        snapshot,
        actionOptions: [],
        nextStepType: "ask_field",
        nextStepField: snapshot.currentStep || null,
      });
    }
    if (effectiveCommand === "skip_photo" && !canSkipImageField(snapshot.collectedData, snapshot.currentStep)) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: "La foto es obligatoria para este procedimiento. Por favor adjuntala para continuar.",
        snapshot,
        actionOptions: buildPhotoActionOptions({ canSkip: false }),
        nextStepType: "ask_field",
        nextStepField: snapshot.currentStep || "photo",
      });
    }
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: incidentConfirmationIntro(effectiveLocale, channel, updatedSnapshot.collectedData),
        snapshot: updatedSnapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildQuestionForStep({
        step: nextStep,
        channel: copyChannel,
        fieldDefinition: getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep),
      }),
      snapshot: updatedSnapshot,
      actionOptions:
        getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep)?.type === "image"
          ? buildPhotoActionOptions({
              canSkip: canSkipImageField(updatedSnapshot.collectedData, nextStep),
            })
          : [],
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

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({
          step: nextStep,
          channel: copyChannel,
          fieldDefinition: getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep),
        }),
        snapshot: updatedSnapshot,
        actionOptions:
          getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep)?.type === "image"
            ? buildPhotoActionOptions({
                canSkip: canSkipImageField(updatedSnapshot.collectedData, nextStep),
              })
            : [],
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

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: incidentConfirmationIntro(effectiveLocale, channel, updatedSnapshot.collectedData),
      snapshot: updatedSnapshot,
      actionOptions: [],
      nextStepType: "confirm_incident",
      nextStepField: null,
    });
  }

  if (effectiveCommand === "confirm" && isIncidentFlowActive(snapshot)) {
    if (snapshot.collectedData?.sttCriticalEchoPending === true) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Antes de confirmar el reporte, necesito que valides lo que entendimos del audio (respondé «sí» a esa pregunta).",
        snapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
        needsClarification: false,
      });
    }
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

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({
          step: nextStep,
          channel: copyChannel,
          fieldDefinition: getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep),
        }),
        snapshot: updatedSnapshot,
        actionOptions:
          getIncidentFieldDefinition(updatedSnapshot.collectedData, nextStep)?.type === "image"
            ? buildPhotoActionOptions({
                canSkip: canSkipImageField(updatedSnapshot.collectedData, nextStep),
              })
            : [],
        nextStepType: "ask_field",
        nextStepField: nextStep,
      });
    }

    const portalUserIdForIncident =
      channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null;
    const whatsappWaIdForIncident =
      channel === "whatsapp" ? snapshot.whatsappWaId || null : null;

    if (channel === "web" && !portalUserIdForIncident) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.AUTH_REQUIRED,
        funnelStep: CHATBOT_FUNNEL_STEPS.AUTH_REQUIRED,
        mode: "incident",
        outcome: "auth_required_before_creation",
      });
      return buildAssistantTurnResult({
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

    if (channel === "whatsapp" && !whatsappWaIdForIncident) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "incident",
        outcome: "whatsapp_identity_missing",
        details: "confirm_without_wa_id",
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "No pudimos asociar este chat a un número de WhatsApp para registrar la incidencia. Intentá de nuevo en unos minutos o escribinos desde el inicio del reporte.",
        snapshot,
        actionOptions: [],
        nextStepType: "service_error",
        nextStepField: null,
      });
    }

    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      funnelStep: CHATBOT_FUNNEL_STEPS.CONFIRMED,
      mode: "incident",
      outcome: "user_confirmed",
    });

    try {
      const draft = snapshot.collectedData || {};
      const draftRef =
        draft.photoStatus === "provided" ? extractDraftAttachmentRefFromCollectedData(draft) : null;
      const attachmentFromChatDraft = draftRef
        ? {
            storageProvider: draftRef.storageProvider,
            storageKey: draftRef.storageKey,
            publicUrl: draftRef.publicUrl,
            sizeBytes: draftRef.sizeBytes,
            originalName: draft.photoAttachmentOriginalName || "",
            mimeType: draft.photoAttachmentMimeType || "",
            uploadedAt: draft.photoAttachmentUploadedAt || null,
          }
        : null;
      const incident = await createIncident({
        userId: portalUserIdForIncident,
        whatsappWaId: whatsappWaIdForIncident,
        category: snapshot.collectedData.category || "incidencia_general",
        catalogItemId: snapshot.collectedData.catalogItemId || null,
        description: snapshot.collectedData.description,
        location: snapshot.collectedData.location,
        locationLatitude: snapshot.collectedData.locationLatitude ?? null,
        locationLongitude: snapshot.collectedData.locationLongitude ?? null,
        attachmentFromChatDraft,
      });

      // Orquestación Camunda solo tras persistir la incidencia; fallos de Camunda no revierten el caso local.
      await syncIncidentToCamundaAfterCreate(incident, {
        channel: channel === "whatsapp" ? "whatsapp" : "web",
        authenticatedUser: authenticatedUser || null,
        catalogItemId: snapshot.collectedData.catalogItemId || null,
        catalogCode: snapshot.collectedData.catalogItemCode || null,
      });

      const closedSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: portalUserIdForIncident,
        state: CHATBOT_CONVERSATION_STATES.CLOSED,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
        confirmationState: "none",
        collectedData: { ...EMPTY_COLLECTED_DATA },
        lastInterpretation: {},
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

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildIncidentCreatedReply({ incidentId: incident.id, channel }),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
        redirectTo:
          channel === "whatsapp"
            ? null
            : `/mis-incidencias?incidentId=${encodeURIComponent(incident.id)}`,
        redirectLabel: channel === "whatsapp" ? null : "Ir a Mis incidencias",
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
      return {
        status: 500,
        body: {
          error:
            "Ocurrió un error al crear la incidencia desde el chat. Intenta nuevamente en unos segundos.",
        },
        snapshot: null,
      };
    }
  }

  if (effectiveCommand === "confirm" && isProcedureFlowActive(snapshot)) {
    if (normalizeProcedureCollectedData(snapshot.collectedData || {}).sttCriticalEchoPending === true) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Antes de registrar el trámite, necesito que confirmes lo que entendimos del audio (respondé «sí» a esa pregunta).",
        snapshot,
        actionOptions: buildProcedureActionOptions({ isCompleted: true }),
        nextStepType: "procedure_confirm",
        nextStepField: null,
        needsClarification: false,
      });
    }
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
      return buildAssistantTurnResult({
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
      procedureName: getProcedureDisplayName(activeProcedure, snapshot.collectedData?.procedureName),
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
      return buildAssistantTurnResult({
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

    const portalUserIdForProcedure =
      channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null;
    const whatsappWaIdForProcedure =
      channel === "whatsapp" ? snapshot.whatsappWaId || null : null;

    if (channel === "whatsapp" && !whatsappWaIdForProcedure) {
      await trackEvent({
        eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
        mode: "procedure",
        outcome: "whatsapp_identity_missing",
        details: "confirm_without_wa_id",
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "No pudimos asociar este chat a un número de WhatsApp para registrar el trámite. Intentá de nuevo en unos minutos o iniciá el trámite de nuevo desde el primer mensaje.",
        snapshot,
        actionOptions: [],
        nextStepType: "service_error",
        nextStepField: null,
      });
    }

    let createdProcedureRequest = null;
    if (portalUserIdForProcedure || whatsappWaIdForProcedure) {
      try {
        createdProcedureRequest = await createProcedureRequest({
          userId: portalUserIdForProcedure,
          whatsappWaId: whatsappWaIdForProcedure,
          channel: channel === "whatsapp" ? "WHATSAPP" : "WEB",
          procedureTypeId: activeProcedure.id || null,
          procedureCode: normalizedProcedureData.procedureCode,
          procedureName: normalizedProcedureData.procedureName,
          procedureCategory: normalizedProcedureData.procedureCategory,
          summary: buildProcedureSummaryText({
            procedureName: normalizedProcedureData.procedureName,
            requiredFields: normalizedProcedureData.procedureRequiredFields,
            collectedData: normalizedProcedureData,
          }),
          collectedData: normalizedProcedureData,
          status: PROCEDURE_REQUEST_STATUSES.PENDING_CAMUNDA_SYNC,
        });
        if (createdProcedureRequest) {
          await syncTramiteToCamundaAfterCreate(createdProcedureRequest, {
            channel: channel === "whatsapp" ? "whatsapp" : "web",
            authenticatedUser: authenticatedUser || null,
            procedureCollectedData: normalizedProcedureData,
          });
        }
      } catch (error) {
        await trackEvent({
          eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
          mode: "procedure",
          outcome: "procedure_request_persist_failed",
          details: error?.message || null,
        });
      }
    }

    const closedProcedureSnapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: portalUserIdForProcedure,
      state: CHATBOT_CONVERSATION_STATES.CLOSED,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.CLOSED,
      confirmationState: "confirmed",
      collectedData: normalizedProcedureData,
      lastInterpretation: snapshot.lastInterpretation || {},
      lastIntent: "start_procedure",
      lastAction: "procedure_confirmed",
      lastConfidence: snapshot.lastConfidence || null,
    });
    await trackEvent({
      eventName: CHATBOT_TELEMETRY_EVENTS.CONFIRMATION_READY,
      mode: "procedure",
      outcome: "procedure_confirmed",
      details: activeProcedure.code,
    });
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildProcedureCompletedReply(
        activeProcedure,
        createdProcedureRequest?.requestCode || null,
        channel
      ),
      snapshot: closedProcedureSnapshot,
      actionOptions: [],
      nextStepType: "closed",
      nextStepField: null,
    });
  }

  const whatsappStructuredResult = await handleWhatsAppStructuredIncidentTurn({
    channel,
    sessionId,
    locale: effectiveLocale,
    snapshot,
    normalized: channelInbound,
  });
  if (whatsappStructuredResult) {
    return whatsappStructuredResult;
  }

  const llmInputText =
    channel === "whatsapp" &&
    channelInbound &&
    !(typeof text === "string" && text.trim())
      ? buildLlmSyntheticUserText(channelInbound)
      : typeof text === "string"
        ? text
        : "";

  let interpretation = snapshot.lastInterpretation || {};
  let llmMeta = { source: "fallback", reason: "not_called" };
  if (llmInputText) {
    const llmResult = await interpretUserMessage({
      text: llmInputText,
      locale: effectiveLocale,
      openAiLogContext:
        copyChannel === "whatsapp"
          ? "whatsapp.chat.intent.classification"
          : "web.chat.intent.classification",
      sessionContext: {
        flowKey: snapshot.flowKey,
        currentStep: snapshot.currentStep,
        confirmationState: snapshot.confirmationState,
        collectedData: snapshot.collectedData,
        channel,
        userMessageOrigin:
          channel === "whatsapp" &&
          inboundUserTextSource === "speech_to_text" &&
          inboundOriginalChannelMeta &&
          typeof inboundOriginalChannelMeta === "object"
            ? {
                source: "speech_to_text",
                originalMessageType: inboundOriginalChannelMeta.originalMessageType || "audio",
                whatsappMessageId: inboundOriginalChannelMeta.whatsappMessageId || null,
              }
            : null,
        whatsappInbound:
          channel === "whatsapp" && channelInbound
            ? {
                type: channelInbound.type,
                ...(channelInbound.rawType ? { rawType: channelInbound.rawType } : {}),
              }
            : null,
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

  const hasNoActiveFlow = !isIncidentFlowActive(snapshot) && !isProcedureFlowActive(snapshot);
  let switchToProcedure = shouldSwitchToProcedureFlow({ text, interpretation });
  let switchToIncident = shouldSwitchToIncidentFlow({ text, interpretation });
  let switchToStatus = shouldSwitchToStatusIntent({ text, interpretation });
  const lastAction = normalizeStringField(snapshot?.lastAction, 80).toLowerCase();
  const awaitingProcedureSelectionActions = [
    "list_supported_procedures",
    "restart_procedure_selection",
    "clarify_procedure_selection",
    "invalid_procedure_option_number",
  ];
  const isAwaitingProcedureSelectionState = awaitingProcedureSelectionActions.includes(lastAction);
  const startClassification = resolveConversationStartClassification(interpretation, llmMeta);
  let startReplyText = null;
  let startLastAction = null;
  let startLastIntent = null;
  let startNeedsClarification = false;
  let startResolvedProcedureMatch = null;
  let startActiveProcedures = null;

  if (hasNoActiveFlow && effectiveCommand === "none" && !isAwaitingProcedureSelectionState) {
    switchToProcedure = false;
    switchToIncident = false;
    switchToStatus = false;

    if (!startClassification.reliable) {
      if (procedureOnlyCatalogMode && !switchToStatus) {
        const activeProceduresForStart = await listActiveProcedureCatalog();
        startActiveProcedures = activeProceduresForStart;
        if (activeProceduresForStart.length > 0) {
          const startProcedureSelection = await resolveProcedureCatalogSelection({
            text,
            activeProcedures: activeProceduresForStart,
            interpretation,
          });
          const hasSingleProcedure = activeProceduresForStart.length === 1;
          const hasClearReportSignal = isProcedureOnlyCatalogReportText(text);
          const singleProcedure =
            hasSingleProcedure && activeProceduresForStart[0]
              ? activeProceduresForStart[0]
              : null;
          if (
            startProcedureSelection.status === "matched" ||
            (hasSingleProcedure &&
              isIncidentLikeProcedureCatalogEntry(singleProcedure) &&
              startProcedureSelection.status !== "invalid_number" &&
              hasClearReportSignal)
          ) {
            switchToProcedure = true;
            switchToIncident = false;
            startReplyText = null;
            startLastAction = null;
            startLastIntent = null;
            startNeedsClarification = false;
            startResolvedProcedureMatch =
              startProcedureSelection.procedure || activeProceduresForStart[0];
          }
        }
      }
      if (!switchToProcedure && !switchToIncident && !switchToStatus) {
        startReplyText = buildWelcomeReply();
        startLastAction = "greeting";
        startLastIntent = "greeting_or_start";
      }
    } else if (startClassification.intent === "start_case") {
      if (startClassification.caseKind === "incident" && !procedureOnlyCatalogMode) {
        switchToIncident = true;
      } else {
        switchToProcedure = true;
      }
    } else if (startClassification.intent === "check_status") {
      switchToStatus = true;
    } else if (startClassification.intent === "greeting_or_start") {
      startReplyText =
        lastAction === "greeting" || lastAction === "clarify_intent"
          ? buildRepeatedGreetingReply()
          : buildGreetingReply();
      startLastAction = "greeting";
      startLastIntent = "greeting_or_start";
    } else if (startClassification.intent === "unsupported") {
      startReplyText = buildIntentClarificationReply();
      startLastAction = "unsupported_start";
      startLastIntent = "unsupported";
      startNeedsClarification = true;
    } else {
      startReplyText = buildIntentClarificationReply();
      startLastAction = "clarify_intent";
      startLastIntent = "ambiguous";
      startNeedsClarification = true;
    }

    if (isPoliteThanksMessageAtStart(text)) {
      startReplyText = buildThanksAtStartReply();
      startLastAction = "greeting";
      startLastIntent = "greeting_or_start";
      startNeedsClarification = false;
    }

    if (
      procedureOnlyCatalogMode &&
      !switchToStatus &&
      isProcedureOnlyCatalogReportText(text)
    ) {
      switchToProcedure = true;
      switchToIncident = false;
      startReplyText = null;
      startLastAction = null;
      startLastIntent = null;
      startNeedsClarification = false;
    }
  } else {
    if (procedureOnlyCatalogMode && switchToIncident) {
      switchToProcedure = true;
      switchToIncident = false;
    }
    if (
      procedureOnlyCatalogMode &&
      !switchToStatus &&
      effectiveCommand === "none" &&
      isProcedureOnlyCatalogReportText(text)
    ) {
      switchToProcedure = true;
      switchToIncident = false;
    }
  }

  const awaitingProcedureSelection =
    !isIncidentFlowActive(snapshot) &&
    !isProcedureFlowActive(snapshot) &&
    awaitingProcedureSelectionActions.includes(lastAction);
  const numericIntentSelection = parseOptionNumberFromText(text);
  if (
    hasNoActiveFlow &&
    ["greeting", "clarify_intent", "unsupported_start"].includes(lastAction) &&
    numericIntentSelection
  ) {
    if (numericIntentSelection === 1) {
      switchToProcedure = true;
      switchToIncident = false;
      switchToStatus = false;
      startReplyText = null;
      startLastAction = null;
      startLastIntent = null;
      startNeedsClarification = false;
    } else if (numericIntentSelection === 2) {
      switchToProcedure = false;
      switchToIncident = false;
      switchToStatus = true;
      startReplyText = null;
      startLastAction = null;
      startLastIntent = null;
      startNeedsClarification = false;
    }
  }
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
          startIntent: startClassification.intent,
          startConfidence: startClassification.confidence,
          startReliable: startClassification.reliable,
          startCaseKind: startClassification.caseKind,
          switchToProcedure,
          switchToIncident,
          switchToStatus,
        },
      })
    );
  }

  if (hasNoActiveFlow && effectiveCommand === "none" && startReplyText && !switchToProcedure && !switchToIncident && !switchToStatus) {
    const greetingSnapshot = await setConversationState(sessionId, {
      locale: effectiveLocale,
      userId: channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null,
      state: CHATBOT_CONVERSATION_STATES.IDLE,
      flowKey: null,
      currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
      confirmationState: "none",
      collectedData: { ...EMPTY_COLLECTED_DATA },
      lastInterpretation: interpretation,
      lastIntent: startLastIntent || interpretation?.intent?.kind || "small_talk",
      lastAction: startLastAction || "greeting",
      lastConfidence: startClassification.confidence || interpretation?.intent?.confidence || null,
    });
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: startReplyText,
      snapshot: greetingSnapshot,
      actionOptions: [],
      nextStepType: "clarify",
      nextStepField: null,
      needsClarification: startNeedsClarification,
    });
  }

  const statusIdentifierFromText = extractStatusIdentifierFromText(text);
  const statusFlowActive = snapshot?.lastIntent === "check_status";
  const isStatusFollowUp =
    statusFlowActive &&
    effectiveCommand === "none" &&
    (
      isStatusContinuationAcknowledgement(text) ||
      isStatusCasesListRequest(text) ||
      Boolean(statusIdentifierFromText)
    );
  if (
    (switchToStatus || isStatusFollowUp) &&
    !isIncidentFlowActive(snapshot) &&
    !isProcedureFlowActive(snapshot)
  ) {
    const statusIdentifier = statusIdentifierFromText;
    const portalUserIdForStatus =
      channel === "web" ? authenticatedUser?.id || snapshot.userId || null : null;
    const whatsappWaIdForStatus =
      channel === "whatsapp" ? snapshot.whatsappWaId || null : null;
    const canLookupStatusByIdentifier =
      Boolean(statusIdentifier) &&
      ((channel === "web" && portalUserIdForStatus) ||
        (channel === "whatsapp" && whatsappWaIdForStatus));

    if (canLookupStatusByIdentifier) {
      const statusSummaryEntry = await resolveStatusSummaryByIdentifier({
        userId: portalUserIdForStatus,
        whatsappWaId: whatsappWaIdForStatus,
        identifier: statusIdentifier,
      });
      if (statusSummaryEntry) {
        const statusLookupSnapshot = await setConversationState(sessionId, {
          locale: effectiveLocale,
          userId: portalUserIdForStatus,
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
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText: buildStatusSummaryReply(statusSummaryEntry),
          snapshot: statusLookupSnapshot,
          actionOptions: buildStatusResultActionOptions({
            isIncident: statusSummaryEntry.kind === "incident",
          }),
          nextStepType: "check_status",
          nextStepField: "identifier",
          redirectTo: channel === "whatsapp" ? null : "/mis-incidencias",
          redirectLabel: channel === "whatsapp" ? null : "Ver mis incidencias",
          statusSummary: statusSummaryEntry,
          needsClarification: false,
        });
      }
      const statusNotFoundSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: portalUserIdForStatus,
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildStatusNotFoundReply(statusIdentifier),
        snapshot: statusNotFoundSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: channel === "whatsapp" ? null : "/mis-incidencias",
        redirectLabel: channel === "whatsapp" ? null : "Ver mis incidencias",
        needsClarification: false,
      });
    }

    if (
      statusIdentifier &&
      channel === "web" &&
      !portalUserIdForStatus &&
      !isStatusCasesListRequest(text)
    ) {
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
      return buildAssistantTurnResult({
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
      statusIdentifier &&
      channel === "whatsapp" &&
      !whatsappWaIdForStatus &&
      !isStatusCasesListRequest(text)
    ) {
      const statusWaSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: null,
        state: CHATBOT_CONVERSATION_STATES.IDLE,
        flowKey: null,
        currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: "none",
        collectedData: snapshot.collectedData || EMPTY_COLLECTED_DATA,
        lastInterpretation: interpretation,
        lastIntent: "check_status",
        lastAction: "status_lookup_whatsapp_identity_missing",
        lastConfidence: interpretation?.intent?.confidence || snapshot.lastConfidence || null,
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "No pude asociar este chat a un número de WhatsApp para buscar ese identificador. Intentá de nuevo en unos minutos.",
        snapshot: statusWaSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: null,
        redirectLabel: null,
        needsClarification: false,
      });
    }

    if (
      statusFlowActive &&
      effectiveCommand === "none" &&
      isStatusContinuationAcknowledgement(text) &&
      ((channel === "web" && portalUserIdForStatus) ||
        (channel === "whatsapp" && whatsappWaIdForStatus))
    ) {
      const statusPromptSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: portalUserIdForStatus,
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildStatusReply({ identifierRequested: true, channel }),
        snapshot: statusPromptSnapshot,
        actionOptions: buildStatusActionOptions(),
        nextStepType: "check_status",
        nextStepField: "identifier",
        redirectTo: channel === "whatsapp" ? null : "/mis-incidencias",
        redirectLabel: channel === "whatsapp" ? null : "Ver mis incidencias",
        needsClarification: false,
      });
    }

    if (statusFlowActive && effectiveCommand === "none" && isStatusCasesListRequest(text)) {
      const statusCasesSnapshot = await setConversationState(sessionId, {
        locale: effectiveLocale,
        userId: portalUserIdForStatus,
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
      if (channel === "whatsapp") {
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText:
            "Desde WhatsApp no tengo una lista automática de todos tus casos. Si tenés el código de uno (por ejemplo INC-… o TRA-…), enviámelo y te resumo el estado acá.",
          snapshot: statusCasesSnapshot,
          actionOptions: buildStatusActionOptions(),
          nextStepType: "check_status",
          nextStepField: "identifier",
          redirectTo: null,
          redirectLabel: null,
          needsClarification: false,
        });
      }
      return buildAssistantTurnResult({
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
      userId: portalUserIdForStatus,
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

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildStatusReply({ channel }),
      snapshot: statusSnapshot,
      actionOptions: buildStatusActionOptions(),
      nextStepType: "check_status",
      nextStepField: "identifier",
      redirectTo: channel === "whatsapp" ? null : "/mis-incidencias",
      redirectLabel: channel === "whatsapp" ? null : "Ver mis incidencias",
      needsClarification: false,
    });
  }

  if (
    !procedureOnlyCatalogMode &&
    switchToIncident &&
    !isIncidentFlowActive(snapshot) &&
    !isProcedureFlowActive(snapshot)
  ) {
    const seedData = {
      ...EMPTY_COLLECTED_DATA,
      category: "incidencia_general",
      subcategory: "reporte_general",
      incidentRequiredFields: [...DEFAULT_INCIDENT_REQUIRED_FIELDS],
    };
    const mergedFromIntent = mergeCollectedDataFromInterpretation({
      collectedData: seedData,
      interpretation,
      text: "",
      currentStep: getNextIncidentFlowStep(seedData),
    });
    const mergedWithCatalog = await enrichIncidentDataWithCatalog({
      collectedData: mergedFromIntent.collectedData,
      text,
      interpretation,
    });
    const nextStep = getNextIncidentFlowStep(mergedWithCatalog);
    const nextState =
      nextStep === CHATBOT_CURRENT_STEPS.CONFIRMATION
        ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
        : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
    const savedSnapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: mergedWithCatalog,
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: incidentConfirmationIntro(effectiveLocale, channel, savedSnapshot.collectedData),
        snapshot: savedSnapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }

    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText:
        nextStep === CHATBOT_CURRENT_STEPS.DESCRIPTION
          ? buildIncidentStartReply()
          : buildQuestionForStep({
              step: nextStep,
              channel: copyChannel,
              fieldDefinition: getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep),
            }),
      snapshot: savedSnapshot,
      actionOptions:
        getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep)?.type === "image"
          ? buildPhotoActionOptions({
              canSkip: canSkipImageField(savedSnapshot.collectedData, nextStep),
            })
          : [],
      nextStepType: "ask_field",
      nextStepField: nextStep,
      needsClarification: false,
    });
  }

  if (
    (switchToProcedure || awaitingProcedureSelection) &&
    !isProcedureFlowActive(snapshot) &&
    !isIncidentFlowActive(snapshot)
  ) {
    const activeProcedures = startActiveProcedures || (await listActiveProcedureCatalog());
    const canListSupportedProcedures = activeProcedures.length > 0;
    const hasSpecificProcedureRequest =
      hasProcedureSpecificSignals(text) || awaitingProcedureSelection;

    if (!canListSupportedProcedures) {
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
        lastAction: "no_active_procedures",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildNoActiveProceduresReply(),
        snapshot: idleSnapshot,
        actionOptions: [],
        nextStepType: "clarify_procedure",
        nextStepField: "procedureName",
        needsClarification: true,
      });
    }

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

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureCatalogIntroReply(activeProcedures),
        snapshot: idleSnapshot,
        actionOptions: [],
        nextStepType: "clarify_procedure",
        nextStepField: "procedureName",
        needsClarification: false,
      });
    }

    const procedureSelection =
      startResolvedProcedureMatch && !awaitingProcedureSelection
        ? { status: "matched", procedure: startResolvedProcedureMatch }
        : await resolveProcedureCatalogSelection({
            text,
            activeProcedures,
            interpretation,
          });
    let procedureMatch = procedureSelection.procedure;
    if (
      !procedureMatch &&
      activeProcedures.length === 1 &&
      isIncidentLikeProcedureCatalogEntry(activeProcedures[0]) &&
      procedureSelection.status !== "invalid_number" &&
      (isProcedureOnlyCatalogReportText(text) || switchToProcedure)
    ) {
      procedureMatch = activeProcedures[0];
    }
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
            procedureSelectionStatus: procedureSelection.status,
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
        lastAction:
          procedureSelection.status === "invalid_number"
            ? "invalid_procedure_option_number"
            : "clarify_procedure_selection",
        lastConfidence: interpretation?.intent?.confidence || null,
      });
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          procedureSelection.status === "invalid_number"
            ? `${buildInvalidProcedureOptionNumberReply()}\n\n${buildProcedureCatalogIntroReply(activeProcedures)}`
            : buildProcedureCatalogDisambiguationReply(activeProcedures),
        snapshot: idleSnapshot,
        actionOptions: [],
        nextStepType: "clarify_procedure",
        nextStepField: "procedureName",
        needsClarification: true,
      });
    }

    const collectedData = normalizeProcedureCollectedData({
      ...EMPTY_COLLECTED_DATA,
      procedureCode: procedureMatch.code,
      procedureName: getProcedureDisplayName(procedureMatch),
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureDraftConfirmationText({
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
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: `${buildProcedureStartReply(collectedData.procedureName)} ${buildProcedureFieldPrompt(fieldDefinition, collectedData.procedureName)}`
        .replace(/\s+/g, " ")
        .trim(),
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
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText: buildProcedureCatalogIntroReply(activeProcedures),
          snapshot: resetSnapshot,
          actionOptions: [],
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildNoActiveProceduresReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }

    const procedureSwitchToIncident =
      !procedureOnlyCatalogMode &&
      (shouldSwitchToIncidentFlow({ text, interpretation }) ||
        shouldActivateIncidentFlow({
          interpretation,
          text,
          contextEntry,
        }));
    if (procedureSwitchToIncident) {
      const incidentSeed = {
        ...EMPTY_COLLECTED_DATA,
        category: "incidencia_general",
        subcategory: "reporte_general",
        incidentRequiredFields: [...DEFAULT_INCIDENT_REQUIRED_FIELDS],
      };
      const mergedFromSwitch = mergeCollectedDataFromInterpretation({
        collectedData: incidentSeed,
        interpretation,
        text: "",
        currentStep: getNextIncidentFlowStep(incidentSeed),
      });
      const mergedSwitchWithCatalog = await enrichIncidentDataWithCatalog({
        collectedData: mergedFromSwitch.collectedData,
        text,
        interpretation,
      });
      const nextIncidentStep = getNextIncidentFlowStep(mergedSwitchWithCatalog);
      const switchedSnapshot = await setConversationState(
        sessionId,
        createIncidentFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: mergedSwitchWithCatalog,
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
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText: incidentConfirmationIntro(effectiveLocale, channel, switchedSnapshot.collectedData),
          snapshot: switchedSnapshot,
          actionOptions: [],
          nextStepType: "confirm_incident",
          nextStepField: null,
        });
      }

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildQuestionForStep({
          step: nextIncidentStep,
          channel: copyChannel,
          fieldDefinition: getIncidentFieldDefinition(switchedSnapshot.collectedData, nextIncidentStep),
        }),
        snapshot: switchedSnapshot,
        actionOptions:
          getIncidentFieldDefinition(switchedSnapshot.collectedData, nextIncidentStep)?.type === "image"
            ? buildPhotoActionOptions({
                canSkip: canSkipImageField(switchedSnapshot.collectedData, nextIncidentStep),
              })
            : [],
        nextStepType: "ask_field",
        nextStepField: nextIncidentStep,
      });
    }

    const procedureConfirmGateData = normalizeProcedureCollectedData(snapshot.collectedData || {});
    if (
      effectiveCommand === "request_text_correction" &&
      getProcedureMissingFields(procedureConfirmGateData).length === 0 &&
      snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
      snapshot.confirmationState === "ready"
    ) {
      const targetField = resolveProcedureFieldFromCorrectionText(
        procedureConfirmGateData.procedureRequiredFields,
        effectiveCommandField,
        text || ""
      );
      if (!targetField) {
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText:
            "Decime qué dato querés corregir usando el nombre del campo del resumen y lo volvemos a pedir.",
          snapshot,
          actionOptions: [],
          nextStepType: "procedure_confirm",
          nextStepField: null,
          needsClarification: false,
        });
      }
      const targetDefinition = getProcedureFieldDefinition(
        procedureConfirmGateData.procedureRequiredFields,
        targetField
      );
      const reopenedCollectedData = {
        ...procedureConfirmGateData,
        [targetField]: "",
      };
      const reopenedSnapshot = await setConversationState(
        sessionId,
        createProcedureFlowSnapshotPatch({
          locale: effectiveLocale,
          userId: authenticatedUser?.id || snapshot.userId || null,
          collectedData: reopenedCollectedData,
          currentStep: mapProcedureFieldToStep(targetField),
          confirmationState: "none",
          lastInterpretation: interpretation,
          lastIntent: "start_procedure",
          lastAction: "edit_field",
          lastConfidence: interpretation?.intent?.confidence || null,
          state: CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE,
        })
      );
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureFieldPrompt(targetDefinition),
        snapshot: reopenedSnapshot,
        actionOptions: [],
        nextStepType: "ask_field",
        nextStepField: targetField,
        needsClarification: false,
      });
    }

    if (
      getProcedureMissingFields(procedureConfirmGateData).length === 0 &&
      snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
      snapshot.confirmationState === "ready" &&
      effectiveCommand === "none" &&
      typeof text === "string" &&
      normalizeProcedureText(text) &&
      !matchesAffirmativeConfirmationText(text)
    ) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          "Respondé sí para confirmar, no para cancelar, o escribí qué dato querés corregir.",
        snapshot,
        actionOptions: buildProcedureActionOptions({ isCompleted: true }),
        nextStepType: "procedure_confirm",
        nextStepField: null,
        needsClarification: false,
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
      return buildAssistantTurnResult({
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
      procedureName: getProcedureDisplayName(activeProcedure, snapshot.collectedData?.procedureName),
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

    const sttProcedureEcho = assessSttCriticalProcedureTurn({
      procedureData,
      normalizedText,
    });
    const needsSttProcedureEcho =
      procedureMissing.length === 0 &&
      channel === "whatsapp" &&
      inboundUserTextSource === "speech_to_text" &&
      sttProcedureEcho.requiresEcho;

    const procedureCollectedPatch =
      procedureMissing.length > 0
        ? procedureData
        : { ...procedureData, sttCriticalEchoPending: needsSttProcedureEcho };

    const updatedProcedureSnapshot = await setConversationState(
      sessionId,
      createProcedureFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: procedureCollectedPatch,
        currentStep: procedureStep,
        confirmationState:
          procedureMissing.length > 0 ? "none" : needsSttProcedureEcho ? "none" : "ready",
        lastInterpretation: interpretation,
        lastIntent: "start_procedure",
        lastAction: effectiveCommand === "none" ? "message" : effectiveCommand,
        lastConfidence: interpretation?.intent?.confidence || null,
        state:
          procedureMissing.length > 0
            ? CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE
            : CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION,
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
      const replyText = needsSttProcedureEcho
        ? formatSttCriticalEchoUserReply(sttProcedureEcho.echoLines, {
            transcriptPreview: normalizedText.trim().slice(0, 120),
          })
        : hasProcedureUpdate
          ? buildProcedureDraftConfirmationText({
              procedureName: procedureData.procedureName,
              requiredFields: procedureData.procedureRequiredFields,
              collectedData: procedureData,
            })
          : `Ya tengo los datos de "${procedureData.procedureName || "este trámite"}". Respondé sí para confirmar, no para cancelar, o escribí qué dato querés corregir.`;
      return buildAssistantTurnResult({
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
      : buildProcedureFieldPrompt(nextFieldDefinition, procedureData.procedureName);
    return buildAssistantTurnResult({
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
          lastAction: "clarify_procedure_selection",
          lastConfidence: interpretation?.intent?.confidence || null,
        });
        return buildAssistantTurnResult({
          sessionId,
          locale: effectiveLocale,
          replyText: buildProcedureCatalogDisambiguationReply(activeProcedures),
          snapshot: resetSnapshot,
          actionOptions: [],
          nextStepType: "clarify_procedure",
          nextStepField: "procedureName",
          needsClarification: true,
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildNoActiveProceduresReply(),
        snapshot: closedSnapshot,
        actionOptions: [],
        nextStepType: "closed",
        nextStepField: null,
      });
    }
    const collectedData = normalizeProcedureCollectedData({
      ...EMPTY_COLLECTED_DATA,
      procedureCode: procedureMatch.code,
      procedureName: getProcedureDisplayName(procedureMatch),
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
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: buildProcedureDraftConfirmationText({
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
    return buildAssistantTurnResult({
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

  if (!isIncidentFlowActive(snapshot) && !isProcedureFlowActive(snapshot)) {
    const shouldActivate = procedureOnlyCatalogMode
      ? false
      : shouldActivateIncidentFlow({
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
        lastAction: "clarify_intent",
        lastConfidence: interpretation?.intent?.confidence || null,
      });

      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText:
          buildIntentClarificationReply(),
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
      ? buildIncidentFlowSeedFromContext(contextEntry)
      : {
          ...EMPTY_COLLECTED_DATA,
          category: "incidencia_general",
          subcategory: "reporte_general",
        };
    const seedWithCatalog = await enrichIncidentDataWithCatalog({
      collectedData: seedData,
      text,
      interpretation,
    });
    snapshot = await setConversationState(
      sessionId,
      createIncidentFlowSnapshotPatch({
        locale: effectiveLocale,
        userId: authenticatedUser?.id || snapshot.userId || null,
        collectedData: seedWithCatalog,
        currentStep: getNextIncidentFlowStep(seedWithCatalog),
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

  // En confirmación de incidencia, evitar re-mostrar el mismo resumen en bucle si el texto no aporta datos ni es confirmación.
  if (
    isIncidentFlowActive(snapshot) &&
    snapshot.currentStep === CHATBOT_CURRENT_STEPS.CONFIRMATION &&
    getRequiredMissingFields(snapshot.collectedData).length === 0 &&
    effectiveCommand === "none" &&
    typeof text === "string" &&
    normalizeStringField(text) &&
    !matchesAffirmativeConfirmationText(text)
  ) {
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: buildIncidentConfirmationGateReply(copyChannel),
      snapshot,
      actionOptions: [],
      nextStepType: "confirm_incident",
      nextStepField: null,
      needsClarification: false,
    });
  }

  const mergedResult = mergeCollectedDataFromInterpretation({
    collectedData: snapshot.collectedData,
    interpretation,
    text,
    currentStep: snapshot.currentStep,
  });
  if (
    (effectiveCommand === "edit_field" || effectiveCommand === "set_geo_location") &&
    effectiveCommandField
  ) {
    const normalizedField = normalizeStringField(effectiveCommandField, 60).toLowerCase();
    if (normalizedField) {
      mergedResult.collectedData[normalizedField] = text;
      if (normalizedField === "location") {
        mergedResult.collectedData.location = text;
      } else if (normalizedField === "description") {
        mergedResult.collectedData.description = text;
      }
    }
  }
  const mergedData = mergedResult.collectedData;
  const mergedDataWithCatalog = await enrichIncidentDataWithCatalog({
    collectedData: mergedData,
    text,
    interpretation,
  });
  const nextStep = getNextIncidentFlowStep(mergedDataWithCatalog);
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
    if (channel === "whatsapp") {
      console.info("[whatsapp] entity rejected for current step", {
        currentStep: snapshot.currentStep,
        rejected: mergedResult.rejectedEntities,
      });
    }
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

  const sttEchoAssessment = assessSttCriticalIncidentTurn({
    inboundUserTextSource,
    channel,
    text,
    acceptedEntities: mergedResult.acceptedEntities,
    mergedData: mergedDataWithCatalog,
  });
  const nextSttEchoPending =
    isReadyForConfirmation &&
    channel === "whatsapp" &&
    inboundUserTextSource === "speech_to_text" &&
    sttEchoAssessment.requiresEcho;

  const finalIncidentCollected = {
    ...mergedDataWithCatalog,
    sttCriticalEchoPending: nextSttEchoPending,
  };

  const nextState = isReadyForConfirmation
    ? CHATBOT_CONVERSATION_STATES.AWAITING_CONFIRMATION
    : CHATBOT_CONVERSATION_STATES.FLOW_ACTIVE;
  const confirmationState = isReadyForConfirmation && !nextSttEchoPending ? "ready" : "none";

  const savedSnapshot = await setConversationState(
    sessionId,
    createIncidentFlowSnapshotPatch({
      locale: effectiveLocale,
      userId: authenticatedUser?.id || snapshot.userId || null,
      collectedData: finalIncidentCollected,
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
      outcome: nextSttEchoPending ? "stt_critical_echo_required" : "ready_after_data_capture",
    });
    if (nextSttEchoPending) {
      return buildAssistantTurnResult({
        sessionId,
        locale: effectiveLocale,
        replyText: formatSttCriticalEchoUserReply(sttEchoAssessment.echoLines, {
          transcriptPreview: typeof text === "string" ? text.trim().slice(0, 120) : "",
        }),
        snapshot: savedSnapshot,
        actionOptions: [],
        nextStepType: "confirm_incident",
        nextStepField: null,
      });
    }
    return buildAssistantTurnResult({
      sessionId,
      locale: effectiveLocale,
      replyText: incidentConfirmationIntro(effectiveLocale, channel, savedSnapshot.collectedData),
      snapshot: savedSnapshot,
      actionOptions: [],
      nextStepType: "confirm_incident",
      nextStepField: null,
    });
  }

  let replyText = buildQuestionForStep({
    step: nextStep,
    lowConfidence: currentStepHasLowConfidence,
    channel: copyChannel,
    fieldDefinition: getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep),
  });
  if (channel === "whatsapp") {
    const ackParts = [];
    if (mergedResult.acceptedEntities.includes("description")) {
      ackParts.push(`Descripción registrada: ${mergedDataWithCatalog.description}.`);
    }
    if (mergedResult.acceptedEntities.includes("location")) {
      ackParts.push(`Ubicación registrada: ${mergedDataWithCatalog.location}.`);
    }
    if (mergedResult.acceptedEntities.includes("photo")) {
      const ps = mergedDataWithCatalog.photoStatus;
      if (ps === "skipped") {
        ackParts.push("Quedó registrado que no adjuntás foto en este reporte.");
      } else if (ps === "pending_upload") {
        ackParts.push("Indicaste que querés adjuntar foto: enviá la imagen en el siguiente mensaje.");
      }
    }
    if (ackParts.length) {
      replyText = `${ackParts.join("\n")}\n\n${replyText}`;
    }
  }

  return buildAssistantTurnResult({
    sessionId,
    locale: effectiveLocale,
    replyText,
    snapshot: savedSnapshot,
    actionOptions:
      getIncidentFieldDefinition(savedSnapshot.collectedData, nextStep)?.type === "image"
        ? buildPhotoActionOptions({
            canSkip: canSkipImageField(savedSnapshot.collectedData, nextStep),
          })
        : [],
    nextStepType: "ask_field",
    nextStepField: nextStep,
    needsClarification: currentStepHasLowConfidence,
  });
}

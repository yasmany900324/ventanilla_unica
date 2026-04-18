const INCIDENT_CATEGORIES = [
  "alumbrado",
  "limpieza",
  "seguridad",
  "infraestructura",
  "otro",
];

const CATEGORY_MARKERS = {
  alumbrado: [
    "alumbrado",
    "luz",
    "luces",
    "luminaria",
    "farol",
    "poste",
    "iluminacion",
    "iluminacao",
    "lighting",
    "light",
    "foco",
    "lampara",
    "lampara",
  ],
  limpieza: [
    "limpieza",
    "residuo",
    "residuos",
    "basura",
    "contenedor",
    "suciedad",
    "higiene",
    "lixo",
    "coleta",
    "waste",
    "garbage",
  ],
  seguridad: [
    "seguridad",
    "policia",
    "policia",
    "robo",
    "violencia",
    "riesgo",
    "inseguridad",
    "security",
    "crime",
    "accidente",
    "emergencia",
  ],
  infraestructura: [
    "infraestructura",
    "bache",
    "vereda",
    "calzada",
    "calle",
    "ruta",
    "senda",
    "puente",
    "obra",
    "drain",
    "drenaje",
    "alcantarilla",
    "pavimento",
  ],
  otro: ["otro", "other", "diverso", "general"],
};

const FIELD_MAX_LENGTH = 320;
const GENERIC_INCIDENT_MESSAGES = new Set([
  "quiero reportar un problema",
  "quiero crear una incidencia",
  "necesito reportar una incidencia",
  "i want to report a problem",
  "quero reportar um problema",
]);
const LOCATION_PATTERNS = [
  /\b(?:en|ubicacion|direccion|address|at|em)\s+([a-z0-9a-z\s#.,\-]{5,90})/i,
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

function normalizeFieldText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, FIELD_MAX_LENGTH);
}

function sanitizeLocationCandidate(value) {
  const normalized = normalizeFieldText(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/\s*(?:por favor|please|obrigado|gracias)\s*$/i, "")
    .trim();
}

function readFirstString(parameters, keys) {
  if (!parameters || typeof parameters !== "object") {
    return "";
  }

  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function inferCategoryFromLookup(lookupText) {
  if (!lookupText) {
    return "";
  }

  for (const category of INCIDENT_CATEGORIES) {
    const markers = CATEGORY_MARKERS[category] || [];
    if (markers.some((marker) => lookupText.includes(marker))) {
      return category;
    }
  }

  return "";
}

export function normalizeIncidentCategory(value) {
  const normalized = normalizeForLookup(value);
  if (!normalized) {
    return "";
  }

  if (INCIDENT_CATEGORIES.includes(normalized)) {
    return normalized;
  }

  return inferCategoryFromLookup(normalized);
}

export function inferIncidentCategoryFromText(text) {
  return inferCategoryFromLookup(normalizeForLookup(text));
}

export function normalizeIncidentDraft(draft) {
  if (!draft || typeof draft !== "object") {
    return {
      category: "",
      description: "",
      location: "",
    };
  }

  return {
    category: normalizeIncidentCategory(draft.category),
    description: normalizeFieldText(draft.description),
    location: normalizeFieldText(draft.location),
  };
}

export function extractIncidentDraftFromParameters(parameters) {
  const categoryCandidate = readFirstString(parameters, [
    "category",
    "categoria",
    "rubro",
    "type",
    "issue_type",
    "service_type",
  ]);
  const descriptionCandidate = readFirstString(parameters, [
    "description",
    "descripcion",
    "detalle",
    "problem_description",
    "issue_description",
    "summary",
  ]);
  const locationCandidate = readFirstString(parameters, [
    "location",
    "ubicacion",
    "direccion",
    "address",
    "zone",
    "barrio",
  ]);

  return normalizeIncidentDraft({
    category: normalizeIncidentCategory(categoryCandidate),
    description: descriptionCandidate,
    location: locationCandidate,
  });
}

export function mergeIncidentDraft(baseDraft, incomingDraft) {
  const normalizedBase = normalizeIncidentDraft(baseDraft);
  const normalizedIncoming = normalizeIncidentDraft(incomingDraft);

  return {
    category: normalizedIncoming.category || normalizedBase.category,
    description: normalizedIncoming.description || normalizedBase.description,
    location: normalizedIncoming.location || normalizedBase.location,
  };
}

export function computeMissingIncidentFields(draft) {
  const normalizedDraft = normalizeIncidentDraft(draft);
  const missing = [];

  if (!normalizedDraft.category) {
    missing.push("category");
  }
  if (!normalizedDraft.description) {
    missing.push("description");
  }
  if (!normalizedDraft.location) {
    missing.push("location");
  }

  return missing;
}

export function isIncidentDraftComplete(draft) {
  return computeMissingIncidentFields(draft).length === 0;
}

export function getNextMissingIncidentField(draft) {
  return computeMissingIncidentFields(draft)[0] || null;
}

export function getIncidentCategoryOptions() {
  return [...INCIDENT_CATEGORIES];
}

function inferLocationFromText(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return sanitizeLocationCandidate(match[1]);
    }
  }

  return "";
}

function inferDescriptionFromText(text) {
  const normalized = normalizeFieldText(text);
  if (!normalized) {
    return "";
  }

  const normalizedLookup = normalizeForLookup(normalized);
  if (GENERIC_INCIDENT_MESSAGES.has(normalizedLookup)) {
    return "";
  }

  if (normalized.length < 12) {
    return "";
  }

  return normalized;
}

export function extractIncidentDraftFromText(text) {
  const normalizedText = normalizeFieldText(text);
  if (!normalizedText) {
    return normalizeIncidentDraft({});
  }

  return normalizeIncidentDraft({
    category: inferIncidentCategoryFromText(normalizedText),
    description: inferDescriptionFromText(normalizedText),
    location: inferLocationFromText(normalizedText),
  });
}

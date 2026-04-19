import { randomUUID } from "crypto";
import { ensureDatabase, hasDatabase } from "./db";

const LOOKUP_STOP_WORDS = new Set([
  "quiero",
  "necesito",
  "hacer",
  "iniciar",
  "tramite",
  "trámite",
  "gestionar",
  "realizar",
  "un",
  "una",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "mi",
  "por",
  "para",
  "ver",
  "buscar",
  "describir",
  "que",
]);

const AUXILIARY_PROCEDURE_PHRASES = new Set([
  "quiero buscar un tramite especifico",
  "quiero ver categorias de tramites disponibles",
  "te describo lo que necesito gestionar",
  "quiero consultar el estado de un tramite",
  "quiero iniciar un tramite",
  "necesito hacer un tramite",
  "necesito realizar una gestion",
  "quiero realizar una gestion",
  "iniciar tramite",
  "iniciar un tramite",
  "hacer un tramite",
  "tramite",
  "trámite",
]);

const SUPPORTED_FIELD_TYPES = new Set(["text", "email", "number", "select", "id"]);

const DEFAULT_PROCEDURE_CATALOG = [
  {
    code: "habilitacion_comercial",
    name: "Habilitación comercial",
    description: "Inicio de habilitación para comercios y actividades empresariales.",
    category: "comercio",
    aliases: [
      "sacar habilitación comercial",
      "habilitacion de comercio",
      "permiso comercial",
      "registro de empresa",
      "habilitacion para negocio",
    ],
    keywords: ["habilitacion", "comercial", "empresa", "comercio", "negocio"],
    requiredFields: [
      {
        key: "nombre_comercio",
        label: "nombre del comercio",
        prompt:
          "Para iniciar la habilitación comercial, indícame el nombre del comercio o emprendimiento.",
        type: "text",
        required: true,
        validation: { minLength: 3, maxLength: 120 },
      },
      {
        key: "rubro_actividad",
        label: "rubro o actividad",
        prompt: "Indícame el rubro o actividad principal del comercio.",
        type: "text",
        required: true,
        validation: { minLength: 3, maxLength: 120 },
      },
      {
        key: "direccion_local",
        label: "dirección del local",
        prompt: "Indícame la dirección del local donde funcionará el comercio.",
        type: "text",
        required: true,
        validation: { minLength: 5, maxLength: 160 },
      },
    ],
    flowDefinition: {
      completionMessage:
        "Quedó registrada la información inicial de tu habilitación comercial. El siguiente paso es revisar requisitos y canal de presentación.",
    },
  },
  {
    code: "permiso_construccion",
    name: "Permiso de construcción",
    description: "Inicio de trámite para obras en propiedad privada.",
    category: "obras",
    aliases: [
      "permiso de obra",
      "habilitacion de obra",
      "tramite de construccion",
      "permiso para construir",
    ],
    keywords: ["permiso", "construccion", "obra", "edificacion", "arquitectura"],
    requiredFields: [
      {
        key: "padron_inmueble",
        label: "padrón del inmueble",
        prompt: "Indícame el número de padrón del inmueble.",
        type: "text",
        required: true,
        validation: { minLength: 3, maxLength: 80 },
      },
      {
        key: "ubicacion_obra",
        label: "ubicación de la obra",
        prompt: "Indícame la ubicación o dirección donde se realizará la obra.",
        type: "text",
        required: true,
        validation: { minLength: 5, maxLength: 160 },
      },
      {
        key: "tipo_obra",
        label: "tipo de obra",
        prompt: "Describe brevemente qué tipo de obra deseas realizar.",
        type: "text",
        required: true,
        validation: { minLength: 8, maxLength: 220 },
      },
    ],
    flowDefinition: {
      completionMessage:
        "Ya tengo los datos base para el permiso de construcción. El siguiente paso es validar requisitos técnicos de la obra.",
    },
  },
];

function normalizeLookup(value) {
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

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeArray(value, maxLengthPerItem = 120) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const normalized = normalizeText(item, maxLengthPerItem);
    if (!normalized) {
      return;
    }
    const lookup = normalizeLookup(normalized);
    if (!lookup || seen.has(lookup)) {
      return;
    }
    seen.add(lookup);
    output.push(normalized);
  });
  return output;
}

function normalizeValidation(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const minLength =
    Number.isInteger(value.minLength) && value.minLength > 0 && value.minLength <= 320
      ? value.minLength
      : null;
  const maxLength =
    Number.isInteger(value.maxLength) && value.maxLength >= 1 && value.maxLength <= 320
      ? value.maxLength
      : null;
  const pattern = normalizeText(value.pattern, 120);

  return {
    ...(minLength ? { minLength } : {}),
    ...(maxLength ? { maxLength } : {}),
    ...(pattern ? { pattern } : {}),
  };
}

function normalizeRequiredFields(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    if (!field || typeof field !== "object") {
      return;
    }

    const rawKey = normalizeLookup(field.key || "").replace(/\s+/g, "_");
    const key = rawKey.replace(/[^a-z0-9_]/g, "").slice(0, 60);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const label = normalizeText(field.label || key, 120);
    const prompt = normalizeText(
      field.prompt || `Indícame ${label || "este dato"} para continuar con el trámite.`,
      280
    );
    const typeLookup = normalizeLookup(field.type || "text");
    const type = SUPPORTED_FIELD_TYPES.has(typeLookup) ? typeLookup : "text";
    const required = field.required !== false;
    const options = normalizeArray(field.options || [], 80);
    const validation = normalizeValidation(field.validation);

    normalized.push({
      key,
      label: label || key,
      prompt,
      type,
      required,
      options,
      validation,
      order: index,
    });
  });

  return normalized;
}

function normalizeFlowDefinition(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const completionMessage = normalizeText(value.completionMessage, 260);
  return completionMessage ? { completionMessage } : {};
}

function normalizeProcedureFieldDefinition(field) {
  if (!field || typeof field !== "object") {
    return null;
  }

  const key = normalizeLookup(field.key || "").replace(/[^a-z0-9_]/g, "").slice(0, 60);
  if (!key) {
    return null;
  }

  const label = normalizeText(field.label || key, 120);
  const prompt = normalizeText(field.prompt || `Indícame ${label || "este dato"}.`, 280);
  const typeLookup = normalizeLookup(field.type || "text");
  const type = SUPPORTED_FIELD_TYPES.has(typeLookup) ? typeLookup : "text";
  const required = field.required !== false;
  const options = normalizeArray(field.options || [], 80);
  const validation = normalizeValidation(field.validation);

  return {
    key,
    label: label || key,
    prompt,
    type,
    required,
    options,
    validation,
    order: Number.isInteger(field.order) ? field.order : 0,
  };
}

function normalizeProcedureFieldDefinitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    const candidate = normalizeProcedureFieldDefinition(field);
    if (!candidate || seen.has(candidate.key)) {
      return;
    }
    seen.add(candidate.key);
    normalized.push({
      ...candidate,
      order: Number.isInteger(field?.order) ? field.order : index,
    });
  });

  return normalized.sort((a, b) => a.order - b.order);
}

function mapRowToProcedure(row) {
  const aliases = normalizeArray(row?.aliases_json || row?.aliases || []);
  const keywords = normalizeArray(row?.keywords_json || row?.keywords || []);
  const requiredFields = normalizeRequiredFields(row?.required_fields_json || row?.required_fields || []);
  const flowDefinition = normalizeFlowDefinition(row?.flow_definition_json || row?.flow_definition || {});

  return {
    id: normalizeText(row?.id, 80),
    code: normalizeText(row?.code, 120),
    name: normalizeText(row?.name, 160),
    description: normalizeText(row?.description, 320),
    category: normalizeText(row?.category, 80),
    aliases,
    keywords,
    isActive: Boolean(row?.is_active),
    requiredFields,
    flowDefinition,
  };
}

function buildSearchTerms(procedure) {
  return [procedure.name, ...procedure.aliases, ...procedure.keywords]
    .map((value) => normalizeLookup(value))
    .filter(Boolean);
}

function tokenizeLookup(value) {
  return normalizeLookup(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !LOOKUP_STOP_WORDS.has(token));
}

function isAuxiliaryPhrase(value) {
  return AUXILIARY_PROCEDURE_PHRASES.has(normalizeLookup(value));
}

function scoreProcedureMatch({
  procedure,
  interpretedName,
  interpretedCategory,
  userText,
  intentConfidence,
}) {
  const procedureName = normalizeLookup(procedure.name);
  const aliases = procedure.aliases.map((alias) => normalizeLookup(alias)).filter(Boolean);
  const keywords = procedure.keywords.map((keyword) => normalizeLookup(keyword)).filter(Boolean);
  const candidate = normalizeLookup(interpretedName);
  const textLookup = normalizeLookup(userText);
  let bestScore = 0;

  if (candidate && !isAuxiliaryPhrase(candidate)) {
    if (candidate === procedureName) {
      bestScore = Math.max(bestScore, 0.99);
    }
    if (aliases.includes(candidate)) {
      bestScore = Math.max(bestScore, 0.97);
    }
    if (candidate.includes(procedureName) || procedureName.includes(candidate)) {
      bestScore = Math.max(bestScore, 0.87);
    }
    if (aliases.some((alias) => alias.includes(candidate) || candidate.includes(alias))) {
      bestScore = Math.max(bestScore, 0.84);
    }

    const candidateTokens = tokenizeLookup(candidate);
    const procedureTokens = new Set(tokenizeLookup(buildSearchTerms(procedure).join(" ")));
    if (candidateTokens.length > 0 && procedureTokens.size > 0) {
      const overlap = candidateTokens.filter((token) => procedureTokens.has(token)).length;
      const overlapRatio = overlap / candidateTokens.length;
      if (overlapRatio >= 0.75) {
        bestScore = Math.max(bestScore, 0.82);
      } else if (overlapRatio >= 0.5) {
        bestScore = Math.max(bestScore, 0.74);
      }
    }
  }

  if (textLookup) {
    if (textLookup.includes(procedureName)) {
      bestScore = Math.max(bestScore, 0.93);
    }
    if (aliases.some((alias) => textLookup.includes(alias))) {
      bestScore = Math.max(bestScore, 0.9);
    }

    const keywordMatches = keywords.filter((keyword) => textLookup.includes(keyword)).length;
    if (keywordMatches >= 3) {
      bestScore = Math.max(bestScore, 0.86);
    } else if (keywordMatches === 2) {
      bestScore = Math.max(bestScore, 0.78);
    } else if (keywordMatches === 1) {
      bestScore = Math.max(bestScore, 0.66);
    }
  }

  const category = normalizeLookup(interpretedCategory);
  if (category && category === normalizeLookup(procedure.category)) {
    bestScore = Math.min(1, bestScore + 0.06);
  }

  const boundedIntentConfidence =
    typeof intentConfidence === "number" && Number.isFinite(intentConfidence)
      ? Math.min(1, Math.max(0, intentConfidence))
      : 0;
  if (boundedIntentConfidence >= 0.8 && bestScore > 0) {
    bestScore = Math.min(1, bestScore + 0.02);
  }

  return bestScore;
}

async function upsertProcedureCatalogDefaults(sql) {
  for (const entry of DEFAULT_PROCEDURE_CATALOG) {
    const id = randomUUID();
    const code = normalizeText(entry.code, 120);
    const name = normalizeText(entry.name, 160);
    const description = normalizeText(entry.description, 320);
    const category = normalizeText(entry.category, 80);
    const aliases = normalizeArray(entry.aliases, 120);
    const keywords = normalizeArray(entry.keywords, 120);
    const requiredFields = normalizeRequiredFields(entry.requiredFields);
    const flowDefinition = normalizeFlowDefinition(entry.flowDefinition);

    if (!code || !name || requiredFields.length === 0) {
      continue;
    }

    await sql`
      INSERT INTO chatbot_procedure_catalog (
        id,
        code,
        name,
        description,
        category,
        aliases_json,
        keywords_json,
        is_active,
        required_fields_json,
        flow_definition_json,
        updated_at
      )
      VALUES (
        ${id},
        ${code},
        ${name},
        ${description},
        ${category},
        ${JSON.stringify(aliases)}::jsonb,
        ${JSON.stringify(keywords)}::jsonb,
        ${true},
        ${JSON.stringify(requiredFields)}::jsonb,
        ${JSON.stringify(flowDefinition)}::jsonb,
        NOW()
      )
      ON CONFLICT (code)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        aliases_json = EXCLUDED.aliases_json,
        keywords_json = EXCLUDED.keywords_json,
        required_fields_json = EXCLUDED.required_fields_json,
        flow_definition_json = EXCLUDED.flow_definition_json,
        updated_at = NOW();
    `;
  }
}

export async function ensureProcedureCatalogSchema() {
  if (!hasDatabase()) {
    return false;
  }

  const sql = ensureDatabase();
  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_catalog (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      required_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      flow_definition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS aliases_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET aliases_json = '[]'::jsonb
    WHERE aliases_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS keywords_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET keywords_json = '[]'::jsonb
    WHERE keywords_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS required_fields_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET required_fields_json = '[]'::jsonb
    WHERE required_fields_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS flow_definition_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET flow_definition_json = '{}'::jsonb
    WHERE flow_definition_json IS NULL;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_catalog_active_idx
    ON chatbot_procedure_catalog (is_active, updated_at DESC);
  `;

  await upsertProcedureCatalogDefaults(sql);
  return true;
}

export async function listActiveProcedureCatalog() {
  if (!hasDatabase()) {
    return [];
  }

  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const rows = await sql`
    SELECT
      id,
      code,
      name,
      description,
      category,
      aliases_json,
      keywords_json,
      is_active,
      required_fields_json,
      flow_definition_json,
      created_at,
      updated_at
    FROM chatbot_procedure_catalog
    WHERE is_active = TRUE
    ORDER BY name ASC;
  `;
  return rows.map((row) => mapRowToProcedure(row)).filter((row) => row.code && row.name);
}

export async function getProcedureCatalogEntryByCode(code) {
  const normalizedCode = normalizeText(code, 120).toLowerCase();
  if (!normalizedCode || !hasDatabase()) {
    return null;
  }

  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const [row] = await sql`
    SELECT
      id,
      code,
      name,
      description,
      category,
      aliases_json,
      keywords_json,
      is_active,
      required_fields_json,
      flow_definition_json
    FROM chatbot_procedure_catalog
    WHERE code = ${normalizedCode}
      AND is_active = TRUE
    LIMIT 1;
  `;
  return row ? mapRowToProcedure(row) : null;
}

export async function resolveProcedureFromCatalog({ userText, interpretation }) {
  if (!hasDatabase()) {
    return {
      matched: false,
      procedure: null,
      confidence: 0,
      reason: "catalog_unavailable",
    };
  }

  const procedures = await listActiveProcedureCatalog();
  if (procedures.length === 0) {
    return {
      matched: false,
      procedure: null,
      confidence: 0,
      reason: "catalog_empty",
    };
  }

  const interpretedName = normalizeText(interpretation?.procedureCandidate?.name, 160);
  const interpretedCategory = normalizeText(interpretation?.procedureCandidate?.category, 80);
  const intentConfidence = interpretation?.intent?.confidence || 0;

  const scored = procedures
    .map((procedure) => ({
      procedure,
      score: scoreProcedureMatch({
        procedure,
        interpretedName,
        interpretedCategory,
        userText,
        intentConfidence,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const bestMatch = scored[0] || null;
  if (!bestMatch || bestMatch.score < 0.68) {
    return {
      matched: false,
      procedure: null,
      confidence: bestMatch?.score || 0,
      reason: "no_confident_match",
    };
  }

  return {
    matched: true,
    procedure: bestMatch.procedure,
    confidence: bestMatch.score,
    reason: "matched",
  };
}

export function normalizeProcedureCollectedData(collectedData) {
  const rawData = collectedData && typeof collectedData === "object" ? collectedData : {};
  const procedureRequiredFields = normalizeProcedureFieldDefinitions(rawData.procedureRequiredFields || []);

  const normalized = {
    category: normalizeText(rawData.category, 80),
    subcategory: normalizeText(rawData.subcategory, 120),
    location: normalizeText(rawData.location),
    description: normalizeText(rawData.description),
    risk: normalizeText(rawData.risk, 120),
    photoStatus: normalizeText(rawData.photoStatus, 40) || "not_requested",
    procedureName: normalizeText(rawData.procedureName, 160),
    procedureDetails: normalizeText(rawData.procedureDetails, 320),
    procedureCode: normalizeLookup(rawData.procedureCode).slice(0, 120),
    procedureCategory: normalizeText(rawData.procedureCategory, 80),
    procedureRequiredFields,
  };

  procedureRequiredFields.forEach((field) => {
    normalized[field.key] = normalizeText(rawData[field.key], 320);
  });

  return normalized;
}

export function getProcedureFieldDefinition(requiredFields, fieldName) {
  const normalizedFieldName = normalizeLookup(fieldName).replace(/[^a-z0-9_]/g, "");
  if (!normalizedFieldName) {
    return null;
  }

  const normalizedFields = normalizeProcedureFieldDefinitions(requiredFields);
  return normalizedFields.find((field) => field.key === normalizedFieldName) || null;
}

export function getProcedureMissingFieldsFromDefinition(requiredFields, collectedData) {
  const normalizedFields = normalizeProcedureFieldDefinitions(requiredFields);
  const normalizedCollectedData = normalizeProcedureCollectedData(collectedData);
  if (normalizedFields.length === 0) {
    const fallbackMissing = [];
    if (!normalizedCollectedData.procedureName) {
      fallbackMissing.push("procedureName");
    }
    if (!normalizedCollectedData.procedureDetails) {
      fallbackMissing.push("procedureDetails");
    }
    return fallbackMissing;
  }

  return normalizedFields
    .filter((field) => field.required !== false)
    .map((field) => field.key)
    .filter((fieldKey) => !normalizeText(normalizedCollectedData[fieldKey], 320));
}

export function validateProcedureFieldInput({ fieldDefinition, inputValue }) {
  const value = normalizeText(inputValue, 320);
  if (!fieldDefinition || typeof fieldDefinition !== "object") {
    return {
      ok: Boolean(value),
      normalizedValue: value,
      error: value ? null : "Necesito un valor para continuar con el trámite.",
    };
  }

  if (!value) {
    return {
      ok: false,
      normalizedValue: "",
      error: `Necesito ${fieldDefinition.label || "este dato"} para continuar con el trámite.`,
    };
  }

  const validation = fieldDefinition.validation || {};
  if (validation.minLength && value.length < validation.minLength) {
    return {
      ok: false,
      normalizedValue: value,
      error: `El dato "${fieldDefinition.label}" debe tener al menos ${validation.minLength} caracteres.`,
    };
  }
  if (validation.maxLength && value.length > validation.maxLength) {
    return {
      ok: false,
      normalizedValue: value.slice(0, validation.maxLength),
      error: `El dato "${fieldDefinition.label}" supera el largo permitido.`,
    };
  }
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern, "i");
      if (!regex.test(value)) {
        return {
          ok: false,
          normalizedValue: value,
          error: `El formato de "${fieldDefinition.label}" no es válido.`,
        };
      }
    } catch (_error) {
      // Ignore invalid patterns from catalog and keep flow usable.
    }
  }
  if (fieldDefinition.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      ok: false,
      normalizedValue: value,
      error: "El correo electrónico no tiene un formato válido.",
    };
  }
  if (fieldDefinition.type === "number" && !/^[0-9]+$/.test(value)) {
    return {
      ok: false,
      normalizedValue: value,
      error: `El dato "${fieldDefinition.label}" debe contener solo números.`,
    };
  }

  return {
    ok: true,
    normalizedValue: value,
    error: null,
  };
}

export function buildProcedureSummaryText({ procedureName, requiredFields, collectedData }) {
  const normalizedProcedureName = normalizeText(procedureName, 160) || "Trámite";
  const normalizedFields = normalizeProcedureFieldDefinitions(requiredFields);
  const normalizedData = normalizeProcedureCollectedData(collectedData);
  const lines = [
    `Resumen del trámite "${normalizedProcedureName}":`,
  ];

  normalizedFields.forEach((field) => {
    if (field.required === false) {
      return;
    }
    const value = normalizeText(normalizedData[field.key], 320) || "(pendiente)";
    lines.push(`- ${field.label}: ${value}`);
  });

  lines.push("");
  lines.push("Si está correcto, confirma para continuar.");
  return lines.join("\n");
}

export async function findMatchingProcedure({ text, interpretation }) {
  const resolution = await resolveProcedureFromCatalog({
    userText: text,
    interpretation,
  });
  if (!resolution.matched || !resolution.procedure) {
    return null;
  }

  return {
    ...resolution.procedure,
    matchScore: resolution.confidence,
    matchReason: resolution.reason,
  };
}

export async function getProcedureByCode(code) {
  return getProcedureCatalogEntryByCode(code);
}


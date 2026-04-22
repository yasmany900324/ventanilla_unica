import { ensureDatabase, hasDatabase } from "./db";
import { ensureAuthSchema } from "./auth";

const sessionDataStore = new Map();
let schemaReadyPromise = null;
let lastCleanupRunAt = 0;

const DEFAULT_LOCALE = "es";
const FIELD_MAX_LENGTH = 320;
const SESSION_TTL_DAYS = 30;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const FLOW_KEY_INCIDENT = "incident.general";
const LEGACY_FLOW_KEY_TREE = "incident.tree_fallen_branches";
const FLOW_KEY_PROCEDURE = "procedure.general_start";
const REQUIRED_INCIDENT_FIELDS = ["location", "description", "risk"];

export const CHATBOT_CONVERSATION_STATES = {
  IDLE: "idle",
  FLOW_ACTIVE: "flow_active",
  AWAITING_CONFIRMATION: "awaiting_confirmation",
  INCIDENT_CREATED: "incident_created",
  CLOSED: "closed",
};

export const CHATBOT_CURRENT_STEPS = {
  LOCATION: "location",
  DESCRIPTION: "description",
  RISK: "risk",
  PHOTO: "photo",
  SUMMARY: "summary",
  CONFIRMATION: "confirmation",
  CREATED: "created",
  CLOSED: "closed",
};

const CHATBOT_CONVERSATION_STATE_SET = new Set(Object.values(CHATBOT_CONVERSATION_STATES));
const CHATBOT_STEP_SET = new Set(Object.values(CHATBOT_CURRENT_STEPS));
const CONFIRMATION_STATE_SET = new Set(["none", "ready", "confirmed", "cancelled"]);
const PHOTO_STATUS_SET = new Set(["not_requested", "pending_upload", "provided", "skipped"]);

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") {
    return "";
  }

  return sessionId.trim();
}

function normalizeUserId(userId) {
  if (typeof userId !== "string") {
    return null;
  }

  const normalized = userId.trim().slice(0, 120);
  return normalized || null;
}

function normalizeLocale(locale) {
  if (typeof locale !== "string") {
    return "";
  }

  return locale.trim().toLowerCase();
}

function normalizeConversationState(state) {
  if (typeof state !== "string") {
    return CHATBOT_CONVERSATION_STATES.IDLE;
  }

  const normalizedState = state.trim().toLowerCase();
  if (CHATBOT_CONVERSATION_STATE_SET.has(normalizedState)) {
    return normalizedState;
  }

  return CHATBOT_CONVERSATION_STATES.IDLE;
}

function normalizeCurrentStep(step) {
  if (typeof step !== "string") {
    return CHATBOT_CURRENT_STEPS.LOCATION;
  }

  const normalized = step.trim().toLowerCase();
  if (CHATBOT_STEP_SET.has(normalized)) {
    return normalized;
  }

  return CHATBOT_CURRENT_STEPS.LOCATION;
}

function normalizeConfirmationState(value) {
  if (typeof value !== "string") {
    return "none";
  }

  const normalized = value.trim().toLowerCase();
  if (CONFIRMATION_STATE_SET.has(normalized)) {
    return normalized;
  }

  return "none";
}

function normalizeStringField(value, maxLength = FIELD_MAX_LENGTH) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeAttachmentSizeBytes(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(Math.max(0, value), 50 * 1024 * 1024);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(0, parsed), 50 * 1024 * 1024);
    }
  }
  return 0;
}

function normalizeFlowKey(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().slice(0, 120);
  if (!normalized) {
    return null;
  }

  if (
    normalized === FLOW_KEY_INCIDENT ||
    normalized === LEGACY_FLOW_KEY_TREE ||
    normalized === "incident.general_report" ||
    normalized === "incident"
  ) {
    return FLOW_KEY_INCIDENT;
  }
  if (normalized === FLOW_KEY_PROCEDURE) {
    return normalized;
  }

  return null;
}

function normalizePhotoStatus(value) {
  if (typeof value !== "string") {
    return "not_requested";
  }

  const normalized = value.trim().toLowerCase();
  if (PHOTO_STATUS_SET.has(normalized)) {
    return normalized;
  }

  return "not_requested";
}

function normalizeNullableText(value, maxLength = FIELD_MAX_LENGTH) {
  const normalized = normalizeStringField(value, maxLength);
  return normalized || null;
}

function normalizeProcedureFieldDefinitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    if (!field || typeof field !== "object") {
      return;
    }

    const key = normalizeStringField(field.key, 60)
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const options = Array.isArray(field.options)
      ? field.options
          .map((option) => normalizeStringField(option, 80))
          .filter(Boolean)
      : [];
    const rawValidation = field.validation && typeof field.validation === "object" ? field.validation : {};
    const validation = {};
    if (Number.isInteger(rawValidation.minLength) && rawValidation.minLength > 0) {
      validation.minLength = rawValidation.minLength;
    }
    if (Number.isInteger(rawValidation.maxLength) && rawValidation.maxLength >= 1) {
      validation.maxLength = rawValidation.maxLength;
    }
    const pattern = normalizeStringField(rawValidation.pattern, 120);
    if (pattern) {
      validation.pattern = pattern;
    }

    normalized.push({
      key,
      label: normalizeStringField(field.label || key, 120),
      prompt: normalizeStringField(field.prompt, 280),
      type: normalizeStringField(field.type, 40).toLowerCase() || "text",
      required: field.required !== false,
      options,
      validation,
      order: Number.isInteger(field.order) ? field.order : index,
    });
  });

  return normalized.sort((a, b) => a.order - b.order);
}

function normalizeConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const bounded = Math.min(1, Math.max(0, value));
  return Number.isFinite(bounded) ? bounded : null;
}

function parseJsonFromDatabase(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function normalizeCollectedData(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return {
      category: "",
      subcategory: "",
      location: "",
      description: "",
      risk: "",
      photoStatus: "not_requested",
      photoAttachmentStorageProvider: "",
      photoAttachmentStorageKey: "",
      photoAttachmentPublicUrl: "",
      photoAttachmentSizeBytes: 0,
      photoAttachmentOriginalName: "",
      photoAttachmentStoredFilename: "",
      photoAttachmentMimeType: "",
      photoAttachmentUploadedAt: "",
      procedureCode: "",
      procedureCategory: "",
      procedureName: "",
      procedureDetails: "",
      procedureRequiredFields: [],
    };
  }

  const procedureRequiredFields = normalizeProcedureFieldDefinitions(collectedData.procedureRequiredFields || []);
  const normalized = {
    category: normalizeStringField(collectedData.category, 80),
    subcategory: normalizeStringField(collectedData.subcategory, 120),
    location: normalizeStringField(collectedData.location),
    description: normalizeStringField(collectedData.description),
    risk: normalizeStringField(collectedData.risk, 120),
    photoStatus: normalizePhotoStatus(collectedData.photoStatus),
    photoAttachmentStorageProvider: normalizeStringField(collectedData.photoAttachmentStorageProvider, 40),
    photoAttachmentStorageKey:
      normalizeStringField(collectedData.photoAttachmentStorageKey, 512) ||
      normalizeStringField(collectedData.photoAttachmentStoredFilename, 120),
    photoAttachmentPublicUrl: normalizeStringField(collectedData.photoAttachmentPublicUrl, 2048),
    photoAttachmentSizeBytes: normalizeAttachmentSizeBytes(collectedData.photoAttachmentSizeBytes),
    photoAttachmentOriginalName: normalizeStringField(collectedData.photoAttachmentOriginalName, 200),
    photoAttachmentStoredFilename: normalizeStringField(collectedData.photoAttachmentStoredFilename, 120),
    photoAttachmentMimeType: normalizeStringField(collectedData.photoAttachmentMimeType, 80),
    photoAttachmentUploadedAt: normalizeStringField(collectedData.photoAttachmentUploadedAt, 40),
    procedureCode: normalizeStringField(collectedData.procedureCode, 120).toLowerCase(),
    procedureCategory: normalizeStringField(collectedData.procedureCategory, 80),
    procedureName: normalizeStringField(collectedData.procedureName, 160),
    procedureDetails: normalizeStringField(collectedData.procedureDetails, 320),
    procedureRequiredFields,
  };

  procedureRequiredFields.forEach((field) => {
    normalized[field.key] = normalizeStringField(collectedData[field.key], 320);
  });

  return normalized;
}

function computeMissingFields(flowKey, collectedData) {
  if (flowKey !== FLOW_KEY_INCIDENT) {
    if (flowKey === FLOW_KEY_PROCEDURE) {
      const requiredFields = normalizeProcedureFieldDefinitions(collectedData?.procedureRequiredFields || []);
      if (requiredFields.length > 0) {
        return requiredFields
          .filter((field) => field.required !== false)
          .map((field) => field.key)
          .filter((fieldKey) => !normalizeStringField(collectedData?.[fieldKey], 320));
      }

      const missingProcedureFields = [];
      if (!normalizeStringField(collectedData?.procedureDetails, 320)) {
        missingProcedureFields.push("procedureDetails");
      }
      if (!normalizeStringField(collectedData?.procedureName, 160)) {
        missingProcedureFields.push("procedureName");
      }
      return missingProcedureFields;
    }
    return [];
  }

  return REQUIRED_INCIDENT_FIELDS.filter((fieldName) => !normalizeStringField(collectedData?.[fieldName]));
}

function normalizeSessionSnapshot(snapshot) {
  const flowKey = normalizeFlowKey(snapshot?.flowKey);
  const collectedData = normalizeCollectedData(snapshot?.collectedData);

  return {
    locale: normalizeLocale(snapshot?.locale) || DEFAULT_LOCALE,
    userId: normalizeUserId(snapshot?.userId),
    state: normalizeConversationState(snapshot?.state),
    flowKey,
    currentStep: normalizeCurrentStep(snapshot?.currentStep),
    confirmationState: normalizeConfirmationState(snapshot?.confirmationState),
    collectedData,
    missingFields: computeMissingFields(flowKey, collectedData),
    lastInterpretation:
      snapshot?.lastInterpretation && typeof snapshot.lastInterpretation === "object"
        ? snapshot.lastInterpretation
        : {},
    lastIntent: normalizeNullableText(snapshot?.lastIntent, 120),
    lastAction: normalizeNullableText(snapshot?.lastAction, 120),
    lastConfidence: normalizeConfidence(snapshot?.lastConfidence),
  };
}

async function ensureChatSessionSchema() {
  if (!hasDatabase()) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = ensureDatabase();
      await ensureAuthSchema();
      const schemaStatements = [
        `CREATE TABLE IF NOT EXISTS chatbot_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT REFERENCES citizens(id) ON DELETE SET NULL,
          locale TEXT NOT NULL DEFAULT 'es',
          state TEXT NOT NULL DEFAULT 'idle',
          flow_key TEXT,
          current_step TEXT,
          confirmation_state TEXT NOT NULL DEFAULT 'none',
          collected_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_interpretation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          draft_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          pending_field TEXT,
          last_intent TEXT,
          last_action TEXT,
          last_confidence DOUBLE PRECISION,
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN locale SET DEFAULT 'es';`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS state TEXT;`,
        `UPDATE chatbot_sessions SET state = 'idle' WHERE state IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN state SET DEFAULT 'idle';`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN state SET NOT NULL;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS flow_key TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS current_step TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS confirmation_state TEXT;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN confirmation_state SET DEFAULT 'none';`,
        `UPDATE chatbot_sessions SET confirmation_state = 'none' WHERE confirmation_state IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN confirmation_state SET NOT NULL;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS collected_data_json JSONB;`,
        `UPDATE chatbot_sessions SET collected_data_json = '{}'::jsonb WHERE collected_data_json IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN collected_data_json SET DEFAULT '{}'::jsonb;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN collected_data_json SET NOT NULL;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS last_interpretation_json JSONB;`,
        `UPDATE chatbot_sessions SET last_interpretation_json = '{}'::jsonb WHERE last_interpretation_json IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN last_interpretation_json SET DEFAULT '{}'::jsonb;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN last_interpretation_json SET NOT NULL;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS draft_json JSONB;`,
        `UPDATE chatbot_sessions SET draft_json = '{}'::jsonb WHERE draft_json IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN draft_json SET DEFAULT '{}'::jsonb;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN draft_json SET NOT NULL;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS pending_field TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS last_intent TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS last_action TEXT;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS last_confidence DOUBLE PRECISION;`,
        `ALTER TABLE chatbot_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`,
        `UPDATE chatbot_sessions SET expires_at = NOW() + INTERVAL '30 days' WHERE expires_at IS NULL;`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '30 days');`,
        `ALTER TABLE chatbot_sessions ALTER COLUMN expires_at SET NOT NULL;`,
        `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'chatbot_sessions_user_id_fkey'
          ) THEN
            ALTER TABLE chatbot_sessions
            ADD CONSTRAINT chatbot_sessions_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES citizens(id)
            ON DELETE SET NULL;
          END IF;
        END $$;`,
        `CREATE INDEX IF NOT EXISTS chatbot_sessions_updated_at_idx
         ON chatbot_sessions (updated_at DESC);`,
        `CREATE INDEX IF NOT EXISTS chatbot_sessions_user_id_updated_at_idx
         ON chatbot_sessions (user_id, updated_at DESC);`,
        `CREATE INDEX IF NOT EXISTS chatbot_sessions_flow_key_updated_at_idx
         ON chatbot_sessions (flow_key, updated_at DESC);`,
        `CREATE INDEX IF NOT EXISTS chatbot_sessions_expires_at_idx
         ON chatbot_sessions (expires_at);`,
      ];

      for (const statement of schemaStatements) {
        await sql.unsafe(statement);
      }
      return true;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
  return true;
}

async function maybeCleanupExpiredSessions() {
  const now = Date.now();
  if (now - lastCleanupRunAt < CLEANUP_INTERVAL_MS) {
    return;
  }
  lastCleanupRunAt = now;

  for (const [sessionId, snapshot] of sessionDataStore.entries()) {
    if (!snapshot?.updatedAt) {
      continue;
    }

    const updatedAtDate = new Date(snapshot.updatedAt);
    const expiresAtMs = updatedAtDate.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (Number.isFinite(expiresAtMs) && expiresAtMs < now) {
      sessionDataStore.delete(sessionId);
    }
  }

  if (!hasDatabase()) {
    return;
  }

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    await sql`
      DELETE FROM chatbot_sessions
      WHERE expires_at <= NOW();
    `;
  } catch (error) {
    console.warn("[chatbot] No se pudieron limpiar sesiones expiradas.", {
      message: error?.message,
    });
  }
}

export async function getSessionSnapshot(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  await maybeCleanupExpiredSessions();
  const inMemorySnapshot = sessionDataStore.get(normalizedSessionId) || null;
  if (!hasDatabase()) {
    return inMemorySnapshot;
  }

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    const [row] = await sql`
      SELECT
        user_id,
        locale,
        state,
        flow_key,
        current_step,
        confirmation_state,
        collected_data_json,
        last_interpretation_json,
        draft_json,
        pending_field,
        last_intent,
        last_action,
        last_confidence,
        updated_at
      FROM chatbot_sessions
      WHERE session_id = ${normalizedSessionId}
        AND expires_at > NOW()
      LIMIT 1;
    `;
    if (row) {
      const collectedDataFromLegacy = parseJsonFromDatabase(row.draft_json);
      const normalizedSnapshot = normalizeSessionSnapshot({
        userId: row.user_id,
        locale: row.locale,
        state: row.state,
        flowKey: row.flow_key,
        currentStep: row.current_step || row.pending_field || CHATBOT_CURRENT_STEPS.LOCATION,
        confirmationState: row.confirmation_state,
        collectedData: {
          ...collectedDataFromLegacy,
          ...parseJsonFromDatabase(row.collected_data_json),
        },
        lastInterpretation: parseJsonFromDatabase(row.last_interpretation_json),
        lastIntent: row.last_intent,
        lastAction: row.last_action,
        lastConfidence: row.last_confidence,
        updatedAt: row.updated_at,
      });
      sessionDataStore.set(normalizedSessionId, {
        ...normalizedSnapshot,
        updatedAt: row.updated_at?.toISOString?.() || new Date().toISOString(),
      });
      return normalizedSnapshot;
    }
  } catch (error) {
    console.warn("[chatbot] No se pudo leer sesion en DB. Se usa fallback en memoria.", {
      sessionId: normalizedSessionId,
      message: error?.message,
    });
  }

  return inMemorySnapshot;
}

export async function getSessionLocale(sessionId) {
  const snapshot = await getSessionSnapshot(sessionId);
  return snapshot?.locale || null;
}

async function persistSessionSnapshot(sessionId, snapshot) {
  if (!hasDatabase()) {
    return;
  }

  const persistWithUserId = async (userIdValue) => {
    const sql = ensureDatabase();
    await sql`
      INSERT INTO chatbot_sessions (
        session_id,
        user_id,
        locale,
        state,
        flow_key,
        current_step,
        confirmation_state,
        collected_data_json,
        last_interpretation_json,
        draft_json,
        pending_field,
        last_intent,
        last_action,
        last_confidence,
        expires_at
      )
      VALUES (
        ${sessionId},
        ${userIdValue},
        ${snapshot.locale},
        ${snapshot.state},
        ${snapshot.flowKey},
        ${snapshot.currentStep},
        ${snapshot.confirmationState},
        ${JSON.stringify(snapshot.collectedData)}::jsonb,
        ${JSON.stringify(snapshot.lastInterpretation || {})}::jsonb,
        ${JSON.stringify({
          category: snapshot.collectedData.category,
          description: snapshot.collectedData.description,
          location: snapshot.collectedData.location,
        })}::jsonb,
        ${snapshot.currentStep},
        ${snapshot.lastIntent},
        ${snapshot.lastAction},
        ${snapshot.lastConfidence},
        NOW() + (${SESSION_TTL_DAYS}::int * INTERVAL '1 day')
      )
      ON CONFLICT (session_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        locale = EXCLUDED.locale,
        state = EXCLUDED.state,
        flow_key = EXCLUDED.flow_key,
        current_step = EXCLUDED.current_step,
        confirmation_state = EXCLUDED.confirmation_state,
        collected_data_json = EXCLUDED.collected_data_json,
        last_interpretation_json = EXCLUDED.last_interpretation_json,
        draft_json = EXCLUDED.draft_json,
        pending_field = EXCLUDED.pending_field,
        last_intent = EXCLUDED.last_intent,
        last_action = EXCLUDED.last_action,
        last_confidence = EXCLUDED.last_confidence,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW();
    `;
  };

  try {
    await ensureChatSessionSchema();
    await persistWithUserId(snapshot.userId);
  } catch (error) {
    const isUserIdForeignKeyIssue =
      error?.code === "23503" &&
      (error?.constraint === "chatbot_sessions_user_id_fkey" ||
        String(error?.message || "").includes("chatbot_sessions_user_id_fkey"));
    if (isUserIdForeignKeyIssue) {
      try {
        await persistWithUserId(null);
        console.warn("[chatbot] Persistencia de sesión reintentada sin user_id por FK inválida.", {
          sessionId,
          userId: snapshot.userId,
          code: error?.code,
          constraint: error?.constraint,
        });
        return;
      } catch (retryError) {
        console.warn("[chatbot] Reintento de persistencia de sesión sin user_id también falló.", {
          sessionId,
          message: retryError?.message,
          code: retryError?.code,
          constraint: retryError?.constraint,
        });
      }
    }
    console.warn("[chatbot] No se pudo persistir sesion en DB. Se mantiene fallback en memoria.", {
      sessionId,
      message: error?.message,
      code: error?.code,
      constraint: error?.constraint,
      detail: error?.detail,
    });
  }
}

export async function setConversationState(sessionId, payload = {}) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const currentSnapshot = (await getSessionSnapshot(normalizedSessionId)) || {
    locale: DEFAULT_LOCALE,
    userId: null,
    state: CHATBOT_CONVERSATION_STATES.IDLE,
    flowKey: null,
    currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
    confirmationState: "none",
    collectedData: {
      category: "",
      subcategory: "",
      location: "",
      description: "",
      risk: "",
      photoStatus: "not_requested",
      photoAttachmentStorageProvider: "",
      photoAttachmentStorageKey: "",
      photoAttachmentPublicUrl: "",
      photoAttachmentSizeBytes: 0,
      photoAttachmentOriginalName: "",
      photoAttachmentStoredFilename: "",
      photoAttachmentMimeType: "",
      photoAttachmentUploadedAt: "",
      procedureCode: "",
      procedureCategory: "",
      procedureName: "",
      procedureDetails: "",
      procedureRequiredFields: [],
    },
    missingFields: [],
    lastInterpretation: {},
    lastIntent: null,
    lastAction: null,
    lastConfidence: null,
  };
  const nextSnapshot = normalizeSessionSnapshot({
    ...currentSnapshot,
    ...payload,
    collectedData:
      payload && Object.prototype.hasOwnProperty.call(payload, "collectedData")
        ? payload.collectedData
        : currentSnapshot.collectedData,
    lastInterpretation:
      payload && Object.prototype.hasOwnProperty.call(payload, "lastInterpretation")
        ? payload.lastInterpretation
        : currentSnapshot.lastInterpretation,
  });
  const persistedSnapshot = {
    ...nextSnapshot,
    updatedAt: new Date().toISOString(),
  };
  sessionDataStore.set(normalizedSessionId, persistedSnapshot);
  await persistSessionSnapshot(normalizedSessionId, nextSnapshot);
  return nextSnapshot;
}

export async function setSessionLocale(sessionId, locale) {
  const normalizedLocale = normalizeLocale(locale);
  if (!normalizedLocale) {
    return null;
  }

  const snapshot = await setConversationState(sessionId, { locale: normalizedLocale });
  return snapshot?.locale || null;
}

export async function setSessionUserId(sessionId, userId) {
  const normalizedUserId = normalizeUserId(userId);
  const snapshot = await setConversationState(sessionId, {
    userId: normalizedUserId,
  });
  return snapshot?.userId || null;
}

export async function clearIncidentDraft(sessionId) {
  const snapshot = await setConversationState(sessionId, {
    state: CHATBOT_CONVERSATION_STATES.IDLE,
    flowKey: null,
    currentStep: CHATBOT_CURRENT_STEPS.LOCATION,
    confirmationState: "none",
    collectedData: {
      category: "",
      subcategory: "",
      location: "",
      description: "",
      risk: "",
      photoStatus: "not_requested",
      photoAttachmentStorageProvider: "",
      photoAttachmentStorageKey: "",
      photoAttachmentPublicUrl: "",
      photoAttachmentSizeBytes: 0,
      photoAttachmentOriginalName: "",
      photoAttachmentStoredFilename: "",
      photoAttachmentMimeType: "",
      photoAttachmentUploadedAt: "",
      procedureCode: "",
      procedureCategory: "",
      procedureName: "",
      procedureDetails: "",
      procedureRequiredFields: [],
    },
    lastAction: null,
    lastInterpretation: {},
    lastIntent: null,
    lastConfidence: null,
  });

  return snapshot?.collectedData || null;
}

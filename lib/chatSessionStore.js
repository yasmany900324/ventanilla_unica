import { ensureDatabase, hasDatabase } from "./db";

const sessionDataStore = new Map();
let schemaReadyPromise = null;
const DEFAULT_LOCALE = "es";

export const CHATBOT_CONVERSATION_STATES = {
  IDLE: "idle",
  COLLECTING_INCIDENT: "collecting_incident",
  AWAITING_INCIDENT_CONFIRMATION: "awaiting_incident_confirmation",
  INCIDENT_CREATED: "incident_created",
  GUIDING_PROCEDURE: "guiding_procedure",
  FALLBACK_CLARIFICATION: "fallback_clarification",
};

const CHATBOT_CONVERSATION_STATE_SET = new Set(
  Object.values(CHATBOT_CONVERSATION_STATES)
);
const INCIDENT_DRAFT_FIELDS = new Set(["category", "description", "location"]);
const FIELD_MAX_LENGTH = 320;

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") {
    return "";
  }

  return sessionId.trim();
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

function normalizeStringField(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, FIELD_MAX_LENGTH);
}

function normalizeDraft(draft) {
  if (!draft || typeof draft !== "object") {
    return {
      category: "",
      description: "",
      location: "",
    };
  }

  return {
    category: normalizeStringField(draft.category),
    description: normalizeStringField(draft.description),
    location: normalizeStringField(draft.location),
  };
}

function normalizeNullableText(value) {
  const normalized = normalizeStringField(value);
  return normalized || null;
}

function normalizeConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  const bounded = Math.min(1, Math.max(0, value));
  return Number.isFinite(bounded) ? bounded : null;
}

function normalizePendingField(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (INCIDENT_DRAFT_FIELDS.has(normalized)) {
    return normalized;
  }

  return null;
}

function normalizeSessionSnapshot(snapshot) {
  return {
    locale: normalizeLocale(snapshot?.locale) || DEFAULT_LOCALE,
    state: normalizeConversationState(snapshot?.state),
    draft: normalizeDraft(snapshot?.draft),
    pendingField: normalizePendingField(snapshot?.pendingField),
    lastIntent: normalizeNullableText(snapshot?.lastIntent),
    lastAction: normalizeNullableText(snapshot?.lastAction),
    lastConfidence: normalizeConfidence(snapshot?.lastConfidence),
  };
}

function parseDraftFromDatabase(value) {
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

async function ensureChatSessionSchema() {
  if (!hasDatabase()) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = ensureDatabase();
      await sql`
        CREATE TABLE IF NOT EXISTS chatbot_sessions (
          session_id TEXT PRIMARY KEY,
          locale TEXT NOT NULL DEFAULT ${DEFAULT_LOCALE},
          state TEXT NOT NULL DEFAULT ${CHATBOT_CONVERSATION_STATES.IDLE},
          draft_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          pending_field TEXT,
          last_intent TEXT,
          last_action TEXT,
          last_confidence DOUBLE PRECISION,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ALTER COLUMN locale SET DEFAULT ${DEFAULT_LOCALE};
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT ${CHATBOT_CONVERSATION_STATES.IDLE};
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS draft_json JSONB NOT NULL DEFAULT '{}'::jsonb;
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS pending_field TEXT;
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS last_intent TEXT;
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS last_action TEXT;
      `;
      await sql`
        ALTER TABLE chatbot_sessions
        ADD COLUMN IF NOT EXISTS last_confidence DOUBLE PRECISION;
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chatbot_sessions_updated_at_idx
        ON chatbot_sessions (updated_at DESC);
      `;
      return true;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
  return true;
}

export async function getSessionSnapshot(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const inMemorySnapshot = sessionDataStore.get(normalizedSessionId) || null;
  if (!hasDatabase()) {
    return inMemorySnapshot;
  }

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    const [row] = await sql`
      SELECT locale, state, draft_json, pending_field, last_intent, last_action, last_confidence
      FROM chatbot_sessions
      WHERE session_id = ${normalizedSessionId}
      LIMIT 1;
    `;
    if (row) {
      const normalizedSnapshot = normalizeSessionSnapshot({
        locale: row.locale,
        state: row.state,
        draft: parseDraftFromDatabase(row.draft_json),
        pendingField: row.pending_field,
        lastIntent: row.last_intent,
        lastAction: row.last_action,
        lastConfidence: row.last_confidence,
      });
      sessionDataStore.set(normalizedSessionId, normalizedSnapshot);
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

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    await sql`
      INSERT INTO chatbot_sessions (
        session_id,
        locale,
        state,
        draft_json,
        pending_field,
        last_intent,
        last_action,
        last_confidence
      )
      VALUES (
        ${sessionId},
        ${snapshot.locale},
        ${snapshot.state},
        ${JSON.stringify(snapshot.draft)}::jsonb,
        ${snapshot.pendingField},
        ${snapshot.lastIntent},
        ${snapshot.lastAction},
        ${snapshot.lastConfidence}
      )
      ON CONFLICT (session_id)
      DO UPDATE SET
        locale = EXCLUDED.locale,
        state = EXCLUDED.state,
        draft_json = EXCLUDED.draft_json,
        pending_field = EXCLUDED.pending_field,
        last_intent = EXCLUDED.last_intent,
        last_action = EXCLUDED.last_action,
        last_confidence = EXCLUDED.last_confidence,
        updated_at = NOW();
    `;
  } catch (error) {
    console.warn("[chatbot] No se pudo persistir sesion en DB. Se mantiene fallback en memoria.", {
      sessionId,
      message: error?.message,
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
    state: CHATBOT_CONVERSATION_STATES.IDLE,
    draft: {
      category: "",
      description: "",
      location: "",
    },
    pendingField: null,
    lastIntent: null,
    lastAction: null,
    lastConfidence: null,
  };
  const nextSnapshot = normalizeSessionSnapshot({
    ...currentSnapshot,
    ...payload,
    draft:
      payload && Object.prototype.hasOwnProperty.call(payload, "draft")
        ? payload.draft
        : currentSnapshot.draft,
  });
  sessionDataStore.set(normalizedSessionId, nextSnapshot);
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

export async function clearIncidentDraft(sessionId) {
  const snapshot = await setConversationState(sessionId, {
    state: CHATBOT_CONVERSATION_STATES.IDLE,
    draft: {
      category: "",
      description: "",
      location: "",
    },
    pendingField: null,
    lastAction: null,
  });

  return snapshot?.draft || null;
}

import { ensureDatabase, hasDatabase } from "./db";

const sessionLocaleStore = new Map();
let schemaReadyPromise = null;

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
          locale TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
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

export async function getSessionLocale(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const inMemoryLocale = sessionLocaleStore.get(normalizedSessionId) || null;
  if (!hasDatabase()) {
    return inMemoryLocale;
  }

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    const [row] = await sql`
      SELECT locale
      FROM chatbot_sessions
      WHERE session_id = ${normalizedSessionId}
      LIMIT 1;
    `;
    const locale = normalizeLocale(row?.locale);
    if (locale) {
      sessionLocaleStore.set(normalizedSessionId, locale);
      return locale;
    }
  } catch (error) {
    console.warn("[chatbot] No se pudo leer locale de sesion en DB. Se usa fallback en memoria.", {
      sessionId: normalizedSessionId,
      message: error?.message,
    });
  }

  return inMemoryLocale;
}

export async function setSessionLocale(sessionId, locale) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedLocale = normalizeLocale(locale);
  if (!normalizedSessionId || !normalizedLocale) {
    return null;
  }

  sessionLocaleStore.set(normalizedSessionId, normalizedLocale);

  if (!hasDatabase()) {
    return normalizedLocale;
  }

  try {
    await ensureChatSessionSchema();
    const sql = ensureDatabase();
    await sql`
      INSERT INTO chatbot_sessions (session_id, locale)
      VALUES (${normalizedSessionId}, ${normalizedLocale})
      ON CONFLICT (session_id)
      DO UPDATE SET
        locale = EXCLUDED.locale,
        updated_at = NOW();
    `;
  } catch (error) {
    console.warn("[chatbot] No se pudo persistir locale de sesion en DB. Se mantiene fallback en memoria.", {
      sessionId: normalizedSessionId,
      message: error?.message,
    });
  }

  return normalizedLocale;
}

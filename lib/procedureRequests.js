import { randomUUID } from "crypto";
import { ensureAuthSchema } from "./auth";
import { ensureDatabase } from "./db";

const DEFAULT_STATUS = "recibido";

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function mapProcedureRequestRow(row) {
  let collectedData = {};
  if (row?.collected_data_json && typeof row.collected_data_json === "object") {
    collectedData = row.collected_data_json;
  } else if (typeof row?.collected_data_json === "string") {
    try {
      collectedData = JSON.parse(row.collected_data_json);
    } catch (_error) {
      collectedData = {};
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    requestCode: row.request_code,
    procedureCode: row.procedure_code,
    procedureName: row.procedure_name,
    procedureCategory: row.procedure_category,
    status: row.status,
    summary: row.summary,
    collectedData,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLookupIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function extractLookupTokens(identifier) {
  const normalized = normalizeLookupIdentifier(identifier);
  if (!normalized) {
    return {
      idToken: "",
      requestCodeToken: "",
      shortCodeToken: "",
    };
  }

  const withoutPrefix = normalized.replace(/^(TRA|PROC|SOL)[-:#]?/u, "");
  const cleanedShort = withoutPrefix.replace(/[^A-Z0-9]/gu, "");

  return {
    idToken: withoutPrefix.toLowerCase(),
    requestCodeToken: normalized.replace(/[:#]/gu, "-"),
    shortCodeToken: cleanedShort.slice(0, 8),
  };
}

export async function ensureProcedureRequestSchema() {
  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      request_code TEXT NOT NULL UNIQUE,
      procedure_code TEXT NOT NULL,
      procedure_name TEXT NOT NULL,
      procedure_category TEXT,
      status TEXT NOT NULL DEFAULT 'recibido',
      summary TEXT,
      collected_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS procedure_category TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS status TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET status = 'recibido'
    WHERE status IS NULL OR status = '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN status SET DEFAULT 'recibido';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN status SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS summary TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS collected_data_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET collected_data_json = '{}'::jsonb
    WHERE collected_data_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN collected_data_json SET DEFAULT '{}'::jsonb;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN collected_data_json SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET updated_at = created_at
    WHERE updated_at IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN updated_at SET DEFAULT NOW();
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN updated_at SET NOT NULL;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_user_updated_idx
    ON chatbot_procedure_requests (user_id, updated_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_code_idx
    ON chatbot_procedure_requests (request_code);
  `;
}

export async function createProcedureRequest({
  userId,
  procedureCode,
  procedureName,
  procedureCategory = "",
  summary = "",
  collectedData = {},
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const id = randomUUID();
  const requestCode = `TRA-${id.slice(0, 8).toUpperCase()}`;

  const [row] = await sql`
    INSERT INTO chatbot_procedure_requests (
      id,
      user_id,
      request_code,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      updated_at
    )
    VALUES (
      ${id},
      ${userId},
      ${requestCode},
      ${normalizeText(procedureCode, 120).toLowerCase()},
      ${normalizeText(procedureName, 160)},
      ${normalizeText(procedureCategory, 80)},
      ${DEFAULT_STATUS},
      ${normalizeText(summary, 500)},
      ${collectedData && typeof collectedData === "object" ? collectedData : {}},
      NOW()
    )
    RETURNING
      id,
      user_id,
      request_code,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      created_at,
      updated_at;
  `;

  return mapProcedureRequestRow(row);
}

export async function findProcedureRequestByIdentifier({ userId, identifier }) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const { idToken, requestCodeToken, shortCodeToken } = extractLookupTokens(identifier);
  if (!idToken && !requestCodeToken && !shortCodeToken) {
    return null;
  }

  if (requestCodeToken) {
    const [byCode] = await sql`
      SELECT
        id,
        user_id,
        request_code,
        procedure_code,
        procedure_name,
        procedure_category,
        status,
        summary,
        collected_data_json,
        created_at,
        updated_at
      FROM chatbot_procedure_requests
      WHERE user_id = ${userId}
        AND UPPER(request_code) = ${requestCodeToken}
      LIMIT 1;
    `;
    if (byCode) {
      return mapProcedureRequestRow(byCode);
    }
  }

  if (idToken) {
    const [byId] = await sql`
      SELECT
        id,
        user_id,
        request_code,
        procedure_code,
        procedure_name,
        procedure_category,
        status,
        summary,
        collected_data_json,
        created_at,
        updated_at
      FROM chatbot_procedure_requests
      WHERE user_id = ${userId}
        AND id = ${idToken}
      LIMIT 1;
    `;
    if (byId) {
      return mapProcedureRequestRow(byId);
    }
  }

  if (shortCodeToken) {
    const [byShort] = await sql`
      SELECT
        id,
        user_id,
        request_code,
        procedure_code,
        procedure_name,
        procedure_category,
        status,
        summary,
        collected_data_json,
        created_at,
        updated_at
      FROM chatbot_procedure_requests
      WHERE user_id = ${userId}
        AND UPPER(REPLACE(request_code, '-', '')) LIKE ('%' || ${shortCodeToken}::text || '%')
      ORDER BY updated_at DESC
      LIMIT 1;
    `;
    if (byShort) {
      return mapProcedureRequestRow(byShort);
    }
  }

  return null;
}

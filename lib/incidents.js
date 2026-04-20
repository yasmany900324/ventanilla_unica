import { randomUUID } from "crypto";
import { ensureAuthSchema } from "./auth";
import { ensureDatabase } from "./db";

const STATUS_FLOW = ["recibido", "en revision", "en proceso", "resuelto"];

export { STATUS_FLOW };

function mapIncidentRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    description: row.description,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStatusLookupIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function extractIncidentLookupTokens(identifier) {
  const normalized = normalizeStatusLookupIdentifier(identifier);
  if (!normalized) {
    return {
      idToken: "",
      shortToken: "",
    };
  }

  const withoutPrefix = normalized.replace(/^INC[-:#]?/u, "");
  const idToken = withoutPrefix.toLowerCase();
  const shortToken = withoutPrefix
    .replace(/[^A-F0-9]/gu, "")
    .slice(0, 8)
    .toLowerCase();

  return {
    idToken,
    shortToken,
  };
}

export async function ensureSchema() {
  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recibido',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `;

  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS user_id TEXT;
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS incidents_user_id_created_at_idx
    ON incidents (user_id, created_at DESC);
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'incidents_user_id_fkey'
      ) THEN
        ALTER TABLE incidents
        ADD CONSTRAINT incidents_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES citizens(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `;

  await sql`
    UPDATE incidents
    SET updated_at = created_at
    WHERE updated_at IS NULL;
  `;
}

export async function listIncidents(userId) {
  const sql = ensureDatabase();
  await ensureSchema();
  const rows = await sql`
    SELECT id, user_id, category, description, location, status, created_at, updated_at
    FROM incidents
    WHERE user_id = ${userId}
    ORDER BY created_at DESC;
  `;

  return rows.map((row) => mapIncidentRow(row));
}

export async function listIncidentsPaginated(
  userId,
  { page = 1, pageSize = 10 } = {}
) {
  const sql = ensureDatabase();
  await ensureSchema();

  const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
  const normalizedPageSize =
    Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const [countRow] = await sql`
    SELECT COUNT(*)::int AS total
    FROM incidents
    WHERE user_id = ${userId};
  `;

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const currentPage = Math.min(normalizedPage, totalPages);
  const currentOffset = (currentPage - 1) * normalizedPageSize;

  const rows = await sql`
    SELECT id, user_id, category, description, location, status, created_at, updated_at
    FROM incidents
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${normalizedPageSize}
    OFFSET ${currentOffset};
  `;

  return {
    incidents: rows.map((row) => mapIncidentRow(row)),
    pagination: {
      page: currentPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
    },
  };
}

export async function createIncident({ userId, category, description, location }) {
  const sql = ensureDatabase();
  const id = randomUUID();
  await ensureSchema();
  const [row] = await sql`
    INSERT INTO incidents (id, user_id, category, description, location, status, updated_at)
    VALUES (${id}, ${userId}, ${category}, ${description}, ${location}, 'recibido', NOW())
    RETURNING id, user_id, category, description, location, status, created_at, updated_at;
  `;

  return mapIncidentRow(row);
}

export async function advanceIncidentStatus(id, userId) {
  const sql = ensureDatabase();
  await ensureSchema();
  const [current] = await sql`
    SELECT id, user_id, category, description, location, status, created_at, updated_at
    FROM incidents
    WHERE id = ${id}
      AND user_id = ${userId}
    LIMIT 1;
  `;

  if (!current) {
    return null;
  }

  const currentIndex = STATUS_FLOW.indexOf(current.status);
  const nextIndex = Math.min(currentIndex + 1, STATUS_FLOW.length - 1);
  const nextStatus = STATUS_FLOW[nextIndex];

  const [updated] = await sql`
    UPDATE incidents
    SET status = ${nextStatus}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING id, user_id, category, description, location, status, created_at, updated_at;
  `;

  return mapIncidentRow(updated);
}

export async function findIncidentByIdentifier({ userId, identifier }) {
  const sql = ensureDatabase();
  await ensureSchema();
  const { idToken, shortToken } = extractIncidentLookupTokens(identifier);
  if (!idToken && !shortToken) {
    return null;
  }

  if (idToken) {
    const [byId] = await sql`
      SELECT id, user_id, category, description, location, status, created_at, updated_at
      FROM incidents
      WHERE user_id = ${userId}
        AND id = ${idToken}
      LIMIT 1;
    `;
    if (byId) {
      return mapIncidentRow(byId);
    }
  }

  if (shortToken) {
    const [byShortCode] = await sql`
      SELECT id, user_id, category, description, location, status, created_at, updated_at
      FROM incidents
      WHERE user_id = ${userId}
        AND LOWER(LEFT(id, 8)) = ${shortToken}
      ORDER BY updated_at DESC
      LIMIT 1;
    `;
    if (byShortCode) {
      return mapIncidentRow(byShortCode);
    }
  }

  return null;
}

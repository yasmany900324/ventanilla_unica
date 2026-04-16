import { randomUUID } from "crypto";
import { ensureAuthSchema } from "./auth";
import { ensureDatabase } from "./db";

const STATUS_FLOW = ["recibido", "en revision", "en proceso", "resuelto"];

export { STATUS_FLOW };

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

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    category: row.category,
    description: row.description,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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

  return {
    id: updated.id,
    userId: updated.user_id,
    category: updated.category,
    description: updated.description,
    location: updated.location,
    status: updated.status,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}

import postgres from "postgres";

const STATUS_FLOW = ["recibido", "en revision", "en proceso", "resuelto"];

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
const sql = connectionString ? postgres(connectionString, { ssl: "require" }) : null;

export { STATUS_FLOW };

export function hasDatabase() {
  return Boolean(sql);
}

export async function ensureSchema() {
  if (!sql) {
    throw new Error("Missing POSTGRES_URL or DATABASE_URL environment variable.");
  }

  await sql`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
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
    UPDATE incidents
    SET updated_at = created_at
    WHERE updated_at IS NULL;
  `;
}

export async function listIncidents() {
  if (!sql) {
    return [];
  }

  await ensureSchema();
  const rows = await sql`
    SELECT id, category, description, location, status, created_at, updated_at
    FROM incidents
    ORDER BY created_at DESC;
  `;

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    description: row.description,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createIncident({ category, description, location }) {
  if (!sql) {
    throw new Error("Database is not configured.");
  }

  const id = crypto.randomUUID();
  await ensureSchema();
  const [row] = await sql`
    INSERT INTO incidents (id, category, description, location, status, updated_at)
    VALUES (${id}, ${category}, ${description}, ${location}, 'recibido', NOW())
    RETURNING id, category, description, location, status, created_at, updated_at;
  `;

  return {
    id: row.id,
    category: row.category,
    description: row.description,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function advanceIncidentStatus(id) {
  if (!sql) {
    throw new Error("Database is not configured.");
  }

  await ensureSchema();
  const [current] = await sql`
    SELECT id, category, description, location, status, created_at, updated_at
    FROM incidents
    WHERE id = ${id}
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
    WHERE id = ${id}
    RETURNING id, category, description, location, status, created_at, updated_at;
  `;

  return {
    id: updated.id,
    category: updated.category,
    description: updated.description,
    location: updated.location,
    status: updated.status,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}

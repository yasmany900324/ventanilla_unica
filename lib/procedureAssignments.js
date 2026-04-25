import { randomUUID } from "crypto";
import { ensureDatabase, hasDatabase } from "./db";
import { ensureAuthSchema } from "./auth";
import { ensureProcedureCatalogSchema } from "./procedureCatalog";
import { ROLES } from "./roles";

function normalizeText(value, maxLength = 160) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeProcedureTypeIds(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((item) => normalizeText(item, 80)).filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values));
}

export async function ensureProcedureAssignmentsSchema() {
  if (!hasDatabase()) {
    return false;
  }
  const sql = ensureDatabase();
  await ensureAuthSchema();
  await ensureProcedureCatalogSchema();
  await sql`
    CREATE TABLE IF NOT EXISTS procedure_type_assignees (
      id TEXT PRIMARY KEY,
      procedure_type_id TEXT NOT NULL REFERENCES chatbot_procedure_catalog(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT REFERENCES citizens(id) ON DELETE SET NULL
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS procedure_type_assignees_unique_idx
    ON procedure_type_assignees (procedure_type_id, user_id);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS procedure_type_assignees_user_idx
    ON procedure_type_assignees (user_id);
  `;
  return true;
}

export async function listProcedureAssignmentsForAdmin() {
  const sql = ensureDatabase();
  await ensureProcedureAssignmentsSchema();

  const agents = await sql`
    SELECT
      c.id,
      c.full_name,
      c.email,
      c.created_at
    FROM citizens c
    WHERE EXISTS (
      SELECT 1
      FROM user_roles ur
      WHERE ur.user_id = c.id
        AND ur.role = ${ROLES.AGENT}
    )
    ORDER BY c.full_name ASC, c.created_at DESC;
  `;

  const procedureTypes = await sql`
    SELECT
      id,
      code,
      name,
      category,
      is_active
    FROM chatbot_procedure_catalog
    WHERE case_type = 'procedure'
      AND is_active = TRUE
    ORDER BY name ASC;
  `;

  const assignments = await sql`
    SELECT
      pta.user_id,
      pta.procedure_type_id
    FROM procedure_type_assignees pta
    INNER JOIN chatbot_procedure_catalog cpc
      ON cpc.id = pta.procedure_type_id
      AND cpc.case_type = 'procedure';
  `;

  const assignmentsByUserId = {};
  assignments.forEach((row) => {
    const userId = normalizeText(row?.user_id, 80);
    const procedureTypeId = normalizeText(row?.procedure_type_id, 80);
    if (!userId || !procedureTypeId) {
      return;
    }
    if (!assignmentsByUserId[userId]) {
      assignmentsByUserId[userId] = [];
    }
    assignmentsByUserId[userId].push(procedureTypeId);
  });

  return {
    agents: agents.map((row) => ({
      id: row.id,
      fullName: normalizeText(row.full_name, 200),
      email: normalizeText(row.email, 240),
      createdAt: row.created_at || null,
    })),
    procedureTypes: procedureTypes.map((row) => ({
      id: row.id,
      code: normalizeText(row.code, 120),
      name: normalizeText(row.name, 160),
      category: normalizeText(row.category, 120),
      isActive: row.is_active !== false,
    })),
    assignmentsByUserId: Object.fromEntries(
      Object.entries(assignmentsByUserId).map(([userId, ids]) => [userId, unique(ids)])
    ),
  };
}

export async function updateProcedureAssignmentsForAgent({
  adminUserId,
  agentUserId,
  procedureTypeIds,
}) {
  const sql = ensureDatabase();
  await ensureProcedureAssignmentsSchema();

  const normalizedAdminUserId = normalizeText(adminUserId, 80);
  const normalizedAgentUserId = normalizeText(agentUserId, 80);
  const normalizedIds = normalizeProcedureTypeIds(procedureTypeIds);

  if (!normalizedAdminUserId || !normalizedAgentUserId) {
    return { ok: false, status: 400, error: "Datos inválidos para actualizar asignaciones." };
  }
  if (!normalizedIds) {
    return { ok: false, status: 400, error: "procedureTypeIds debe ser un arreglo." };
  }
  if (unique(normalizedIds).length !== normalizedIds.length) {
    return { ok: false, status: 400, error: "No se permiten procedureTypeIds duplicados." };
  }

  const [targetUser] = await sql`
    SELECT id
    FROM citizens
    WHERE id = ${normalizedAgentUserId}
    LIMIT 1;
  `;
  if (!targetUser) {
    return { ok: false, status: 404, error: "El usuario no existe." };
  }

  const [targetAgentRole] = await sql`
    SELECT user_id
    FROM user_roles
    WHERE user_id = ${normalizedAgentUserId}
      AND role = ${ROLES.AGENT}
    LIMIT 1;
  `;
  if (!targetAgentRole) {
    return {
      ok: false,
      status: 409,
      error: "El usuario no tiene rol Funcionario.",
    };
  }

  if (normalizedIds.length > 0) {
    const existingProcedureRows = await sql`
      SELECT id, is_active
      FROM chatbot_procedure_catalog
      WHERE id = ANY(${normalizedIds}::text[])
        AND case_type = 'procedure';
    `;
    const existingIds = new Set(existingProcedureRows.map((row) => normalizeText(row.id, 80)));
    const missingIds = normalizedIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      return {
        ok: false,
        status: 400,
        error: "Hay tipos de procedimiento inválidos o inexistentes.",
      };
    }
    const inactiveAssigned = existingProcedureRows.filter((row) => row.is_active === false);
    if (inactiveAssigned.length > 0) {
      return {
        ok: false,
        status: 400,
        error: "Solo puedes asignar procedimientos activos.",
      };
    }
  }

  const result = await sql.begin(async (tx) => {
    const previousRows = await tx`
      SELECT procedure_type_id
      FROM procedure_type_assignees
      WHERE user_id = ${normalizedAgentUserId}
      ORDER BY procedure_type_id ASC;
    `;
    const previousProcedureTypeIds = unique(
      previousRows.map((row) => normalizeText(row.procedure_type_id, 80)).filter(Boolean)
    );

    await tx`
      DELETE FROM procedure_type_assignees
      WHERE user_id = ${normalizedAgentUserId};
    `;

    for (const procedureTypeId of normalizedIds) {
      await tx`
        INSERT INTO procedure_type_assignees (id, procedure_type_id, user_id, created_at, created_by)
        VALUES (${randomUUID()}, ${procedureTypeId}, ${normalizedAgentUserId}, NOW(), ${normalizedAdminUserId})
        ON CONFLICT (procedure_type_id, user_id) DO NOTHING;
      `;
    }

    return {
      previousProcedureTypeIds,
      newProcedureTypeIds: [...normalizedIds],
    };
  });

  console.info("[admin:procedure-assignments-change]", {
    admin_user_id: normalizedAdminUserId,
    agent_user_id: normalizedAgentUserId,
    previous_procedure_type_ids: result.previousProcedureTypeIds,
    new_procedure_type_ids: result.newProcedureTypeIds,
    changed_at: new Date().toISOString(),
  });

  return {
    ok: true,
    previousProcedureTypeIds: result.previousProcedureTypeIds,
    newProcedureTypeIds: result.newProcedureTypeIds,
  };
}

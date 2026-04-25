import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { ensureDatabase } from "./db";
import { ROLES } from "./roles";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_DURATION_IN_DAYS = 7;
const ALLOWED_ADMIN_USER_ROLES = new Set([ROLES.CITIZEN, ROLES.AGENT, ROLES.ADMIN]);

export const SESSION_COOKIE_NAME = "citizen_session";

function normalizeEmail(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function formatCitizen(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    cedula: row.cedula,
    email: row.email,
    role: normalizeRole(row.role),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function isEmail(value) {
  return EMAIL_PATTERN.test(value);
}

function normalizeRole(value) {
  if (typeof value !== "string") {
    return ROLES.CITIZEN;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === ROLES.ADMIN) {
    return ROLES.ADMIN;
  }
  if (normalized === ROLES.AGENT) {
    return ROLES.AGENT;
  }

  return ROLES.CITIZEN;
}

export function isAdministrator(user) {
  return normalizeRole(user?.role) === ROLES.ADMIN;
}

export function isFuncionario(user) {
  return normalizeRole(user?.role) === ROLES.AGENT;
}

export function isBackofficeUser(user) {
  return isAdministrator(user) || isFuncionario(user);
}

export async function requireFuncionario(request) {
  const authenticatedUser = await requireAuthenticatedUser(request);
  if (!isFuncionario(authenticatedUser)) {
    return null;
  }
  return authenticatedUser;
}

export async function requireBackofficeUser(request) {
  const authenticatedUser = await requireAuthenticatedUser(request);
  if (!isBackofficeUser(authenticatedUser)) {
    return null;
  }
  return authenticatedUser;
}

export function getSessionCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

export async function ensureAuthSchema() {
  const sql = ensureDatabase();

  await sql`
    CREATE TABLE IF NOT EXISTS citizens (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE,
      email TEXT UNIQUE,
      role TEXT NOT NULL DEFAULT 'ciudadano',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    ALTER TABLE citizens
    ADD COLUMN IF NOT EXISTS role TEXT;
  `;
  await sql`
    UPDATE citizens
    SET role = 'ciudadano'
    WHERE role IS NULL OR role = '';
  `;
  await sql`
    ALTER TABLE citizens
    ALTER COLUMN role SET DEFAULT 'ciudadano';
  `;
  await sql`
    ALTER TABLE citizens
    ALTER COLUMN role SET NOT NULL;
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
}

export async function registerCitizen({
  fullName,
  cedula,
  email,
  password,
  confirmPassword,
}) {
  const normalizedFullName = fullName?.trim();
  const normalizedCedula = cedula?.trim();
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = password?.trim();
  const normalizedConfirmPassword = confirmPassword?.trim();

  if (!normalizedFullName) {
    return { ok: false, status: 400, error: "El nombre completo es obligatorio." };
  }

  if (!normalizedCedula) {
    return { ok: false, status: 400, error: "La cedula es obligatoria." };
  }

  if (normalizedEmail && !isEmail(normalizedEmail)) {
    return {
      ok: false,
      status: 400,
      error: "El correo electrónico informado no tiene un formato válido.",
    };
  }

  if (!normalizedPassword) {
    return { ok: false, status: 400, error: "La contraseña es obligatoria." };
  }

  if (!normalizedConfirmPassword) {
    return { ok: false, status: 400, error: "Debes confirmar la contraseña." };
  }

  if (normalizedPassword !== normalizedConfirmPassword) {
    return {
      ok: false,
      status: 400,
      error: "La confirmación de contraseña no coincide.",
    };
  }

  if (normalizedPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: "La contraseña debe tener al menos 8 caracteres.",
    };
  }

  const sql = ensureDatabase();
  await ensureAuthSchema();

  const [existingByCedula] = await sql`
    SELECT id
    FROM citizens
    WHERE cedula = ${normalizedCedula}
    LIMIT 1;
  `;

  if (existingByCedula) {
    return {
      ok: false,
      status: 409,
      error: "La cedula ya se encuentra registrada.",
    };
  }

  if (normalizedEmail) {
    const [existingByEmail] = await sql`
      SELECT id
      FROM citizens
      WHERE email = ${normalizedEmail}
      LIMIT 1;
    `;

    if (existingByEmail) {
      return {
        ok: false,
        status: 409,
        error: "El correo electronico ya se encuentra registrado.",
      };
    }
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 12);
  const userId = randomUUID();

  const [row] = await sql`
    INSERT INTO citizens (id, full_name, cedula, email, role, password_hash, updated_at)
    VALUES (
      ${userId},
      ${normalizedFullName},
      ${normalizedCedula},
      ${normalizedEmail},
      ${ROLES.CITIZEN},
      ${passwordHash},
      NOW()
    )
    RETURNING id, full_name, cedula, email, role, created_at, updated_at;
  `;

  return { ok: true, citizen: formatCitizen(row) };
}

export async function loginCitizen({ identifier, password }) {
  const normalizedIdentifier = identifier?.trim();
  const normalizedPassword = password?.trim();

  if (!normalizedIdentifier || !normalizedPassword) {
    return {
      ok: false,
      status: 400,
      error: "Debes completar identificación y contraseña.",
    };
  }

  const sql = ensureDatabase();
  await ensureAuthSchema();

  const isIdentifierEmail = isEmail(normalizedIdentifier);
  const normalizedEmail = isIdentifierEmail
    ? normalizedIdentifier.toLowerCase()
    : null;

  const [row] = await sql`
    SELECT id, full_name, cedula, email, role, password_hash, created_at, updated_at
    FROM citizens
    WHERE ${
      isIdentifierEmail
        ? sql`email = ${normalizedEmail}`
        : sql`cedula = ${normalizedIdentifier}`
    }
    LIMIT 1;
  `;

  if (!row) {
    return {
      ok: false,
      status: 401,
      error: "La identificación o la contraseña no son correctas.",
    };
  }

  const matches = await bcrypt.compare(normalizedPassword, row.password_hash);
  if (!matches) {
    return {
      ok: false,
      status: 401,
      error: "La identificación o la contraseña no son correctas.",
    };
  }

  return { ok: true, citizen: formatCitizen(row) };
}

export async function createSession(userId) {
  const sql = ensureDatabase();
  await ensureAuthSchema();

  const sessionId = randomUUID();
  const token = randomBytes(48).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_IN_DAYS);

  await sql`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES (${sessionId}, ${userId}, ${tokenHash}, ${expiresAt.toISOString()});
  `;

  return { token, expiresAt };
}

export async function destroySessionByToken(token) {
  if (!token) {
    return;
  }

  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    DELETE FROM auth_sessions
    WHERE token_hash = ${hashToken(token)};
  `;
}

export async function getAuthenticatedUserFromToken(token) {
  if (!token) {
    return null;
  }

  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    DELETE FROM auth_sessions
    WHERE expires_at <= NOW();
  `;

  const tokenHash = hashToken(token);
  const [sessionRow] = await sql`
    SELECT
      citizens.id,
      citizens.full_name,
      citizens.cedula,
      citizens.email,
      citizens.role,
      citizens.created_at,
      citizens.updated_at,
      auth_sessions.token_hash
    FROM auth_sessions
    INNER JOIN citizens ON citizens.id = auth_sessions.user_id
    WHERE auth_sessions.expires_at > NOW()
      AND auth_sessions.token_hash = ${tokenHash}
    LIMIT 1;
  `;

  if (!sessionRow) {
    return null;
  }

  const storedHash = Buffer.from(sessionRow.token_hash, "utf8");
  const incomingHash = Buffer.from(tokenHash, "utf8");
  if (
    storedHash.length !== incomingHash.length ||
    !timingSafeEqual(storedHash, incomingHash)
  ) {
    return null;
  }

  return formatCitizen(sessionRow);
}

export async function requireAuthenticatedUser(request) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return getAuthenticatedUserFromToken(token);
}

export async function requireAdministrator(request) {
  const authenticatedUser = await requireAuthenticatedUser(request);
  if (!isAdministrator(authenticatedUser)) {
    return null;
  }

  return authenticatedUser;
}

function normalizeAdminUserQuery(value, maxLength = 160) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function listUsersForAdmin({
  search = "",
  role = "all",
  limit = 200,
} = {}) {
  const sql = ensureDatabase();
  await ensureAuthSchema();
  const normalizedSearch = normalizeAdminUserQuery(search, 120).toLowerCase();
  const normalizedRole = normalizeRole(role);
  const hasRoleFilter = normalizeAdminUserQuery(role, 30).toLowerCase() !== "all";
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 200;
  const rows = await sql`
    SELECT
      id,
      full_name,
      email,
      role,
      created_at
    FROM citizens
    WHERE
      (
        ${normalizedSearch}::text = ''
        OR LOWER(full_name) LIKE ('%' || ${normalizedSearch}::text || '%')
        OR LOWER(COALESCE(email, '')) LIKE ('%' || ${normalizedSearch}::text || '%')
      )
      AND (
        ${hasRoleFilter} = FALSE
        OR role = ${normalizedRole}
      )
    ORDER BY created_at DESC, full_name ASC
    LIMIT ${safeLimit};
  `;
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email || "",
    role: normalizeRole(row.role),
    createdAt: row.created_at || null,
  }));
}

export async function updateUserRoleByAdministrator({
  adminUserId,
  targetUserId,
  nextRole,
}) {
  const sql = ensureDatabase();
  await ensureAuthSchema();
  const normalizedAdminId = normalizeAdminUserQuery(adminUserId, 80);
  const normalizedTargetId = normalizeAdminUserQuery(targetUserId, 80);
  const normalizedNextRole = normalizeRole(nextRole);

  if (!normalizedAdminId || !normalizedTargetId) {
    return { ok: false, status: 400, error: "Datos inválidos para actualizar rol." };
  }
  if (!ALLOWED_ADMIN_USER_ROLES.has(normalizedNextRole)) {
    return { ok: false, status: 400, error: "El rol informado no es válido." };
  }

  const [targetUser] = await sql`
    SELECT id, role
    FROM citizens
    WHERE id = ${normalizedTargetId}
    LIMIT 1;
  `;
  if (!targetUser) {
    return { ok: false, status: 404, error: "El usuario objetivo no existe." };
  }

  const previousRole = normalizeRole(targetUser.role);
  if (previousRole === normalizedNextRole) {
    return {
      ok: true,
      unchanged: true,
      user: { id: normalizedTargetId, role: previousRole },
    };
  }

  if (previousRole === ROLES.ADMIN && normalizedNextRole !== ROLES.ADMIN) {
    const [adminCountRow] = await sql`
      SELECT COUNT(*)::int AS total
      FROM citizens
      WHERE role = ${ROLES.ADMIN};
    `;
    const adminCount = Number(adminCountRow?.total || 0);
    if (adminCount <= 1) {
      return {
        ok: false,
        status: 409,
        error: "No se puede degradar al último administrador del sistema.",
      };
    }
  }

  const [updatedUser] = await sql`
    UPDATE citizens
    SET role = ${normalizedNextRole}, updated_at = NOW()
    WHERE id = ${normalizedTargetId}
    RETURNING id, full_name, email, role, created_at;
  `;
  if (!updatedUser) {
    return { ok: false, status: 404, error: "El usuario objetivo no existe." };
  }

  // TODO: Persist this action in an audit table when available.
  console.info("[admin:user-role-change]", {
    admin_user_id: normalizedAdminId,
    target_user_id: normalizedTargetId,
    previous_role: previousRole,
    new_role: normalizedNextRole,
    changed_at: new Date().toISOString(),
  });

  return {
    ok: true,
    unchanged: false,
    user: {
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      email: updatedUser.email || "",
      role: normalizeRole(updatedUser.role),
      createdAt: updatedUser.created_at || null,
    },
  };
}

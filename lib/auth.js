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

function normalizeRolesArray(value, { ensureCitizen = true } = {}) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = Array.from(
    new Set(
      raw
        .map((role) => normalizeRole(role))
        .filter((role) => ALLOWED_ADMIN_USER_ROLES.has(role))
    )
  );
  if (ensureCitizen && !normalized.includes(ROLES.CITIZEN)) {
    normalized.unshift(ROLES.CITIZEN);
  }
  return normalized.length ? normalized : [ROLES.CITIZEN];
}

function deriveLegacyRoleFromRoles(roles) {
  const normalized = normalizeRolesArray(roles);
  if (normalized.includes(ROLES.ADMIN)) {
    return ROLES.ADMIN;
  }
  if (normalized.includes(ROLES.AGENT)) {
    return ROLES.AGENT;
  }
  return ROLES.CITIZEN;
}

function formatCitizen(row) {
  const rolesFromRow =
    Array.isArray(row?.roles) && row.roles.length > 0
      ? row.roles
      : [row?.role];
  const roles = normalizeRolesArray(rolesFromRow);
  return {
    id: row.id,
    fullName: row.full_name,
    cedula: row.cedula,
    email: row.email,
    role: deriveLegacyRoleFromRoles(roles),
    roles,
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
  return userHasRole(user, ROLES.ADMIN);
}

export function isFuncionario(user) {
  return userHasRole(user, ROLES.AGENT);
}

export function userHasRole(user, role) {
  const target = normalizeRole(role);
  const roles = normalizeRolesArray(
    Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role]
  );
  return roles.includes(target);
}

export function userHasAnyRole(user, roles) {
  const allowed = Array.isArray(roles) ? roles : [];
  return allowed.some((role) => userHasRole(user, role));
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
  await sql`
    CREATE TABLE IF NOT EXISTS user_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT REFERENCES citizens(id) ON DELETE SET NULL
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_unique_idx
    ON user_roles (user_id, role);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_roles_role_idx
    ON user_roles (role);
  `;
  await sql`
    INSERT INTO user_roles (id, user_id, role, created_at, created_by)
    SELECT md5(c.id || ':ciudadano'), c.id, 'ciudadano', NOW(), NULL
    FROM citizens c
    ON CONFLICT (user_id, role) DO NOTHING;
  `;
  await sql`
    INSERT INTO user_roles (id, user_id, role, created_at, created_by)
    SELECT md5(c.id || ':' || c.role), c.id, c.role, NOW(), NULL
    FROM citizens c
    WHERE c.role IN ('agente', 'administrador')
    ON CONFLICT (user_id, role) DO NOTHING;
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
  await sql`
    INSERT INTO user_roles (id, user_id, role, created_at, created_by)
    VALUES (${createHash("md5").update(`${userId}:${ROLES.CITIZEN}`).digest("hex")}, ${userId}, ${ROLES.CITIZEN}, NOW(), NULL)
    ON CONFLICT (user_id, role) DO NOTHING;
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
      COALESCE(
        ARRAY(
          SELECT ur.role
          FROM user_roles ur
          WHERE ur.user_id = citizens.id
          ORDER BY ur.role ASC
        ),
        ARRAY[]::text[]
      ) AS roles,
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
      c.id,
      c.full_name,
      c.email,
      c.role,
      c.created_at,
      COALESCE(
        ARRAY(
          SELECT ur.role
          FROM user_roles ur
          WHERE ur.user_id = c.id
          ORDER BY ur.role ASC
        ),
        ARRAY[]::text[]
      ) AS roles
    FROM citizens c
    WHERE
      (
        ${normalizedSearch}::text = ''
        OR LOWER(c.full_name) LIKE ('%' || ${normalizedSearch}::text || '%')
        OR LOWER(COALESCE(c.email, '')) LIKE ('%' || ${normalizedSearch}::text || '%')
      )
      AND (
        ${hasRoleFilter} = FALSE
        OR EXISTS (
          SELECT 1
          FROM user_roles urf
          WHERE urf.user_id = c.id
            AND urf.role = ${normalizedRole}
        )
      )
    ORDER BY c.created_at DESC, c.full_name ASC
    LIMIT ${safeLimit};
  `;
  return rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email || "",
    role: deriveLegacyRoleFromRoles(row.roles),
    roles: normalizeRolesArray(row.roles),
    createdAt: row.created_at || null,
  }));
}

export async function updateUserRolesByAdministrator({
  adminUserId,
  targetUserId,
  roles,
}) {
  const sql = ensureDatabase();
  await ensureAuthSchema();
  const normalizedAdminId = normalizeAdminUserQuery(adminUserId, 80);
  const normalizedTargetId = normalizeAdminUserQuery(targetUserId, 80);
  const normalizedNextRoles = normalizeRolesArray(roles);

  if (!normalizedAdminId || !normalizedTargetId) {
    return { ok: false, status: 400, error: "Datos inválidos para actualizar rol." };
  }
  if (!Array.isArray(roles)) {
    return { ok: false, status: 400, error: "Debes enviar un arreglo de roles válido." };
  }
  if (!normalizedNextRoles.every((role) => ALLOWED_ADMIN_USER_ROLES.has(role))) {
    return { ok: false, status: 400, error: "Hay uno o más roles inválidos." };
  }
  if (!normalizedNextRoles.includes(ROLES.CITIZEN)) {
    return { ok: false, status: 400, error: "Todo usuario debe incluir el rol ciudadano." };
  }

  const [targetUser] = await sql`
    SELECT id, role,
      COALESCE(
        ARRAY(
          SELECT ur.role
          FROM user_roles ur
          WHERE ur.user_id = citizens.id
          ORDER BY ur.role ASC
        ),
        ARRAY[]::text[]
      ) AS roles
    FROM citizens
    WHERE id = ${normalizedTargetId}
    LIMIT 1;
  `;
  if (!targetUser) {
    return { ok: false, status: 404, error: "El usuario objetivo no existe." };
  }

  const previousRoles = normalizeRolesArray(targetUser.roles);
  const previousRolesKey = previousRoles.join("|");
  const nextRolesKey = normalizedNextRoles.join("|");
  if (previousRolesKey === nextRolesKey) {
    return {
      ok: true,
      unchanged: true,
      user: { id: normalizedTargetId, role: deriveLegacyRoleFromRoles(previousRoles), roles: previousRoles },
    };
  }

  if (previousRoles.includes(ROLES.ADMIN) && !normalizedNextRoles.includes(ROLES.ADMIN)) {
    const [adminCountRow] = await sql`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT user_id
        FROM user_roles
        WHERE role = ${ROLES.ADMIN}
      ) AS admins;
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

  await sql`DELETE FROM user_roles WHERE user_id = ${normalizedTargetId};`;
  for (const role of normalizedNextRoles) {
    await sql`
      INSERT INTO user_roles (id, user_id, role, created_at, created_by)
      VALUES (${randomUUID()}, ${normalizedTargetId}, ${role}, NOW(), ${normalizedAdminId})
      ON CONFLICT (user_id, role) DO NOTHING;
    `;
  }
  const nextLegacyRole = deriveLegacyRoleFromRoles(normalizedNextRoles);
  const [updatedUser] = await sql`
    UPDATE citizens
    SET role = ${nextLegacyRole}, updated_at = NOW()
    WHERE id = ${normalizedTargetId}
    RETURNING id, full_name, email, role, created_at,
      COALESCE(
        ARRAY(
          SELECT ur.role
          FROM user_roles ur
          WHERE ur.user_id = citizens.id
          ORDER BY ur.role ASC
        ),
        ARRAY[]::text[]
      ) AS roles;
  `;
  if (!updatedUser) {
    return { ok: false, status: 404, error: "El usuario objetivo no existe." };
  }

  // TODO: Persist this action in an audit table when available.
  console.info("[admin:user-roles-change]", {
    admin_user_id: normalizedAdminId,
    target_user_id: normalizedTargetId,
    previous_roles: previousRoles,
    new_roles: normalizedNextRoles,
    changed_at: new Date().toISOString(),
  });

  return {
    ok: true,
    unchanged: false,
    user: {
      id: updatedUser.id,
      fullName: updatedUser.full_name,
      email: updatedUser.email || "",
      role: deriveLegacyRoleFromRoles(updatedUser.roles),
      roles: normalizeRolesArray(updatedUser.roles),
      createdAt: updatedUser.created_at || null,
    },
  };
}

// Backward compatible wrapper for old single-role API callers.
export async function updateUserRoleByAdministrator({ adminUserId, targetUserId, nextRole }) {
  const normalized = normalizeRole(nextRole);
  const nextRoles = normalizeRolesArray(
    normalized === ROLES.CITIZEN ? [ROLES.CITIZEN] : [ROLES.CITIZEN, normalized]
  );
  return updateUserRolesByAdministrator({
    adminUserId,
    targetUserId,
    roles: nextRoles,
  });
}

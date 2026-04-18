import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { ensureDatabase } from "./db";
import { ROLES } from "./roles";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_DURATION_IN_DAYS = 7;

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
      error: "El correo electronico informado no tiene un formato valido.",
    };
  }

  if (!normalizedPassword) {
    return { ok: false, status: 400, error: "La contrasena es obligatoria." };
  }

  if (!normalizedConfirmPassword) {
    return { ok: false, status: 400, error: "Debes confirmar la contrasena." };
  }

  if (normalizedPassword !== normalizedConfirmPassword) {
    return {
      ok: false,
      status: 400,
      error: "La confirmacion de contrasena no coincide.",
    };
  }

  if (normalizedPassword.length < 8) {
    return {
      ok: false,
      status: 400,
      error: "La contrasena debe tener al menos 8 caracteres.",
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
      error: "Debes completar identificacion y contrasena.",
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
      error: "La identificacion o la contrasena no son correctas.",
    };
  }

  const matches = await bcrypt.compare(normalizedPassword, row.password_hash);
  if (!matches) {
    return {
      ok: false,
      status: 401,
      error: "La identificacion o la contrasena no son correctas.",
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

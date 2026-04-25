-- Multi-role support for citizens/users
-- Source of truth: user_roles
-- Legacy compatibility: citizens.role is still maintained.

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT REFERENCES citizens(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_unique_idx
  ON user_roles (user_id, role);

CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON user_roles (role);

-- Backfill from legacy citizens.role
INSERT INTO user_roles (id, user_id, role, created_at, created_by)
SELECT md5(c.id || ':ciudadano'), c.id, 'ciudadano', NOW(), NULL
FROM citizens c
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO user_roles (id, user_id, role, created_at, created_by)
SELECT md5(c.id || ':' || c.role), c.id, c.role, NOW(), NULL
FROM citizens c
WHERE c.role IN ('agente', 'administrador')
ON CONFLICT (user_id, role) DO NOTHING;

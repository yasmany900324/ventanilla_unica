-- Assignment of procedure types to funcionarios (role: agente)
-- This relation enables eligibility per procedure type.
-- It does NOT replace task_assignee_id (concrete expediente assignment).

CREATE TABLE IF NOT EXISTS procedure_type_assignees (
  id TEXT PRIMARY KEY,
  procedure_type_id TEXT NOT NULL REFERENCES chatbot_procedure_catalog(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT REFERENCES citizens(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS procedure_type_assignees_unique_idx
  ON procedure_type_assignees (procedure_type_id, user_id);

CREATE INDEX IF NOT EXISTS procedure_type_assignees_user_idx
  ON procedure_type_assignees (user_id);

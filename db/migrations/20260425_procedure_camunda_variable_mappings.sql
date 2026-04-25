-- Configurable layer between procedure catalog and Camunda variables.

BEGIN;

ALTER TABLE public.chatbot_procedure_catalog
  ADD COLUMN IF NOT EXISTS version TEXT;

CREATE TABLE IF NOT EXISTS public.chatbot_procedure_fields (
  id TEXT PRIMARY KEY,
  procedure_type_id TEXT NOT NULL REFERENCES public.chatbot_procedure_catalog(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS chatbot_procedure_fields_type_key_unique
  ON public.chatbot_procedure_fields (procedure_type_id, field_key);

CREATE INDEX IF NOT EXISTS chatbot_procedure_fields_type_order_idx
  ON public.chatbot_procedure_fields (procedure_type_id, field_order ASC);

CREATE TABLE IF NOT EXISTS public.chatbot_procedure_camunda_variable_mappings (
  id TEXT PRIMARY KEY,
  procedure_type_id TEXT NOT NULL REFERENCES public.chatbot_procedure_catalog(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  camunda_task_definition_key TEXT,
  procedure_field_key TEXT NOT NULL,
  camunda_variable_name TEXT NOT NULL,
  camunda_variable_type TEXT NOT NULL DEFAULT 'string',
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chatbot_proc_camunda_map_scope_idx
  ON public.chatbot_procedure_camunda_variable_mappings (
    procedure_type_id,
    scope,
    camunda_task_definition_key
  );

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS procedure_type_id TEXT REFERENCES public.chatbot_procedure_catalog(id) ON DELETE SET NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_process_instance_key TEXT;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_task_definition_key TEXT;

COMMIT;

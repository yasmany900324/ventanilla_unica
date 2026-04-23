-- Safe migration: unify chatbot catalog for incidents + procedures
-- Backward compatible: additive columns, nullable/defaults, no renames/drops.

BEGIN;

ALTER TABLE chatbot_procedure_catalog
  ADD COLUMN IF NOT EXISTS case_type TEXT;

UPDATE chatbot_procedure_catalog
SET case_type = 'procedure'
WHERE case_type IS NULL OR BTRIM(case_type) = '';

ALTER TABLE chatbot_procedure_catalog
  ALTER COLUMN case_type SET DEFAULT 'procedure';

ALTER TABLE chatbot_procedure_catalog
  ALTER COLUMN case_type SET NOT NULL;

ALTER TABLE chatbot_procedure_catalog
  ADD COLUMN IF NOT EXISTS camunda_process_id TEXT;

ALTER TABLE chatbot_procedure_catalog
  ADD COLUMN IF NOT EXISTS version TEXT;

ALTER TABLE chatbot_procedure_catalog
  ADD COLUMN IF NOT EXISTS metadata_json JSONB;

UPDATE chatbot_procedure_catalog
SET metadata_json = '{}'::jsonb
WHERE metadata_json IS NULL;

ALTER TABLE chatbot_procedure_catalog
  ALTER COLUMN metadata_json SET DEFAULT '{}'::jsonb;

ALTER TABLE chatbot_procedure_catalog
  ALTER COLUMN metadata_json SET NOT NULL;

CREATE INDEX IF NOT EXISTS chatbot_procedure_catalog_case_type_active_idx
  ON chatbot_procedure_catalog (case_type, is_active, updated_at DESC);

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS catalog_item_id TEXT;

CREATE INDEX IF NOT EXISTS incidents_catalog_item_id_idx
  ON incidents (catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.chatbot_procedure_catalog') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'incidents_catalog_item_id_fkey'
     ) THEN
    -- NOT VALID avoids a full table scan now; validate later in a controlled window.
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_catalog_item_id_fkey
      FOREIGN KEY (catalog_item_id)
      REFERENCES chatbot_procedure_catalog(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

ALTER TABLE camunda_case_links
  ADD COLUMN IF NOT EXISTS catalog_item_id TEXT;

COMMIT;

-- Seed incident catalog item only when missing.
INSERT INTO chatbot_procedure_catalog (
  id,
  code,
  name,
  description,
  category,
  case_type,
  aliases_json,
  keywords_json,
  is_active,
  required_fields_json,
  flow_definition_json,
  camunda_process_id,
  metadata_json,
  updated_at
)
VALUES (
  'catalog-inc-arbol-caido',
  'inc_arbol_caido',
  'Árbol caído o ramas peligrosas',
  'Reporte ciudadano por árbol caído, ramas peligrosas u obstrucción en vía pública',
  'incidencias',
  'incident',
  '["árbol caído","arbol caido","rama caída","ramas peligrosas"]'::jsonb,
  '["árbol","rama","caído","peligro","calle","vereda"]'::jsonb,
  TRUE,
  '[
    {"key":"location","label":"ubicación","prompt":"Indicá la ubicación exacta o referencia del árbol/rama.","type":"text","required":true},
    {"key":"description","label":"descripción","prompt":"Contame qué está pasando con el árbol o las ramas.","type":"text","required":true},
    {"key":"risk","label":"riesgo","prompt":"Indicá el nivel de riesgo (alto, medio o bajo).","type":"select","required":true,"options":["alto","medio","bajo"]}
  ]'::jsonb,
  '{"completionMessage":"Ya registré la información base de la incidencia. Ahora vamos a confirmar los datos para enviarla."}'::jsonb,
  'seguimiento_incidencia',
  '{}'::jsonb,
  NOW()
)
ON CONFLICT (code) DO NOTHING;

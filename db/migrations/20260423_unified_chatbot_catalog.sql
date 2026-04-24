-- Safe migration: unify chatbot catalog for incidents + procedures
-- Backward compatible: additive columns, nullable/defaults, no renames/drops.
--
-- Nota (Neon / drivers): algunos clientes ejecutan SQL como "prepared statement" y
-- fallan si el script contiene múltiples comandos top-level separados por `;`.
-- Este archivo queda como UN SOLO statement (bloque DO) para evitar:
-- "cannot insert multiple commands into a prepared statement".

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chatbot_procedure_catalog'
      AND column_name = 'case_type'
  ) IS FALSE THEN
    EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ADD COLUMN case_type TEXT';
  END IF;

  EXECUTE $sql$
    UPDATE public.chatbot_procedure_catalog
    SET case_type = 'procedure'
    WHERE case_type IS NULL OR BTRIM(case_type) = ''
  $sql$;

  EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ALTER COLUMN case_type SET DEFAULT ''procedure''';
  EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ALTER COLUMN case_type SET NOT NULL';

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chatbot_procedure_catalog'
      AND column_name = 'camunda_process_id'
  ) IS FALSE THEN
    EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ADD COLUMN camunda_process_id TEXT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chatbot_procedure_catalog'
      AND column_name = 'version'
  ) IS FALSE THEN
    EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ADD COLUMN version TEXT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chatbot_procedure_catalog'
      AND column_name = 'metadata_json'
  ) IS FALSE THEN
    EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ADD COLUMN metadata_json JSONB';
  END IF;

  EXECUTE $sql$
    UPDATE public.chatbot_procedure_catalog
    SET metadata_json = '{}'::jsonb
    WHERE metadata_json IS NULL
  $sql$;

  EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ALTER COLUMN metadata_json SET DEFAULT ''{}''::jsonb';
  EXECUTE 'ALTER TABLE public.chatbot_procedure_catalog ALTER COLUMN metadata_json SET NOT NULL';

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND c.relname = 'chatbot_procedure_catalog_case_type_active_idx'
  ) IS FALSE THEN
    EXECUTE $sql$
      CREATE INDEX chatbot_procedure_catalog_case_type_active_idx
      ON public.chatbot_procedure_catalog (case_type, is_active, updated_at DESC)
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'incidents'
      AND column_name = 'catalog_item_id'
  ) IS FALSE THEN
    EXECUTE 'ALTER TABLE public.incidents ADD COLUMN catalog_item_id TEXT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND c.relname = 'incidents_catalog_item_id_idx'
  ) IS FALSE THEN
    EXECUTE $sql$
      CREATE INDEX incidents_catalog_item_id_idx
      ON public.incidents (catalog_item_id)
      WHERE catalog_item_id IS NOT NULL
    $sql$;
  END IF;

  IF to_regclass('public.chatbot_procedure_catalog') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'incidents_catalog_item_id_fkey'
     ) THEN
    -- NOT VALID avoids a full table scan now; validate later in a controlled window.
    EXECUTE $sql$
      ALTER TABLE public.incidents
      ADD CONSTRAINT incidents_catalog_item_id_fkey
      FOREIGN KEY (catalog_item_id)
      REFERENCES public.chatbot_procedure_catalog(id)
      ON DELETE SET NULL
      NOT VALID
    $sql$;
  END IF;

  -- En algunos entornos la tabla aún no existe hasta que el runtime ejecute
  -- `ensureCamundaCaseLinkSchema()` (p.ej. primera sync Camunda). No fallar acá.
  IF to_regclass('public.camunda_case_links') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'camunda_case_links'
        AND column_name = 'catalog_item_id'
    ) IS FALSE THEN
      EXECUTE 'ALTER TABLE public.camunda_case_links ADD COLUMN catalog_item_id TEXT';
    END IF;
  END IF;

  -- Seed canonical procedure row for chatbot reports only when missing.
  INSERT INTO public.chatbot_procedure_catalog (
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
    'catalog-proc-registrar-incidencia',
    'registrar_incidencia',
    'Registrar incidencia',
    'Permite reportar problemas o incidencias desde web o WhatsApp.',
    'Incidencia',
    'procedure',
    '["registrar incidencia","reportar incidencia","reportar problema","arbol caido"]'::jsonb,
    '["incidencia","reporte","problema","arbol","caido","whatsapp","web"]'::jsonb,
    TRUE,
    '[
      {"key":"description","label":"Descripción","prompt":"Contame qué está pasando para registrar la incidencia.","type":"text","required":true},
      {"key":"photo","label":"Foto","prompt":"Adjuntá una foto para complementar el reporte (si disponés de una).","type":"image","required":true},
      {"key":"location","label":"Ubicación","prompt":"Indicá la ubicación de la incidencia.","type":"location","required":true}
    ]'::jsonb,
    '{"completionMessage":"Listo: registré la solicitud de Registrar incidencia."}'::jsonb,
    'Process_1hvmc45',
    '{}'::jsonb,
    NOW()
  )
  ON CONFLICT (code) DO NOTHING;
END $$;

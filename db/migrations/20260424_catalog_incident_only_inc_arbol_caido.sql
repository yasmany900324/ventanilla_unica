-- Catalog cleanup for incident-only test stage (safe + idempotent).
-- Goal: leave a single active catalog item: INC_ARBOL_CAIDO.
-- Non-destructive policy: no DELETE, only deactivation + upsert.
--
-- Nota:
-- - Se ejecuta como UN SOLO statement para compatibilidad con clientes
--   que envían SQL como prepared statement.
-- - Este script NO modifica lógica de negocio ni otras tablas, salvo lectura
--   para métricas de referencia.

DO $$
DECLARE
  v_target_code CONSTANT TEXT := 'inc_arbol_caido';
  v_target_id CONSTANT TEXT := 'catalog-inc-arbol-caido';
  v_active_before INTEGER := 0;
  v_active_after INTEGER := 0;
  v_incident_refs INTEGER := 0;
  v_camunda_refs INTEGER := 0;
  v_session_refs INTEGER := 0;
BEGIN
  IF to_regclass('public.chatbot_procedure_catalog') IS NULL THEN
    RAISE EXCEPTION 'Table public.chatbot_procedure_catalog does not exist';
  END IF;

  SELECT COUNT(*)::int
  INTO v_active_before
  FROM public.chatbot_procedure_catalog
  WHERE is_active = TRUE;

  -- Reference check: incidents.catalog_item_id
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'incidents'
      AND column_name = 'catalog_item_id'
  ) THEN
    SELECT COUNT(*)::int
    INTO v_incident_refs
    FROM public.incidents i
    WHERE i.catalog_item_id IS NOT NULL;
  END IF;

  -- Reference check: camunda_case_links.catalog_item_id
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'camunda_case_links'
      AND column_name = 'catalog_item_id'
  ) THEN
    SELECT COUNT(*)::int
    INTO v_camunda_refs
    FROM public.camunda_case_links c
    WHERE c.catalog_item_id IS NOT NULL;
  END IF;

  -- Reference check: chatbot sessions JSON payload with catalog item id.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chatbot_sessions'
      AND column_name = 'collected_data_json'
  ) THEN
    SELECT COUNT(*)::int
    INTO v_session_refs
    FROM public.chatbot_sessions s
    WHERE s.collected_data_json ? 'catalogItemId'
      AND COALESCE(NULLIF(BTRIM(s.collected_data_json->>'catalogItemId'), ''), '') <> '';
  END IF;

  -- Safe cleanup policy: deactivate all existing catalog rows first.
  UPDATE public.chatbot_procedure_catalog
  SET is_active = FALSE,
      updated_at = NOW();

  -- Upsert target incident item as the only active entry.
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
    updated_at
  )
  VALUES (
    v_target_id,
    v_target_code,
    'Árbol caído o ramas peligrosas',
    'Reporte ciudadano de árbol caído, ramas peligrosas u obstrucción en vía pública',
    'incidencias',
    'incident',
    '["árbol caído","arbol caido","rama caída","ramas peligrosas","árbol en la calle","arbol en la calle"]'::jsonb,
    '["árbol","arbol","rama","caído","caido","peligro","calle","vereda"]'::jsonb,
    TRUE,
    '{"description": true, "location": true, "evidence": true}'::jsonb,
    '{}'::jsonb,
    'seguimiento_incidencia',
    NOW()
  )
  ON CONFLICT (code)
  DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    case_type = EXCLUDED.case_type,
    aliases_json = EXCLUDED.aliases_json,
    keywords_json = EXCLUDED.keywords_json,
    is_active = TRUE,
    required_fields_json = EXCLUDED.required_fields_json,
    flow_definition_json = EXCLUDED.flow_definition_json,
    camunda_process_id = EXCLUDED.camunda_process_id,
    updated_at = NOW();

  -- Hard guarantee: only target remains active.
  UPDATE public.chatbot_procedure_catalog
  SET is_active = FALSE,
      updated_at = NOW()
  WHERE LOWER(code) <> v_target_code
    AND is_active = TRUE;

  SELECT COUNT(*)::int
  INTO v_active_after
  FROM public.chatbot_procedure_catalog
  WHERE is_active = TRUE;

  RAISE NOTICE '[catalog_cleanup] active_before=% active_after=% incidents_refs=% camunda_refs=% session_refs=%',
    v_active_before, v_active_after, v_incident_refs, v_camunda_refs, v_session_refs;
END $$;

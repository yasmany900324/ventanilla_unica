-- Procedure-only catalog consolidation for chatbot operations.
-- Source of truth: chatbot_procedure_catalog with case_type = 'procedure'.
-- Policy:
-- - Keep historical incident rows (no DELETE), but force them inactive.
-- - Ensure a canonical active procedure row exists for chatbot reports.
-- - Prevent active incident rows after migration.
--
-- NOTE: single DO block for compatibility with drivers using prepared statements.

DO $$
DECLARE
  v_target_code CONSTANT TEXT := 'registrar_incidencia';
  v_target_id CONSTANT TEXT := 'catalog-proc-registrar-incidencia';
  v_target_camunda_process_id CONSTANT TEXT := 'Process_1hvmc45';
  v_active_incident_count INTEGER := 0;
BEGIN
  IF to_regclass('public.chatbot_procedure_catalog') IS NULL THEN
    RAISE EXCEPTION 'Table public.chatbot_procedure_catalog does not exist';
  END IF;

  -- 1) Deactivate all legacy incident rows (historical trace preserved).
  UPDATE public.chatbot_procedure_catalog
  SET is_active = FALSE,
      updated_at = NOW()
  WHERE case_type = 'incident'
    AND is_active = TRUE;

  -- 2) Ensure canonical procedure row for citizen reports is active.
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
    enabled_channels_json,
    metadata_json,
    updated_at
  )
  VALUES (
    v_target_id,
    v_target_code,
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
    v_target_camunda_process_id,
    '["web","whatsapp"]'::jsonb,
    '{}'::jsonb,
    NOW()
  )
  ON CONFLICT (code)
  DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    case_type = 'procedure',
    aliases_json = EXCLUDED.aliases_json,
    keywords_json = EXCLUDED.keywords_json,
    is_active = TRUE,
    required_fields_json = EXCLUDED.required_fields_json,
    flow_definition_json = EXCLUDED.flow_definition_json,
    camunda_process_id = EXCLUDED.camunda_process_id,
    enabled_channels_json = COALESCE(EXCLUDED.enabled_channels_json, '["web","whatsapp"]'::jsonb),
    metadata_json = COALESCE(EXCLUDED.metadata_json, '{}'::jsonb),
    updated_at = NOW();

  -- 3) Hard guard: no active incident rows allowed after consolidation.
  SELECT COUNT(*)::int
  INTO v_active_incident_count
  FROM public.chatbot_procedure_catalog
  WHERE case_type = 'incident'
    AND is_active = TRUE;

  IF v_active_incident_count > 0 THEN
    RAISE EXCEPTION
      '[procedure_only_catalog] invariant failed: % active incident rows remain',
      v_active_incident_count;
  END IF;

  RAISE NOTICE
    '[procedure_only_catalog] consolidation complete. active_incident_rows=% (expected 0).',
    v_active_incident_count;
END $$;

-- Diagnostic query (post-migration):
-- SELECT id, code, name, case_type, is_active, camunda_process_id
-- FROM chatbot_procedure_catalog
-- WHERE is_active = TRUE
-- ORDER BY case_type, code;

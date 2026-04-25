-- Seed inicial de taskUiDictionary para el procedimiento de incidencias.
-- Toma taskDefinitionKey reales desde mappings COMPLETE_TASK y tareas ya vistas en expedientes.
-- Solo aplica si el procedimiento aún no tiene taskUiDictionary configurado.
--
-- Nota: este archivo es una sola sentencia SQL (sin BEGIN/COMMIT). Varios clientes ejecutan el
-- archivo como una única prepared statement y PostgreSQL rechaza varios comandos en una sola
-- consulta preparada ("cannot insert multiple commands into a prepared statement").

WITH incident_proc AS (
  SELECT
    c.id,
    COALESCE(c.flow_definition_json, '{}'::jsonb) AS flow_definition_json
  FROM chatbot_procedure_catalog c
  WHERE c.case_type = 'procedure'
    AND c.code = 'registrar_incidencia'
  LIMIT 1
),
existing_dict AS (
  SELECT
    p.id,
    CASE
      WHEN jsonb_typeof(p.flow_definition_json -> 'taskUiDictionary') = 'array'
        THEN jsonb_array_length(p.flow_definition_json -> 'taskUiDictionary')
      WHEN jsonb_typeof(p.flow_definition_json -> 'taskUiDictionary') = 'object'
        THEN (
          SELECT COUNT(*)::int
          FROM jsonb_object_keys(p.flow_definition_json -> 'taskUiDictionary') AS _k
        )
      ELSE 0
    END AS dict_size
  FROM incident_proc p
),
task_keys AS (
  SELECT DISTINCT TRIM(m.camunda_task_definition_key) AS task_key
  FROM incident_proc p
  JOIN chatbot_procedure_camunda_variable_mappings m
    ON m.procedure_type_id = p.id
  WHERE m.scope = 'COMPLETE_TASK'
    AND m.camunda_task_definition_key IS NOT NULL
    AND TRIM(m.camunda_task_definition_key) <> ''
  UNION
  SELECT DISTINCT TRIM(r.current_task_definition_key) AS task_key
  FROM incident_proc p
  JOIN chatbot_procedure_requests r
    ON r.procedure_type_id = p.id
  WHERE r.current_task_definition_key IS NOT NULL
    AND TRIM(r.current_task_definition_key) <> ''
),
task_keys_ranked AS (
  SELECT task_key
  FROM task_keys
  WHERE task_key IS NOT NULL AND task_key <> ''
),
task_dictionary AS (
  SELECT
    jsonb_object_agg(
      k.task_key,
      CASE
        WHEN lower(k.task_key) LIKE '%valid%' OR lower(k.task_key) LIKE '%review%' OR lower(k.task_key) LIKE '%revis%'
          THEN jsonb_build_object(
            'title', 'Revisar reporte ciudadano',
            'description', 'Verificá la descripción, ubicación e imagen enviada por el ciudadano antes de continuar el trámite.',
            'primaryActionLabel', 'Confirmar revisión',
            'requiredVariables', jsonb_build_array(
              jsonb_build_object(
                'camundaVariableName', 'revisionFuncionario',
                'label', 'Resultado de la revisión',
                'camundaVariableType', 'string',
                'required', true
              ),
              jsonb_build_object(
                'camundaVariableName', 'observacionesInternas',
                'label', 'Observaciones internas',
                'camundaVariableType', 'string',
                'required', false
              )
            )
          )
        WHEN lower(k.task_key) LIKE '%asign%' OR lower(k.task_key) LIKE '%assign%' OR lower(k.task_key) LIKE '%respons%'
          THEN jsonb_build_object(
            'title', 'Asignar responsable',
            'description', 'Indicá qué área o funcionario continuará con la atención del expediente.',
            'primaryActionLabel', 'Asignar responsable',
            'requiredVariables', jsonb_build_array(
              jsonb_build_object(
                'camundaVariableName', 'responsableAsignado',
                'label', 'Responsable asignado',
                'camundaVariableType', 'string',
                'required', true
              ),
              jsonb_build_object(
                'camundaVariableName', 'observacionesAsignacion',
                'label', 'Observaciones de asignación',
                'camundaVariableType', 'string',
                'required', false
              )
            )
          )
        WHEN lower(k.task_key) LIKE '%resolv%' OR lower(k.task_key) LIKE '%close%' OR lower(k.task_key) LIKE '%cerrar%' OR lower(k.task_key) LIKE '%finaliz%'
          THEN jsonb_build_object(
            'title', 'Registrar resolución',
            'description', 'Completá la información de cierre o resolución del reporte ciudadano.',
            'primaryActionLabel', 'Registrar resolución',
            'requiredVariables', jsonb_build_array(
              jsonb_build_object(
                'camundaVariableName', 'resultadoResolucion',
                'label', 'Resultado de la resolución',
                'camundaVariableType', 'string',
                'required', true
              ),
              jsonb_build_object(
                'camundaVariableName', 'comentarioResolucion',
                'label', 'Comentario de resolución',
                'camundaVariableType', 'string',
                'required', false
              )
            )
          )
        ELSE jsonb_build_object(
          'title', initcap(replace(replace(k.task_key, '_', ' '), '-', ' ')),
          'description', 'Ejecutá la tarea según el procedimiento vigente y completá los datos requeridos para avanzar el expediente.',
          'primaryActionLabel', 'Completar tarea',
          'requiredVariables', '[]'::jsonb
        )
      END
    ) AS dict_object
  FROM task_keys_ranked k
)
UPDATE chatbot_procedure_catalog c
SET
  flow_definition_json = jsonb_set(
    COALESCE(c.flow_definition_json, '{}'::jsonb),
    '{taskUiDictionary}',
    td.dict_object,
    true
  ),
  updated_at = NOW()
FROM incident_proc p
JOIN existing_dict ed ON ed.id = p.id
JOIN task_dictionary td ON true
WHERE c.id = p.id
  AND ed.dict_size = 0
  AND td.dict_object IS NOT NULL;

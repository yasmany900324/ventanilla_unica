import { randomUUID } from "crypto";
import { ensureDatabase, hasDatabase } from "./db";
import { isValidImageReference } from "./imageReference";

const LOOKUP_STOP_WORDS = new Set([
  "quiero",
  "necesito",
  "hacer",
  "iniciar",
  "tramite",
  "trámite",
  "gestionar",
  "realizar",
  "un",
  "una",
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "mi",
  "por",
  "para",
  "ver",
  "buscar",
  "describir",
  "que",
]);

const AUXILIARY_PROCEDURE_PHRASES = new Set([
  "quiero buscar un tramite especifico",
  "quiero ver categorias de tramites disponibles",
  "te describo lo que necesito gestionar",
  "quiero consultar el estado de un tramite",
  "quiero iniciar un tramite",
  "necesito hacer un tramite",
  "necesito realizar una gestion",
  "quiero realizar una gestion",
  "iniciar tramite",
  "iniciar un tramite",
  "hacer un tramite",
  "tramite",
  "trámite",
]);

const SUPPORTED_FIELD_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "boolean",
  "date",
  "select",
  "id",
  "image",
  "location",
]);
const SUPPORTED_CAMUNDA_MAPPING_SCOPES = new Set(["START_INSTANCE", "COMPLETE_TASK"]);
const SUPPORTED_CAMUNDA_VARIABLE_TYPES = new Set(["string", "number", "boolean", "json", "date"]);
const SUPPORTED_CASE_TYPES = new Set(["procedure", "incident"]);
const SUPPORTED_CHANNELS = new Set(["web", "whatsapp"]);

const DEFAULT_CASE_CATALOG = [
  {
    code: "registrar_incidencia",
    name: "Registrar incidencia",
    description: "Permite reportar problemas o incidencias desde web o WhatsApp.",
    category: "incidencias",
    caseType: "procedure",
    camundaProcessId: "Process_1hvmc45",
    enabledChannels: ["web", "whatsapp"],
    aliases: ["registrar incidencia", "reportar incidencia", "reportar problema"],
    keywords: ["incidencia", "reporte", "problema", "web", "whatsapp"],
    requiredFields: [
      {
        key: "description",
        label: "Descripción",
        prompt: "Contame qué está pasando para registrar la incidencia.",
        type: "text",
        required: true,
        validation: { minLength: 8, maxLength: 320 },
      },
      {
        key: "photo",
        label: "Foto",
        prompt: "Adjuntá una foto para complementar el reporte (si disponés de una).",
        type: "image",
        required: true,
      },
      {
        key: "location",
        label: "Ubicación",
        prompt: "Indicá la ubicación de la incidencia.",
        type: "location",
        required: true,
      },
    ],
    flowDefinition: {
      completionMessage:
        "Quedó registrada la información de la incidencia. Te notificaremos el avance por los canales disponibles.",
    },
  },
];

function normalizeLookup(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const TECHNICAL_FIELD_KEY_REGEX = /^[A-Za-z0-9_]{1,60}$/;

function normalizeTechnicalFieldKey(value, maxLength = 60) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().slice(0, maxLength);
  return TECHNICAL_FIELD_KEY_REGEX.test(trimmed) ? trimmed : "";
}

function normalizeLegacyFieldKey(value, maxLength = 60) {
  return normalizeLookup(value).replace(/[^a-z0-9_]/g, "").slice(0, maxLength);
}

function normalizeFieldKeyLookup(value, maxLength = 60) {
  const exact = normalizeTechnicalFieldKey(value, maxLength);
  if (exact) {
    return exact.toLowerCase();
  }
  const legacy = normalizeLegacyFieldKey(value, maxLength);
  return legacy.toLowerCase();
}

function getCollectedDataValueByFieldKey(rawData, fieldKey) {
  if (!rawData || typeof rawData !== "object") {
    return undefined;
  }
  const exactKey = normalizeTechnicalFieldKey(fieldKey, 60);
  if (exactKey && Object.prototype.hasOwnProperty.call(rawData, exactKey)) {
    return rawData[exactKey];
  }
  const legacyKey = normalizeLegacyFieldKey(fieldKey, 60);
  if (legacyKey && Object.prototype.hasOwnProperty.call(rawData, legacyKey)) {
    return rawData[legacyKey];
  }
  return undefined;
}

function normalizeCaseType(value) {
  const normalized = normalizeLookup(value);
  if (SUPPORTED_CASE_TYPES.has(normalized)) {
    return normalized;
  }
  return "procedure";
}

function normalizeArray(value, maxLengthPerItem = 120) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const normalized = normalizeText(item, maxLengthPerItem);
    if (!normalized) {
      return;
    }
    const lookup = normalizeLookup(normalized);
    if (!lookup || seen.has(lookup)) {
      return;
    }
    seen.add(lookup);
    output.push(normalized);
  });
  return output;
}

function normalizeEnabledChannels(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const normalized = normalizeLookup(item);
    if (!SUPPORTED_CHANNELS.has(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function normalizeValidation(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const minLength =
    Number.isInteger(value.minLength) && value.minLength > 0 && value.minLength <= 320
      ? value.minLength
      : null;
  const maxLength =
    Number.isInteger(value.maxLength) && value.maxLength >= 1 && value.maxLength <= 320
      ? value.maxLength
      : null;
  const pattern = normalizeText(value.pattern, 120);

  return {
    ...(minLength ? { minLength } : {}),
    ...(maxLength ? { maxLength } : {}),
    ...(pattern ? { pattern } : {}),
  };
}

function normalizeRequiredFields(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    if (!field || typeof field !== "object") {
      return;
    }

    const hasExplicitKey = typeof field.key === "string" && field.key.trim().length > 0;
    const key =
      normalizeTechnicalFieldKey(field.key, 60) ||
      (!hasExplicitKey ? normalizeLegacyFieldKey(field.label || `field_${index + 1}`, 60) : "");
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const label = normalizeText(field.label || key, 120);
    const prompt = normalizeText(
      field.prompt || `Indícame ${label || "este dato"} para continuar con el trámite.`,
      280
    );
    const typeLookup = normalizeLookup(field.type || "text");
    const type = SUPPORTED_FIELD_TYPES.has(typeLookup) ? typeLookup : "text";
    const required = field.required !== false;
    const options = normalizeArray(field.options || [], 80);
    const validation = normalizeValidation(field.validation);

    normalized.push({
      key,
      label: label || key,
      prompt,
      type,
      required,
      options,
      validation,
      order: index,
    });
  });

  return normalized;
}

function normalizeFlowDefinition(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const completionMessage = normalizeText(value.completionMessage, 260);
  const completionOutcomeVariable = normalizeText(value.completionOutcomeVariable, 120);
  const completionOutcomeResolvedValue = normalizeText(value.completionOutcomeResolvedValue, 80);
  const citizenInfoTasksInput =
    value.citizenInfoTasks && typeof value.citizenInfoTasks === "object" ? value.citizenInfoTasks : {};
  const citizenInfoTasks = {};
  for (const [taskKey, rawConfig] of Object.entries(citizenInfoTasksInput)) {
    const normalizedTaskKey = normalizeText(taskKey, 160);
    if (!normalizedTaskKey || !rawConfig || typeof rawConfig !== "object") {
      continue;
    }
    const fieldKey =
      normalizeTechnicalFieldKey(rawConfig.fieldKey, 60) ||
      normalizeLegacyFieldKey(rawConfig.fieldKey || "", 60);
    const prompt = normalizeText(rawConfig.prompt, 280);
    if (!fieldKey || !prompt) {
      continue;
    }
    citizenInfoTasks[normalizedTaskKey] = { fieldKey, prompt };
  }
  const taskUiDictionaryRaw = value.taskUiDictionary;
  const taskUiDictionaryInput = Array.isArray(taskUiDictionaryRaw)
    ? taskUiDictionaryRaw
    : taskUiDictionaryRaw && typeof taskUiDictionaryRaw === "object"
      ? Object.entries(taskUiDictionaryRaw).map(([taskDefinitionKey, config]) => ({
          taskDefinitionKey,
          ...(config && typeof config === "object" ? config : {}),
        }))
      : [];
  const taskUiDictionary = [];
  for (const rawTaskConfig of taskUiDictionaryInput) {
    if (!rawTaskConfig || typeof rawTaskConfig !== "object") {
      continue;
    }
    const taskDefinitionKey = normalizeText(rawTaskConfig.taskDefinitionKey, 160);
    if (!taskDefinitionKey) {
      continue;
    }
    const title = normalizeText(rawTaskConfig.title, 180);
    const description = normalizeText(rawTaskConfig.description, 320);
    const primaryActionLabel = normalizeText(rawTaskConfig.primaryActionLabel, 120);
    const requiredVariablesInput = Array.isArray(rawTaskConfig.requiredVariables)
      ? rawTaskConfig.requiredVariables
      : [];
    const requiredVariables = [];
    for (const rawVariable of requiredVariablesInput) {
      if (!rawVariable || typeof rawVariable !== "object") {
        continue;
      }
      const camundaVariableName = normalizeText(rawVariable.camundaVariableName, 160);
      const procedureFieldKey =
        normalizeTechnicalFieldKey(rawVariable.procedureFieldKey, 60) ||
        normalizeLegacyFieldKey(rawVariable.procedureFieldKey || "", 60);
      if (!camundaVariableName && !procedureFieldKey) {
        continue;
      }
      const camundaVariableType = normalizeCamundaVariableType(rawVariable.camundaVariableType);
      requiredVariables.push({
        ...(camundaVariableName ? { camundaVariableName } : {}),
        ...(procedureFieldKey ? { procedureFieldKey } : {}),
        label: normalizeText(rawVariable.label, 120),
        camundaVariableType,
        required: rawVariable.required !== false,
      });
    }
    taskUiDictionary.push({
      taskDefinitionKey,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(primaryActionLabel ? { primaryActionLabel } : {}),
      ...(requiredVariables.length > 0 ? { requiredVariables } : {}),
    });
  }
  return {
    ...(completionMessage ? { completionMessage } : {}),
    ...(completionOutcomeVariable ? { completionOutcomeVariable } : {}),
    ...(completionOutcomeResolvedValue ? { completionOutcomeResolvedValue } : {}),
    ...(Object.keys(citizenInfoTasks).length > 0 ? { citizenInfoTasks } : {}),
    ...(taskUiDictionary.length > 0 ? { taskUiDictionary } : {}),
  };
}

function humanizeTaskDefinitionKey(value) {
  const normalized = normalizeText(value, 160);
  if (!normalized) {
    return "Tarea de gestión";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function humanizeVariableLabel(variableName) {
  const normalized = normalizeText(variableName, 160);
  if (!normalized) {
    return "Variable";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function mapVariableLabelByTaskPreset({ taskLookup, variableName, fallbackLabel }) {
  const variableLookup = normalizeLookup(variableName);
  if (taskLookup.includes("valid") || taskLookup.includes("review") || taskLookup.includes("revis")) {
    if (variableLookup.includes("observ")) {
      return "Observaciones internas";
    }
    if (variableLookup.includes("result") || variableLookup.includes("revision") || variableLookup.includes("decis")) {
      return "Resultado de la revisión";
    }
  }
  if (taskLookup.includes("asign") || taskLookup.includes("assign") || taskLookup.includes("respons")) {
    if (variableLookup.includes("observ")) {
      return "Observaciones de asignación";
    }
    if (variableLookup.includes("respons")) {
      return "Responsable asignado";
    }
  }
  if (
    taskLookup.includes("resolv") ||
    taskLookup.includes("close") ||
    taskLookup.includes("cerrar") ||
    taskLookup.includes("finaliz")
  ) {
    if (variableLookup.includes("coment") || variableLookup.includes("observ")) {
      return "Comentario de resolución";
    }
    if (variableLookup.includes("result") || variableLookup.includes("resol")) {
      return "Resultado de la resolución";
    }
  }
  return fallbackLabel;
}

function buildInitialTaskUiEntry(taskDefinitionKey, mappedVariables = []) {
  const normalizedTaskKey = normalizeText(taskDefinitionKey, 160);
  const lookup = normalizeLookup(normalizedTaskKey);
  if (!normalizedTaskKey) {
    return null;
  }
  const mappedRequiredVariables = Array.isArray(mappedVariables)
    ? mappedVariables
        .map((variable) => {
          const camundaVariableName = normalizeText(variable?.camundaVariableName, 160);
          if (!camundaVariableName) {
            return null;
          }
          const fallbackLabel = humanizeVariableLabel(camundaVariableName);
          return {
            camundaVariableName,
            label: mapVariableLabelByTaskPreset({ taskLookup: lookup, variableName: camundaVariableName, fallbackLabel }),
            camundaVariableType: normalizeCamundaVariableType(variable?.camundaVariableType),
            required: variable?.required !== false,
          };
        })
        .filter(Boolean)
    : [];
  if (lookup.includes("valid") || lookup.includes("review") || lookup.includes("revis")) {
    return {
      taskDefinitionKey: normalizedTaskKey,
      title: "Revisar reporte ciudadano",
      description:
        "Verificá la descripción, ubicación e imagen enviada por el ciudadano antes de continuar el trámite.",
      primaryActionLabel: "Confirmar revisión",
      requiredVariables: mappedRequiredVariables.length > 0 ? mappedRequiredVariables : [
        {
          camundaVariableName: "revisionFuncionario",
          label: "Resultado de la revisión",
          camundaVariableType: "string",
          required: true,
        },
        {
          camundaVariableName: "observacionesInternas",
          label: "Observaciones internas",
          camundaVariableType: "string",
          required: false,
        },
      ],
    };
  }
  if (lookup.includes("asign") || lookup.includes("assign") || lookup.includes("respons")) {
    return {
      taskDefinitionKey: normalizedTaskKey,
      title: "Asignar responsable",
      description: "Indicá qué área o funcionario continuará con la atención del expediente.",
      primaryActionLabel: "Asignar responsable",
      requiredVariables: mappedRequiredVariables.length > 0 ? mappedRequiredVariables : [
        {
          camundaVariableName: "responsableAsignado",
          label: "Responsable asignado",
          camundaVariableType: "string",
          required: true,
        },
        {
          camundaVariableName: "observacionesAsignacion",
          label: "Observaciones de asignación",
          camundaVariableType: "string",
          required: false,
        },
      ],
    };
  }
  if (
    lookup.includes("resolv") ||
    lookup.includes("close") ||
    lookup.includes("cerrar") ||
    lookup.includes("finaliz")
  ) {
    return {
      taskDefinitionKey: normalizedTaskKey,
      title: "Registrar resolución",
      description: "Completá la información de cierre o resolución del reporte ciudadano.",
      primaryActionLabel: "Registrar resolución",
      requiredVariables: mappedRequiredVariables.length > 0 ? mappedRequiredVariables : [
        {
          camundaVariableName: "resultadoResolucion",
          label: "Resultado de la resolución",
          camundaVariableType: "string",
          required: true,
        },
        {
          camundaVariableName: "comentarioResolucion",
          label: "Comentario de resolución",
          camundaVariableType: "string",
          required: false,
        },
      ],
    };
  }
  return {
    taskDefinitionKey: normalizedTaskKey,
    title: humanizeTaskDefinitionKey(normalizedTaskKey),
    description:
      "Ejecutá la tarea según el procedimiento vigente y completá los datos requeridos para avanzar el expediente.",
    primaryActionLabel: "Completar tarea",
    requiredVariables: mappedRequiredVariables,
  };
}

async function seedIncidentTaskUiDictionary(sql) {
  const [procedureRow] = await sql`
    SELECT id, flow_definition_json
    FROM chatbot_procedure_catalog
    WHERE code = 'registrar_incidencia'
      AND case_type = 'procedure'
    LIMIT 1;
  `;
  if (!procedureRow?.id) {
    return false;
  }
  const currentFlowDefinition = normalizeFlowDefinition(
    parseJsonColumn(procedureRow.flow_definition_json, {})
  );
  const currentDictionary = Array.isArray(currentFlowDefinition.taskUiDictionary)
    ? currentFlowDefinition.taskUiDictionary
    : [];
  if (currentDictionary.length > 0) {
    return false;
  }
  const mappingRows = await sql`
    SELECT
      camunda_task_definition_key,
      camunda_variable_name,
      camunda_variable_type,
      is_required
    FROM chatbot_procedure_camunda_variable_mappings
    WHERE procedure_type_id = ${procedureRow.id}
      AND scope = 'COMPLETE_TASK'
      AND camunda_task_definition_key IS NOT NULL
      AND TRIM(camunda_task_definition_key) <> ''
    ORDER BY camunda_task_definition_key ASC, camunda_variable_name ASC;
  `;
  const requestRows = await sql`
    SELECT DISTINCT current_task_definition_key
    FROM chatbot_procedure_requests
    WHERE procedure_type_id = ${procedureRow.id}
      AND current_task_definition_key IS NOT NULL
      AND TRIM(current_task_definition_key) <> ''
    ORDER BY current_task_definition_key ASC
    LIMIT 20;
  `;
  const citizenInfoTaskKeys =
    currentFlowDefinition.citizenInfoTasks && typeof currentFlowDefinition.citizenInfoTasks === "object"
      ? Object.keys(currentFlowDefinition.citizenInfoTasks)
      : [];
  const keys = Array.from(
    new Set(
      [
        ...mappingRows.map((row) => normalizeText(row?.camunda_task_definition_key, 160)),
        ...requestRows.map((row) => normalizeText(row?.current_task_definition_key, 160)),
        ...citizenInfoTaskKeys.map((key) => normalizeText(key, 160)),
      ].filter(Boolean)
    )
  );
  if (keys.length === 0) {
    return false;
  }
  const variablesByTaskKey = new Map();
  mappingRows.forEach((row) => {
    const taskKey = normalizeText(row?.camunda_task_definition_key, 160);
    const camundaVariableName = normalizeText(row?.camunda_variable_name, 160);
    if (!taskKey || !camundaVariableName) {
      return;
    }
    if (!variablesByTaskKey.has(taskKey)) {
      variablesByTaskKey.set(taskKey, []);
    }
    variablesByTaskKey.get(taskKey).push({
      camundaVariableName,
      camundaVariableType: normalizeCamundaVariableType(row?.camunda_variable_type),
      required: row?.is_required !== false,
    });
  });
  const seededDictionary = keys
    .map((key) => buildInitialTaskUiEntry(key, variablesByTaskKey.get(key) || []))
    .filter((entry) => entry && entry.taskDefinitionKey);
  if (seededDictionary.length === 0) {
    return false;
  }
  const nextFlowDefinition = {
    ...currentFlowDefinition,
    taskUiDictionary: seededDictionary,
  };
  await sql`
    UPDATE chatbot_procedure_catalog
    SET
      flow_definition_json = ${JSON.stringify(nextFlowDefinition)}::jsonb,
      updated_at = NOW()
    WHERE id = ${procedureRow.id};
  `;
  return true;
}

function normalizeProcedureFieldDefinition(field) {
  if (!field || typeof field !== "object") {
    return null;
  }

  const hasExplicitKey = typeof field.key === "string" && field.key.trim().length > 0;
  const key =
    normalizeTechnicalFieldKey(field.key, 60) ||
    (!hasExplicitKey ? normalizeLegacyFieldKey(field.label || "", 60) : "");
  if (!key) {
    return null;
  }

  const label = normalizeText(field.label || key, 120);
  const prompt = normalizeText(field.prompt || `Indícame ${label || "este dato"}.`, 280);
  const typeLookup = normalizeLookup(field.type || "text");
  const type = SUPPORTED_FIELD_TYPES.has(typeLookup) ? typeLookup : "text";
  const required = field.required !== false;
  const options = normalizeArray(field.options || [], 80);
  const validation = normalizeValidation(field.validation);

  return {
    key,
    label: label || key,
    prompt,
    type,
    required,
    options,
    validation,
    order: Number.isInteger(field.order) ? field.order : 0,
  };
}

function normalizeProcedureFieldDefinitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  value.forEach((field, index) => {
    const candidate = normalizeProcedureFieldDefinition(field);
    if (!candidate || seen.has(candidate.key)) {
      return;
    }
    seen.add(candidate.key);
    normalized.push({
      ...candidate,
      order: Number.isInteger(field?.order) ? field.order : index,
    });
  });

  return normalized.sort((a, b) => a.order - b.order);
}

function normalizeCamundaScope(value) {
  if (typeof value !== "string") {
    return "START_INSTANCE";
  }
  const normalized = value.trim().toUpperCase();
  return SUPPORTED_CAMUNDA_MAPPING_SCOPES.has(normalized) ? normalized : "START_INSTANCE";
}

function normalizeCamundaVariableType(value) {
  const normalized = normalizeLookup(value);
  return SUPPORTED_CAMUNDA_VARIABLE_TYPES.has(normalized) ? normalized : "string";
}

function normalizeCamundaVariableMappings(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const scope = normalizeCamundaScope(item.scope);
    const camundaTaskDefinitionKey =
      scope === "COMPLETE_TASK"
        ? normalizeText(item.camundaTaskDefinitionKey, 160) || null
        : null;
    const procedureFieldKey =
      normalizeTechnicalFieldKey(item.procedureFieldKey, 60) ||
      normalizeLegacyFieldKey(item.procedureFieldKey || "", 60);
    const camundaVariableName = normalizeText(item.camundaVariableName, 160);
    if (!procedureFieldKey || !camundaVariableName) {
      return;
    }
    const uniqueKey = [
      scope,
      camundaTaskDefinitionKey || "",
      procedureFieldKey,
      camundaVariableName.toLowerCase(),
    ].join("|");
    if (seen.has(uniqueKey)) {
      return;
    }
    seen.add(uniqueKey);
    out.push({
      scope,
      camundaTaskDefinitionKey,
      procedureFieldKey,
      camundaVariableName,
      camundaVariableType: normalizeCamundaVariableType(item.camundaVariableType),
      required: item.required !== false,
      enabled: item.enabled !== false,
    });
  });
  return out;
}

function parseJsonColumn(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return fallback;
    }
  }
  return value;
}

function mapRowToProcedure(row) {
  const aliases = normalizeArray(
    parseJsonColumn(row?.aliases_json ?? row?.aliases, [])
  );
  const keywords = normalizeArray(
    parseJsonColumn(row?.keywords_json ?? row?.keywords, [])
  );
  const requiredFields = normalizeRequiredFields(
    parseJsonColumn(row?.required_fields_json ?? row?.required_fields, [])
  );
  const flowDefinition = normalizeFlowDefinition(
    parseJsonColumn(row?.flow_definition_json ?? row?.flow_definition, {})
  );
  const enabledChannels = normalizeEnabledChannels(
    parseJsonColumn(row?.enabled_channels_json ?? row?.enabled_channels, [])
  );

  return {
    id: normalizeText(row?.id, 80),
    code: normalizeText(row?.code, 120),
    name: normalizeText(row?.name, 160),
    description: normalizeText(row?.description, 320),
    category: normalizeText(row?.category, 80),
    aliases,
    keywords,
    isActive: Boolean(row?.is_active),
    requiredFields,
    fieldDefinitions: requiredFields,
    flowDefinition,
    caseType: normalizeCaseType(row?.case_type),
    camundaProcessId: normalizeText(row?.camunda_process_id, 160),
    camundaVersion: normalizeText(row?.version, 80),
    enabledChannels,
    version: normalizeText(row?.version, 80),
    metadata: parseJsonColumn(row?.metadata_json, {}),
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
  };
}

function mapProcedureFieldRow(row) {
  const options = normalizeArray(parseJsonColumn(row?.options_json, []), 80);
  return {
    id: normalizeText(row?.id, 80),
    procedureTypeId: normalizeText(row?.procedure_type_id, 80),
    key:
      normalizeTechnicalFieldKey(row?.field_key, 60) ||
      normalizeLegacyFieldKey(row?.field_key || "", 60),
    label: normalizeText(row?.label, 120),
    type: SUPPORTED_FIELD_TYPES.has(normalizeLookup(row?.field_type || ""))
      ? normalizeLookup(row?.field_type)
      : "text",
    required: row?.is_required !== false,
    options,
    order: Number.isInteger(row?.field_order) ? row.field_order : 0,
    enabled: row?.is_enabled !== false,
  };
}

function mapCamundaVariableMappingRow(row) {
  return {
    id: normalizeText(row?.id, 80),
    procedureTypeId: normalizeText(row?.procedure_type_id, 80),
    scope: normalizeCamundaScope(row?.scope),
    camundaTaskDefinitionKey: normalizeText(row?.camunda_task_definition_key, 160) || null,
    procedureFieldKey:
      normalizeTechnicalFieldKey(row?.procedure_field_key, 60) ||
      normalizeLegacyFieldKey(row?.procedure_field_key || "", 60),
    camundaVariableName: normalizeText(row?.camunda_variable_name, 160),
    camundaVariableType: normalizeCamundaVariableType(row?.camunda_variable_type),
    required: row?.is_required !== false,
    enabled: row?.is_enabled !== false,
  };
}

async function listProcedureFieldsByProcedureTypeIds(sql, procedureTypeIds) {
  if (!Array.isArray(procedureTypeIds) || procedureTypeIds.length === 0) {
    return new Map();
  }
  const rows = await sql`
    SELECT
      id,
      procedure_type_id,
      field_key,
      label,
      field_type,
      is_required,
      options_json,
      field_order,
      is_enabled
    FROM chatbot_procedure_fields
    WHERE procedure_type_id = ANY(${procedureTypeIds}::text[])
      AND is_enabled = TRUE
    ORDER BY procedure_type_id ASC, field_order ASC;
  `;
  const grouped = new Map();
  rows.forEach((row) => {
    const mapped = mapProcedureFieldRow(row);
    if (!mapped.procedureTypeId || !mapped.key) {
      return;
    }
    if (!grouped.has(mapped.procedureTypeId)) {
      grouped.set(mapped.procedureTypeId, []);
    }
    grouped.get(mapped.procedureTypeId).push(mapped);
  });
  return grouped;
}

async function listCamundaVariableMappingsByProcedureTypeIds(sql, procedureTypeIds) {
  if (!Array.isArray(procedureTypeIds) || procedureTypeIds.length === 0) {
    return new Map();
  }
  const rows = await sql`
    SELECT
      id,
      procedure_type_id,
      scope,
      camunda_task_definition_key,
      procedure_field_key,
      camunda_variable_name,
      camunda_variable_type,
      is_required,
      is_enabled
    FROM chatbot_procedure_camunda_variable_mappings
    WHERE procedure_type_id = ANY(${procedureTypeIds}::text[])
      AND is_enabled = TRUE
    ORDER BY procedure_type_id ASC, scope ASC, camunda_task_definition_key ASC NULLS FIRST, camunda_variable_name ASC;
  `;
  const grouped = new Map();
  rows.forEach((row) => {
    const mapped = mapCamundaVariableMappingRow(row);
    if (!mapped.procedureTypeId || !mapped.procedureFieldKey || !mapped.camundaVariableName) {
      return;
    }
    if (!grouped.has(mapped.procedureTypeId)) {
      grouped.set(mapped.procedureTypeId, []);
    }
    grouped.get(mapped.procedureTypeId).push(mapped);
  });
  return grouped;
}

function buildSearchTerms(procedure) {
  return [procedure.name, ...procedure.aliases, ...procedure.keywords]
    .map((value) => normalizeLookup(value))
    .filter(Boolean);
}

function tokenizeLookup(value) {
  return normalizeLookup(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !LOOKUP_STOP_WORDS.has(token));
}

function isAuxiliaryPhrase(value) {
  return AUXILIARY_PROCEDURE_PHRASES.has(normalizeLookup(value));
}

function scoreProcedureMatch({
  procedure,
  interpretedName,
  interpretedCategory,
  userText,
  intentConfidence,
}) {
  const procedureName = normalizeLookup(procedure.name);
  const aliases = procedure.aliases.map((alias) => normalizeLookup(alias)).filter(Boolean);
  const keywords = procedure.keywords.map((keyword) => normalizeLookup(keyword)).filter(Boolean);
  const candidate = normalizeLookup(interpretedName);
  const textLookup = normalizeLookup(userText);
  let bestScore = 0;

  if (candidate && !isAuxiliaryPhrase(candidate)) {
    if (candidate === procedureName) {
      bestScore = Math.max(bestScore, 0.99);
    }
    if (aliases.includes(candidate)) {
      bestScore = Math.max(bestScore, 0.97);
    }
    if (candidate.includes(procedureName) || procedureName.includes(candidate)) {
      bestScore = Math.max(bestScore, 0.87);
    }
    if (aliases.some((alias) => alias.includes(candidate) || candidate.includes(alias))) {
      bestScore = Math.max(bestScore, 0.84);
    }

    const candidateTokens = tokenizeLookup(candidate);
    const procedureTokens = new Set(tokenizeLookup(buildSearchTerms(procedure).join(" ")));
    if (candidateTokens.length > 0 && procedureTokens.size > 0) {
      const overlap = candidateTokens.filter((token) => procedureTokens.has(token)).length;
      const overlapRatio = overlap / candidateTokens.length;
      if (overlapRatio >= 0.75) {
        bestScore = Math.max(bestScore, 0.82);
      } else if (overlapRatio >= 0.5) {
        bestScore = Math.max(bestScore, 0.74);
      }
    }
  }

  if (textLookup) {
    if (textLookup.includes(procedureName)) {
      bestScore = Math.max(bestScore, 0.93);
    }
    if (aliases.some((alias) => textLookup.includes(alias))) {
      bestScore = Math.max(bestScore, 0.9);
    }

    const keywordMatches = keywords.filter((keyword) => textLookup.includes(keyword)).length;
    if (keywordMatches >= 3) {
      bestScore = Math.max(bestScore, 0.86);
    } else if (keywordMatches === 2) {
      bestScore = Math.max(bestScore, 0.78);
    } else if (keywordMatches === 1) {
      bestScore = Math.max(bestScore, 0.66);
    }
  }

  const category = normalizeLookup(interpretedCategory);
  if (category && category === normalizeLookup(procedure.category)) {
    bestScore = Math.min(1, bestScore + 0.06);
  }

  const boundedIntentConfidence =
    typeof intentConfidence === "number" && Number.isFinite(intentConfidence)
      ? Math.min(1, Math.max(0, intentConfidence))
      : 0;
  if (boundedIntentConfidence >= 0.8 && bestScore > 0) {
    bestScore = Math.min(1, bestScore + 0.02);
  }

  return bestScore;
}

async function upsertProcedureCatalogDefaults(sql) {
  for (const entry of DEFAULT_CASE_CATALOG) {
    const id = randomUUID();
    const code = normalizeText(entry.code, 120).toLowerCase();
    const name = normalizeText(entry.name, 160);
    const description = normalizeText(entry.description, 320);
    const category = normalizeText(entry.category, 80);
    const caseType = normalizeCaseType(entry.caseType);
    const camundaProcessId = normalizeText(entry.camundaProcessId, 160) || null;
    const aliases = normalizeArray(entry.aliases, 120);
    const keywords = normalizeArray(entry.keywords, 120);
    const enabledChannels = normalizeEnabledChannels(entry.enabledChannels || ["web", "whatsapp"]);
    const requiredFields = normalizeRequiredFields(entry.requiredFields);
    const flowDefinition = normalizeFlowDefinition(entry.flowDefinition);

    if (!code || !name || requiredFields.length === 0) {
      continue;
    }

    await sql`
      INSERT INTO chatbot_procedure_catalog (
        id,
        code,
        name,
        description,
        category,
        aliases_json,
        keywords_json,
        case_type,
        camunda_process_id,
        enabled_channels_json,
        is_active,
        required_fields_json,
        flow_definition_json,
        updated_at
      )
      VALUES (
        ${id},
        ${code},
        ${name},
        ${description},
        ${category},
        ${JSON.stringify(aliases)}::jsonb,
        ${JSON.stringify(keywords)}::jsonb,
        ${caseType},
        ${camundaProcessId},
        ${JSON.stringify(enabledChannels)}::jsonb,
        ${true},
        ${JSON.stringify(requiredFields)}::jsonb,
        ${JSON.stringify(flowDefinition)}::jsonb,
        NOW()
      )
      ON CONFLICT (code)
      DO NOTHING;
    `;
  }
}

export async function ensureProcedureCatalogSchema() {
  if (!hasDatabase()) {
    return false;
  }

  const sql = ensureDatabase();
  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_catalog (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      aliases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      keywords_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      case_type TEXT NOT NULL DEFAULT 'procedure',
      camunda_process_id TEXT,
      version TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      required_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      flow_definition_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS aliases_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET aliases_json = '[]'::jsonb
    WHERE aliases_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS keywords_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET keywords_json = '[]'::jsonb
    WHERE keywords_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS required_fields_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET required_fields_json = '[]'::jsonb
    WHERE required_fields_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS flow_definition_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET flow_definition_json = '{}'::jsonb
    WHERE flow_definition_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS case_type TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET case_type = 'procedure'
    WHERE case_type IS NULL OR TRIM(case_type) = '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN case_type SET DEFAULT 'procedure';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN case_type SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS camunda_process_id TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS enabled_channels_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET enabled_channels_json = '["web","whatsapp"]'::jsonb
    WHERE enabled_channels_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN enabled_channels_json SET DEFAULT '["web","whatsapp"]'::jsonb;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN enabled_channels_json SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS version TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ADD COLUMN IF NOT EXISTS metadata_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_catalog
    SET metadata_json = '{}'::jsonb
    WHERE metadata_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN metadata_json SET DEFAULT '{}'::jsonb;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_catalog
    ALTER COLUMN metadata_json SET NOT NULL;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_catalog_active_idx
    ON chatbot_procedure_catalog (is_active, updated_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_catalog_case_type_active_idx
    ON chatbot_procedure_catalog (case_type, is_active, updated_at DESC);
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_fields (
      id TEXT PRIMARY KEY,
      procedure_type_id TEXT NOT NULL REFERENCES chatbot_procedure_catalog(id) ON DELETE CASCADE,
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
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chatbot_procedure_fields_type_key_unique
    ON chatbot_procedure_fields (procedure_type_id, field_key);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_fields_type_order_idx
    ON chatbot_procedure_fields (procedure_type_id, field_order ASC);
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_camunda_variable_mappings (
      id TEXT PRIMARY KEY,
      procedure_type_id TEXT NOT NULL REFERENCES chatbot_procedure_catalog(id) ON DELETE CASCADE,
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
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_proc_camunda_map_scope_idx
    ON chatbot_procedure_camunda_variable_mappings (
      procedure_type_id,
      scope,
      camunda_task_definition_key
    );
  `;
  await sql`
    DELETE FROM chatbot_procedure_catalog
    WHERE case_type = 'procedure'
      AND code IN ('habilitacion_comercial', 'permiso_construccion');
  `;

  await upsertProcedureCatalogDefaults(sql);
  await seedIncidentTaskUiDictionary(sql);
  return true;
}

export async function listActiveProcedureCatalog() {
  return listProcedureCatalog({ includeInactive: false, caseType: "procedure" });
}

export async function replaceProcedureTypeFields(procedureTypeId, fields) {
  const normalizedProcedureTypeId = normalizeText(procedureTypeId, 80);
  if (!normalizedProcedureTypeId || !hasDatabase()) {
    return [];
  }
  const sql = ensureDatabase();
  await ensureProcedureCatalogSchema();
  const normalizedFields = normalizeProcedureFieldDefinitions(fields);
  await sql`
    DELETE FROM chatbot_procedure_fields
    WHERE procedure_type_id = ${normalizedProcedureTypeId};
  `;
  for (const field of normalizedFields) {
    await sql`
      INSERT INTO chatbot_procedure_fields (
        id,
        procedure_type_id,
        field_key,
        label,
        field_type,
        is_required,
        options_json,
        field_order,
        is_enabled,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${normalizedProcedureTypeId},
        ${field.key},
        ${field.label},
        ${field.type},
        ${field.required !== false},
        ${JSON.stringify(Array.isArray(field.options) ? field.options : [])}::jsonb,
        ${Number.isInteger(field.order) ? field.order : 0},
        ${true},
        NOW()
      );
    `;
  }
  return normalizedFields;
}

export async function replaceProcedureTypeCamundaVariableMappings(procedureTypeId, mappings) {
  const normalizedProcedureTypeId = normalizeText(procedureTypeId, 80);
  if (!normalizedProcedureTypeId || !hasDatabase()) {
    return [];
  }
  const sql = ensureDatabase();
  await ensureProcedureCatalogSchema();
  const normalizedMappings = normalizeCamundaVariableMappings(mappings);
  await sql`
    DELETE FROM chatbot_procedure_camunda_variable_mappings
    WHERE procedure_type_id = ${normalizedProcedureTypeId};
  `;
  for (const mapping of normalizedMappings) {
    await sql`
      INSERT INTO chatbot_procedure_camunda_variable_mappings (
        id,
        procedure_type_id,
        scope,
        camunda_task_definition_key,
        procedure_field_key,
        camunda_variable_name,
        camunda_variable_type,
        is_required,
        is_enabled,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${normalizedProcedureTypeId},
        ${mapping.scope},
        ${mapping.camundaTaskDefinitionKey},
        ${mapping.procedureFieldKey},
        ${mapping.camundaVariableName},
        ${mapping.camundaVariableType},
        ${mapping.required !== false},
        ${mapping.enabled !== false},
        NOW()
      );
    `;
  }
  return normalizedMappings;
}

export async function listProcedureTypeCamundaVariableMappings(procedureTypeId) {
  const normalizedProcedureTypeId = normalizeText(procedureTypeId, 80);
  if (!normalizedProcedureTypeId || !hasDatabase()) {
    return [];
  }
  const sql = ensureDatabase();
  await ensureProcedureCatalogSchema();
  const grouped = await listCamundaVariableMappingsByProcedureTypeIds(sql, [normalizedProcedureTypeId]);
  return grouped.get(normalizedProcedureTypeId) || [];
}

export async function listProcedureCatalog({ includeInactive = false, caseType = "procedure" } = {}) {
  if (!hasDatabase()) {
    return [];
  }

  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const normalizedCaseType = caseType ? normalizeCaseType(caseType) : null;
  const caseTypeSql = normalizedCaseType
    ? sql`case_type = ${normalizedCaseType}`
    : sql`TRUE`;
  const activeSql = includeInactive ? sql`TRUE` : sql`is_active = TRUE`;
  const rows = includeInactive
    ? await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json,
          created_at,
          updated_at
        FROM chatbot_procedure_catalog
        WHERE ${caseTypeSql}
        ORDER BY name ASC;
      `
    : await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json,
          created_at,
          updated_at
        FROM chatbot_procedure_catalog
        WHERE ${activeSql}
          AND ${caseTypeSql}
        ORDER BY name ASC;
      `;

  const mappedRows = rows.map((row) => mapRowToProcedure(row)).filter((row) => row.code && row.name);
  const procedureTypeIds = mappedRows.map((item) => item.id).filter(Boolean);
  const fieldsByTypeId = await listProcedureFieldsByProcedureTypeIds(sql, procedureTypeIds);
  const mappingsByTypeId = await listCamundaVariableMappingsByProcedureTypeIds(sql, procedureTypeIds);
  return mappedRows.map((item) => ({
    ...item,
    requiredFields: fieldsByTypeId.get(item.id) || item.requiredFields || [],
    fieldDefinitions: fieldsByTypeId.get(item.id) || item.fieldDefinitions || item.requiredFields || [],
    camundaVariableMappings: mappingsByTypeId.get(item.id) || [],
  }));
}

export async function getProcedureCatalogEntryByCode(code, { includeInactive = false } = {}) {
  const normalizedCode = normalizeText(code, 120).toLowerCase();
  if (!normalizedCode || !hasDatabase()) {
    return null;
  }

  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const [row] = includeInactive
    ? await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json
        FROM chatbot_procedure_catalog
        WHERE LOWER(code) = ${normalizedCode}
          AND case_type = 'procedure'
        LIMIT 1;
      `
    : await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json
        FROM chatbot_procedure_catalog
        WHERE LOWER(code) = ${normalizedCode}
          AND case_type = 'procedure'
          AND is_active = TRUE
        LIMIT 1;
      `;
  if (!row) {
    return null;
  }
  const mapped = mapRowToProcedure(row);
  const fieldsByTypeId = await listProcedureFieldsByProcedureTypeIds(sql, [mapped.id]);
  const mappingsByTypeId = await listCamundaVariableMappingsByProcedureTypeIds(sql, [mapped.id]);
  return {
    ...mapped,
    requiredFields: fieldsByTypeId.get(mapped.id) || mapped.requiredFields || [],
    fieldDefinitions: fieldsByTypeId.get(mapped.id) || mapped.fieldDefinitions || mapped.requiredFields || [],
    camundaVariableMappings: mappingsByTypeId.get(mapped.id) || [],
  };
}

export async function getActiveCatalogItemById(id) {
  const normalizedId = normalizeText(id, 80);
  if (!normalizedId || !hasDatabase()) {
    return null;
  }
  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const [row] = await sql`
    SELECT
      id,
      code,
      name,
      description,
      category,
      aliases_json,
      keywords_json,
      case_type,
      camunda_process_id,
      enabled_channels_json,
      version,
      metadata_json,
      is_active,
      required_fields_json,
      flow_definition_json
    FROM chatbot_procedure_catalog
    WHERE id = ${normalizedId}
      AND is_active = TRUE
    LIMIT 1;
  `;
  if (!row) {
    return null;
  }
  const mapped = mapRowToProcedure(row);
  const fieldsByTypeId = await listProcedureFieldsByProcedureTypeIds(sql, [mapped.id]);
  const mappingsByTypeId = await listCamundaVariableMappingsByProcedureTypeIds(sql, [mapped.id]);
  return {
    ...mapped,
    requiredFields: fieldsByTypeId.get(mapped.id) || mapped.requiredFields || [],
    fieldDefinitions: fieldsByTypeId.get(mapped.id) || mapped.fieldDefinitions || mapped.requiredFields || [],
    camundaVariableMappings: mappingsByTypeId.get(mapped.id) || [],
  };
}

export async function getProcedureCatalogEntryById(id, { includeInactive = false } = {}) {
  const normalizedId = normalizeText(id, 80);
  if (!normalizedId || !hasDatabase()) {
    return null;
  }
  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const [row] = includeInactive
    ? await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json
        FROM chatbot_procedure_catalog
        WHERE id = ${normalizedId}
          AND case_type = 'procedure'
        LIMIT 1;
      `
    : await sql`
        SELECT
          id,
          code,
          name,
          description,
          category,
          aliases_json,
          keywords_json,
          case_type,
          camunda_process_id,
          enabled_channels_json,
          version,
          metadata_json,
          is_active,
          required_fields_json,
          flow_definition_json
        FROM chatbot_procedure_catalog
        WHERE id = ${normalizedId}
          AND case_type = 'procedure'
          AND is_active = TRUE
        LIMIT 1;
      `;
  if (!row) {
    return null;
  }
  const mapped = mapRowToProcedure(row);
  const fieldsByTypeId = await listProcedureFieldsByProcedureTypeIds(sql, [mapped.id]);
  const mappingsByTypeId = await listCamundaVariableMappingsByProcedureTypeIds(sql, [mapped.id]);
  return {
    ...mapped,
    requiredFields: fieldsByTypeId.get(mapped.id) || mapped.requiredFields || [],
    fieldDefinitions: fieldsByTypeId.get(mapped.id) || mapped.fieldDefinitions || mapped.requiredFields || [],
    camundaVariableMappings: mappingsByTypeId.get(mapped.id) || [],
  };
}

export async function getActiveCatalogItemByCode(code) {
  const normalizedCode = normalizeText(code, 120).toLowerCase();
  if (!normalizedCode || !hasDatabase()) {
    return null;
  }
  await ensureProcedureCatalogSchema();
  const sql = ensureDatabase();
  const [row] = await sql`
    SELECT
      id,
      code,
      name,
      description,
      category,
      aliases_json,
      keywords_json,
      case_type,
      camunda_process_id,
      enabled_channels_json,
      version,
      metadata_json,
      is_active,
      required_fields_json,
      flow_definition_json
    FROM chatbot_procedure_catalog
    WHERE LOWER(code) = ${normalizedCode}
      AND is_active = TRUE
    LIMIT 1;
  `;
  if (!row) {
    return null;
  }
  const mapped = mapRowToProcedure(row);
  const fieldsByTypeId = await listProcedureFieldsByProcedureTypeIds(sql, [mapped.id]);
  const mappingsByTypeId = await listCamundaVariableMappingsByProcedureTypeIds(sql, [mapped.id]);
  return {
    ...mapped,
    requiredFields: fieldsByTypeId.get(mapped.id) || mapped.requiredFields || [],
    fieldDefinitions: fieldsByTypeId.get(mapped.id) || mapped.fieldDefinitions || mapped.requiredFields || [],
    camundaVariableMappings: mappingsByTypeId.get(mapped.id) || [],
  };
}

function scoreCatalogItemByText(item, textLookupTokens) {
  if (!item || textLookupTokens.length === 0) {
    return 0;
  }
  const terms = buildSearchTerms(item);
  if (terms.length === 0) {
    return 0;
  }
  let score = 0;
  const itemName = normalizeLookup(item.name);
  const itemDescription = normalizeLookup(item.description);
  const category = normalizeLookup(item.category);
  const termSet = new Set(terms);
  for (const token of textLookupTokens) {
    if (termSet.has(token)) {
      score += 3;
      continue;
    }
    if (itemName.includes(token)) {
      score += 2;
      continue;
    }
    if (itemDescription.includes(token)) {
      score += 1;
      continue;
    }
    if (category && category.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export async function searchCatalogItemsByUserText(text, { caseType = null } = {}) {
  const lookup = normalizeLookup(text);
  const tokens = tokenizeLookup(text);
  if (!lookup || tokens.length === 0) {
    return [];
  }
  const catalog = await listProcedureCatalog({
    includeInactive: false,
    caseType: caseType ? normalizeCaseType(caseType) : null,
  });
  if (catalog.length === 0) {
    return [];
  }
  return catalog
    .map((item) => ({
      item,
      score: scoreCatalogItemByText(item, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({
      ...entry.item,
      matchScore: entry.score,
    }));
}

export async function resolveCatalogItemForIncident(input) {
  const explicitCatalogItemId = normalizeText(input?.catalogItemId, 80);
  if (explicitCatalogItemId) {
    const byId = await getActiveCatalogItemById(explicitCatalogItemId);
    if (byId?.caseType === "incident") {
      return byId;
    }
  }
  const explicitCode = normalizeText(input?.code || input?.catalogCode, 120);
  if (explicitCode) {
    const byCode = await getActiveCatalogItemByCode(explicitCode);
    if (byCode?.caseType === "incident") {
      return byCode;
    }
  }

  const textCandidates = [
    normalizeText(input?.text, 500),
    normalizeText(input?.userText, 500),
    normalizeText(input?.description, 500),
    normalizeText(input?.category, 120),
  ]
    .filter(Boolean)
    .join(" ");
  if (!textCandidates) {
    return null;
  }
  const [best] = await searchCatalogItemsByUserText(textCandidates, { caseType: "incident" });
  return best || null;
}

export async function resolveCamundaProcessIdForCatalogItem(catalogItemId) {
  const item = await getActiveCatalogItemById(catalogItemId);
  return normalizeText(item?.camundaProcessId, 160) || null;
}

export async function resolveProcedureFromCatalog({ userText, interpretation }) {
  if (!hasDatabase()) {
    return {
      matched: false,
      procedure: null,
      confidence: 0,
      reason: "catalog_unavailable",
    };
  }

  const procedures = await listActiveProcedureCatalog();
  if (procedures.length === 0) {
    return {
      matched: false,
      procedure: null,
      confidence: 0,
      reason: "catalog_empty",
    };
  }

  const interpretedName = normalizeText(interpretation?.procedureCandidate?.name, 160);
  const interpretedCategory = normalizeText(interpretation?.procedureCandidate?.category, 80);
  const intentConfidence = interpretation?.intent?.confidence || 0;

  const scored = procedures
    .map((procedure) => ({
      procedure,
      score: scoreProcedureMatch({
        procedure,
        interpretedName,
        interpretedCategory,
        userText,
        intentConfidence,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const bestMatch = scored[0] || null;
  if (!bestMatch || bestMatch.score < 0.68) {
    return {
      matched: false,
      procedure: null,
      confidence: bestMatch?.score || 0,
      reason: "no_confident_match",
    };
  }

  return {
    matched: true,
    procedure: bestMatch.procedure,
    confidence: bestMatch.score,
    reason: "matched",
  };
}

function looksLikeHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed);
}

function pickFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceCanonicalImageOrFileObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const url =
    normalizeText(value.url, 2000) ||
    normalizeText(value.publicUrl, 2000) ||
    normalizeText(value.href, 2000);
  const filename =
    normalizeText(value.filename, 200) ||
    normalizeText(value.originalName, 200) ||
    normalizeText(value.name, 200) ||
    normalizeText(value.storageKey, 200) ||
    "";
  const mimeType = normalizeText(value.mimeType, 120) || "";
  const sizeRaw = value.size ?? value.sizeBytes;
  const size = Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null;
  const out = {};
  if (url) {
    out.url = url;
  }
  if (filename) {
    out.filename = filename;
  }
  if (mimeType) {
    out.mimeType = mimeType;
  }
  if (size != null) {
    out.size = size;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * @param {Record<string, unknown>} rawData
 * @param {string} procedureFieldKey
 * @param {Array<{ key?: string, type?: string }>} [_imageOrFileFieldDefinitions] reservado para extensiones; el fallback legacy aplica solo a keys photo/foto
 */
export function buildCanonicalImageOrFileFieldValue(rawData, procedureFieldKey, _imageOrFileFieldDefinitions) {
  const raw = rawData && typeof rawData === "object" ? rawData : {};
  const key = String(procedureFieldKey || "").trim();
  if (!key) {
    return null;
  }
  const direct = getCollectedDataValueByFieldKey(raw, key);
  if (typeof direct === "string" && direct.trim()) {
    const t = direct.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (looksLikeHttpUrl(t)) {
      return { url: t };
    }
    if (isValidImageReference(t)) {
      return { filename: t };
    }
  }
  const fromObject = coerceCanonicalImageOrFileObject(direct);
  if (fromObject) {
    return fromObject;
  }

  const allowLegacyPhotoBucket =
    normalizeLookup(key) === "photo" ||
    normalizeLookup(key) === "foto";
  if (!allowLegacyPhotoBucket) {
    return null;
  }
  const legacyUrl = normalizeText(raw.photoAttachmentPublicUrl, 2000);
  const legacyFilename =
    normalizeText(raw.photoAttachmentOriginalName, 200) ||
    normalizeText(raw.photoAttachmentStoredFilename, 120) ||
    normalizeText(raw.photoAttachmentStorageKey, 200);
  const legacyMime = normalizeText(raw.photoAttachmentMimeType, 120);
  const legacySize = Number(raw.photoAttachmentSizeBytes);
  if (!legacyUrl && !legacyFilename && !legacyMime && !Number.isFinite(legacySize)) {
    return null;
  }
  const out = {};
  if (legacyUrl) {
    out.url = legacyUrl;
  }
  if (legacyFilename) {
    out.filename = legacyFilename;
  }
  if (legacyMime) {
    out.mimeType = legacyMime;
  }
  if (Number.isFinite(legacySize)) {
    out.size = legacySize;
  }
  return out;
}

/**
 * @param {Record<string, unknown>} rawData
 * @param {string} procedureFieldKey
 * @param {Array<{ key?: string, type?: string }>} locationFieldDefinitions
 */
export function buildCanonicalLocationFieldValue(rawData, procedureFieldKey, locationFieldDefinitions) {
  const raw = rawData && typeof rawData === "object" ? rawData : {};
  const key = String(procedureFieldKey || "").trim();
  if (!key) {
    return null;
  }
  const locDefs = Array.isArray(locationFieldDefinitions) ? locationFieldDefinitions : [];
  const allowGlobalIncidentCoords = locDefs.length === 1 || normalizeLookup(key) === "location";

  const direct = getCollectedDataValueByFieldKey(raw, key);
  let lat = null;
  let lng = null;
  let address = "";
  let label = "";

  if (typeof direct === "string" && direct.trim()) {
    address = direct.replace(/\s+/g, " ").trim().slice(0, 500);
  } else if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    address =
      normalizeText(direct.address, 500) ||
      normalizeText(direct.text, 500) ||
      normalizeText(direct.location, 500);
    label = normalizeText(direct.label, 300) || normalizeText(direct.description, 300);
    lat = pickFiniteNumber(direct.lat ?? direct.latitude);
    lng = pickFiniteNumber(direct.lng ?? direct.longitude);
  }

  if (allowGlobalIncidentCoords) {
    if (lat == null) {
      lat = pickFiniteNumber(raw.locationLatitude);
    }
    if (lng == null) {
      lng = pickFiniteNumber(raw.locationLongitude);
    }
    if (!address) {
      address =
        normalizeText(raw.locationAddressText, 500) ||
        (normalizeLookup(key) === "location" ? normalizeText(raw.location, 500) : "");
    }
  }

  if (!label && address) {
    label = address.slice(0, 300);
  }

  const out = {};
  if (lat != null) {
    out.lat = lat;
  }
  if (lng != null) {
    out.lng = lng;
  }
  if (address) {
    out.address = address;
  }
  if (label && label !== address) {
    out.label = label.slice(0, 500);
  } else if (label && !address) {
    out.label = label.slice(0, 500);
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Indica si el valor ya satisface el campo según su tipo de catálogo (post-normalización).
 * @param {{ type?: string, key?: string }} field
 * @param {unknown} value
 */
export function catalogProcedureFieldHasPresentValue(field, value) {
  const type = normalizeLookup(field?.type || "");
  if (type === "image" || type === "file" || type === "attachment") {
    const obj = coerceCanonicalImageOrFileObject(value);
    if (obj?.url || obj?.filename) {
      return true;
    }
    if (typeof value === "string" && isValidImageReference(value.trim())) {
      return true;
    }
    return false;
  }
  if (type === "location") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const lat = pickFiniteNumber(value.lat ?? value.latitude);
      const lng = pickFiniteNumber(value.lng ?? value.longitude);
      if (lat != null && lng != null) {
        return true;
      }
      const addr =
        typeof value.address === "string"
          ? value.address.trim()
          : typeof value.text === "string"
            ? value.text.trim()
            : "";
      return addr.length >= 3;
    }
    if (typeof value === "string") {
      return value.trim().length >= 3;
    }
    return false;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return true;
  }
  if (typeof value === "boolean") {
    return true;
  }
  return Boolean(normalizeText(typeof value === "string" ? value : "", 320));
}

/**
 * Completa valores canónicos desde claves legacy solo si falta el dato oficial (p. ej. filas antiguas).
 * @param {Record<string, unknown>} collectedData
 * @param {Array<{ key?: string, type?: string, required?: boolean }>} fieldDefinitions
 */
export function augmentCollectedDataWithLegacyProcedureFields(collectedData = {}, fieldDefinitions = []) {
  const defs = normalizeProcedureFieldDefinitions(fieldDefinitions);
  const out = { ...(collectedData && typeof collectedData === "object" ? collectedData : {}) };
  const imageOrFileDefs = defs.filter((f) =>
    ["image", "file", "attachment"].includes(normalizeLookup(f?.type))
  );
  imageOrFileDefs.forEach((field) => {
    const key = String(field?.key || "").trim();
    if (!key) {
      return;
    }
    if (catalogProcedureFieldHasPresentValue(field, out[key])) {
      return;
    }
    const built = buildCanonicalImageOrFileFieldValue(out, key, imageOrFileDefs);
    if (built) {
      out[key] = built;
    }
  });
  const locDefs = defs.filter((field) => normalizeLookup(field?.type) === "location");
  locDefs.forEach((field) => {
    const key = String(field?.key || "").trim();
    if (!key) {
      return;
    }
    if (catalogProcedureFieldHasPresentValue(field, out[key])) {
      return;
    }
    const built = buildCanonicalLocationFieldValue(out, key, locDefs);
    if (built) {
      out[key] = built;
    }
  });
  return out;
}

export function normalizeProcedureCollectedData(collectedData) {
  const rawData = collectedData && typeof collectedData === "object" ? collectedData : {};
  const procedureFieldDefinitions = normalizeProcedureFieldDefinitions(
    rawData.procedureFieldDefinitions || rawData.procedureRequiredFields || []
  );
  const imageOrFileFieldDefinitions = procedureFieldDefinitions.filter((field) =>
    ["image", "file", "attachment"].includes(normalizeLookup(field?.type))
  );
  const locationFieldDefinitions = procedureFieldDefinitions.filter(
    (field) => normalizeLookup(field?.type) === "location"
  );
  const normalizedProcedureCode = normalizeLookup(rawData.procedureCode)
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 120);

  const normalized = {
    category: normalizeText(rawData.category, 80),
    subcategory: normalizeText(rawData.subcategory, 120),
    location: normalizeText(rawData.location),
    description: normalizeText(rawData.description),
    risk: normalizeText(rawData.risk, 120),
    photoStatus: normalizeText(rawData.photoStatus, 40) || "not_requested",
    procedureName: normalizeText(rawData.procedureName, 160),
    procedureDetails: normalizeText(rawData.procedureDetails, 320),
    procedureCode: normalizedProcedureCode,
    procedureCategory: normalizeText(rawData.procedureCategory, 80),
    procedureFieldDefinitions,
    // Deprecated alias: use procedureFieldDefinitions for all configured fields.
    requiredFields: procedureFieldDefinitions,
    // Deprecated alias for compatibility with older chatbot snapshots/tests.
    procedureRequiredFields: procedureFieldDefinitions,
  };

  procedureFieldDefinitions.forEach((field) => {
    const fieldKey = String(field?.key || "").trim();
    if (!fieldKey) {
      return;
    }
    const type = normalizeLookup(field?.type);
    if (type === "image" || type === "file" || type === "attachment") {
      const img = buildCanonicalImageOrFileFieldValue(rawData, fieldKey, imageOrFileFieldDefinitions);
      if (img) {
        normalized[fieldKey] = img;
      }
      return;
    }
    if (type === "location") {
      const loc = buildCanonicalLocationFieldValue(rawData, fieldKey, locationFieldDefinitions);
      if (loc) {
        normalized[fieldKey] = loc;
      }
      return;
    }
    normalized[fieldKey] = normalizeText(getCollectedDataValueByFieldKey(rawData, fieldKey), 320);
  });

  normalized.sttCriticalEchoPending = rawData.sttCriticalEchoPending === true;

  return normalized;
}

export function getProcedureFieldDefinition(requiredFields, fieldName) {
  const normalizedFieldName = normalizeFieldKeyLookup(fieldName, 60);
  if (!normalizedFieldName) {
    return null;
  }

  const normalizedFields = normalizeProcedureFieldDefinitions(requiredFields);
  return (
    normalizedFields.find((field) => normalizeFieldKeyLookup(field.key, 60) === normalizedFieldName) ||
    null
  );
}

export function getProcedureMissingFieldsFromDefinition(requiredFields, collectedData) {
  const normalizedFields = normalizeProcedureFieldDefinitions(requiredFields);
  const normalizedCollectedData = normalizeProcedureCollectedData(collectedData);
  if (normalizedFields.length === 0) {
    const fallbackMissing = [];
    if (!normalizedCollectedData.procedureName) {
      fallbackMissing.push("procedureName");
    }
    if (!normalizedCollectedData.procedureDetails) {
      fallbackMissing.push("procedureDetails");
    }
    return fallbackMissing;
  }

  return normalizedFields
    .filter((field) => field.required !== false)
    .filter((field) => !catalogProcedureFieldHasPresentValue(field, normalizedCollectedData[field.key]))
    .map((field) => field.key);
}

export function validateProcedureFieldInput({ fieldDefinition, inputValue }) {
  if (!fieldDefinition || typeof fieldDefinition !== "object") {
    const value = normalizeText(inputValue, 320);
    return {
      ok: Boolean(value),
      normalizedValue: value,
      error: value ? null : "Necesito un valor para continuar con el trámite.",
    };
  }

  if (
    (fieldDefinition.type === "image" ||
      fieldDefinition.type === "file" ||
      fieldDefinition.type === "attachment") &&
    inputValue &&
    typeof inputValue === "object"
  ) {
    const url =
      normalizeText(inputValue.url, 2000) ||
      normalizeText(inputValue.publicUrl, 2000) ||
      normalizeText(inputValue.href, 2000);
    const compact = url.trim();
    if (compact && isValidImageReference(compact)) {
      return { ok: true, normalizedValue: compact, error: null };
    }
    return {
      ok: false,
      normalizedValue: "",
      error: `El campo "${fieldDefinition.label}" requiere un archivo/imagen válido (URL o adjunto).`,
    };
  }

  if (fieldDefinition.type === "location" && inputValue && typeof inputValue === "object") {
    if (catalogProcedureFieldHasPresentValue(fieldDefinition, inputValue)) {
      const addr =
        normalizeText(inputValue.address, 500) ||
        normalizeText(inputValue.text, 500) ||
        normalizeText(inputValue.label, 500);
      return {
        ok: true,
        normalizedValue: addr || "ubicacion",
        error: null,
      };
    }
    return {
      ok: false,
      normalizedValue: "",
      error: `La ubicación para "${fieldDefinition.label}" parece incompleta.`,
    };
  }

  const value = normalizeText(inputValue, 320);

  if (!value) {
    return {
      ok: false,
      normalizedValue: "",
      error: `Necesito ${fieldDefinition.label || "este dato"} para continuar con el trámite.`,
    };
  }

  const validation = fieldDefinition.validation || {};
  if (validation.minLength && value.length < validation.minLength) {
    return {
      ok: false,
      normalizedValue: value,
      error: `El dato "${fieldDefinition.label}" debe tener al menos ${validation.minLength} caracteres.`,
    };
  }
  if (validation.maxLength && value.length > validation.maxLength) {
    return {
      ok: false,
      normalizedValue: value.slice(0, validation.maxLength),
      error: `El dato "${fieldDefinition.label}" supera el largo permitido.`,
    };
  }
  if (validation.pattern) {
    try {
      const regex = new RegExp(validation.pattern, "i");
      if (!regex.test(value)) {
        return {
          ok: false,
          normalizedValue: value,
          error: `El formato de "${fieldDefinition.label}" no es válido.`,
        };
      }
    } catch (_error) {
      // Ignore invalid patterns from catalog and keep flow usable.
    }
  }
  if (fieldDefinition.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      ok: false,
      normalizedValue: value,
      error: "El correo electrónico no tiene un formato válido.",
    };
  }
  if (fieldDefinition.type === "number" && !/^[0-9]+$/.test(value)) {
    return {
      ok: false,
      normalizedValue: value,
      error: `El dato "${fieldDefinition.label}" debe contener solo números.`,
    };
  }
  if (
    fieldDefinition.type === "number" &&
    fieldDefinition.validation &&
    Number.isInteger(fieldDefinition.validation.minLength) &&
    fieldDefinition.validation.minLength >= 2 &&
    value.length <= 2
  ) {
    const fieldKey = normalizeLookup(fieldDefinition.key || "");
    const looksLikePadron =
      fieldKey.includes("padron") || normalizeLookup(fieldDefinition.label || "").includes("padron");
    if (looksLikePadron) {
      return {
        ok: false,
        normalizedValue: value,
        error: `El dato "${fieldDefinition.label}" parece incompleto. Verifica el número de padrón.`,
      };
    }
  }
  if (fieldDefinition.type === "location") {
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length < 5) {
      return {
        ok: false,
        normalizedValue: value,
        error: `La ubicación para "${fieldDefinition.label}" parece incompleta.`,
      };
    }
  }
  if (fieldDefinition.type === "image" || fieldDefinition.type === "file") {
    const compact = value.trim();
    if (!isValidImageReference(compact)) {
      return {
        ok: false,
        normalizedValue: value,
        error: `El campo "${fieldDefinition.label}" requiere un archivo/imagen válido (URL o adjunto).`,
      };
    }
  }

  return {
    ok: true,
    normalizedValue: value,
    error: null,
  };
}

const PROCEDURE_CHAT_SUMMARY_VALUE_MAX = 220;

function formatProcedureFieldValueForSummary(field, rawValue) {
  const fieldType = normalizeText(field?.type, 40).toLowerCase();
  if (fieldType === "image" || fieldType === "file" || fieldType === "attachment") {
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const u = typeof rawValue.url === "string" ? rawValue.url.trim() : "";
      if (u) {
        return "Imagen adjunta";
      }
    }
    const compact = typeof rawValue === "string" ? rawValue.replace(/\s+/g, " ").trim() : "";
    if (!compact) {
      return "(pendiente)";
    }
    return "Imagen adjunta";
  }
  if (fieldType === "location") {
    if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      const addr = typeof rawValue.address === "string" ? rawValue.address.trim() : "";
      if (addr) {
        return addr.length > PROCEDURE_CHAT_SUMMARY_VALUE_MAX
          ? `${addr.slice(0, PROCEDURE_CHAT_SUMMARY_VALUE_MAX)}…`
          : addr;
      }
      if (rawValue.lat != null && rawValue.lng != null) {
        return `Coordenadas: ${rawValue.lat}, ${rawValue.lng}`;
      }
    }
    const compact =
      typeof rawValue === "string" ? rawValue.replace(/\s+/g, " ").trim() : "";
    if (!compact) {
      return "(pendiente)";
    }
    return compact.length > PROCEDURE_CHAT_SUMMARY_VALUE_MAX
      ? `${compact.slice(0, PROCEDURE_CHAT_SUMMARY_VALUE_MAX)}…`
      : compact;
  }
  const compact =
    typeof rawValue === "string" ? rawValue.replace(/\s+/g, " ").trim() : "";
  if (!compact) {
    return "(pendiente)";
  }
  if (fieldType === "boolean") {
    const lower = compact.toLowerCase();
    if (["sí", "si", "yes", "true", "1"].includes(lower)) {
      return "Sí";
    }
    if (["no", "false", "0"].includes(lower)) {
      return "No";
    }
  }
  if (compact.length > PROCEDURE_CHAT_SUMMARY_VALUE_MAX) {
    return `${compact.slice(0, PROCEDURE_CHAT_SUMMARY_VALUE_MAX)}…`;
  }
  return compact;
}

export function buildProcedureSummaryText({ procedureName, fieldDefinitions, requiredFields, collectedData }) {
  const normalizedProcedureName = normalizeText(procedureName, 160) || "Trámite";
  const normalizedFields = normalizeProcedureFieldDefinitions(fieldDefinitions || requiredFields || []);
  const normalizedData = normalizeProcedureCollectedData(collectedData);
  const lines = [
    `Resumen del trámite "${normalizedProcedureName}":`,
  ];

  normalizedFields.forEach((field) => {
    if (field.required === false) {
      return;
    }
    const value = formatProcedureFieldValueForSummary(field, normalizedData[field.key]);
    lines.push(`- ${field.label}: ${value}`);
  });

  lines.push("");
  lines.push("Si está correcto, confirma para continuar.");
  return lines.join("\n");
}

/** Texto de confirmación en el chat: resumen de datos capturados + instrucciones sí/no/corregir. */
export function buildProcedureDraftConfirmationText({
  procedureName,
  fieldDefinitions,
  requiredFields,
  collectedData,
}) {
  const normalizedProcedureName = normalizeText(procedureName, 160) || "este trámite";
  const normalizedFields = normalizeProcedureFieldDefinitions(fieldDefinitions || requiredFields || []);
  const normalizedData = normalizeProcedureCollectedData(collectedData);
  const pending = normalizedFields.filter(
    (field) =>
      field.required !== false && !catalogProcedureFieldHasPresentValue(field, normalizedData[field.key])
  );
  if (pending.length === 0) {
    const lines = [
      `Tengo los datos cargados para «${normalizedProcedureName}».`,
      "",
    ];
    normalizedFields.forEach((field) => {
      if (field.required === false) {
        return;
      }
      const value = formatProcedureFieldValueForSummary(field, normalizedData[field.key]);
      lines.push(`- ${field.label}: ${value}`);
    });
    lines.push("");
    lines.push(
      "Respondé sí para confirmar, no para cancelar, o escribí qué dato querés corregir."
    );
    return lines.join("\n");
  }
  const nextLabel = pending[0]?.label || "un dato pendiente";
  return [`Seguimos con «${normalizedProcedureName}».`, "", `Falta: ${nextLabel}.`].join("\n");
}

export async function findMatchingProcedure({ text, interpretation }) {
  const resolution = await resolveProcedureFromCatalog({
    userText: text,
    interpretation,
  });
  if (!resolution.matched || !resolution.procedure) {
    return null;
  }

  return {
    ...resolution.procedure,
    matchScore: resolution.confidence,
    matchReason: resolution.reason,
  };
}

export async function getProcedureByCode(code) {
  return getProcedureCatalogEntryByCode(code);
}

export function normalizeProcedureDisplayName(value) {
  return normalizeText(value, 160);
}


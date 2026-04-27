import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdministrator } from "../../../../lib/auth";
import {
  ensureProcedureCatalogSchema,
  getProcedureCatalogEntryByCode,
  listProcedureCatalog,
  replaceProcedureTypeCamundaVariableMappings,
  replaceProcedureTypeFields,
} from "../../../../lib/procedureCatalog";
import { ensureDatabase, hasDatabase } from "../../../../lib/db";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../../../../lib/i18n";

const PROCEDURE_ADMIN_MESSAGES = {
  es: {
    forbidden: "No autorizado.",
    dbRequired: "La administración del catálogo de procedimientos requiere base de datos configurada.",
    listError: "No se pudo cargar el catálogo de procedimientos.",
    createError: "No se pudo crear el procedimiento.",
    updateError: "No se pudo actualizar el procedimiento.",
    invalidBody: "La solicitud no tiene un formato válido.",
    missingCode: "El código del procedimiento es obligatorio.",
    missingName: "El nombre del procedimiento es obligatorio.",
    missingFields: "Debes configurar al menos un campo solicitado para el procedimiento.",
    missingCamundaProcessId: "El ID del proceso de Camunda es obligatorio.",
    invalidTechnicalFieldKey:
      "La key técnica de campo es inválida. Usá solo letras, números o guion bajo (sin espacios ni tildes).",
    missingChannels: "Debes habilitar al menos un canal.",
    duplicateCode: "Ya existe un procedimiento con ese código.",
    notFound: "No se encontró el procedimiento solicitado.",
    cannotDeleteActive: "No puedes eliminar un procedimiento activo. Primero debes deshabilitarlo.",
    deleteError: "No se pudo eliminar el procedimiento.",
  },
  en: {
    forbidden: "Unauthorized.",
    dbRequired: "Procedure catalog administration requires a configured database.",
    listError: "Could not load procedure catalog.",
    createError: "Could not create procedure.",
    updateError: "Could not update procedure.",
    invalidBody: "Request payload is invalid.",
    missingCode: "Procedure code is required.",
    missingName: "Procedure name is required.",
    missingFields: "At least one required field must be configured.",
    missingCamundaProcessId: "Camunda Process ID is required.",
    invalidTechnicalFieldKey:
      "Field technical key is invalid. Use only letters, numbers, or underscores (no spaces/accented/special chars).",
    missingChannels: "At least one channel must be enabled.",
    duplicateCode: "A procedure with that code already exists.",
    notFound: "Requested procedure was not found.",
    cannotDeleteActive: "Cannot delete an active procedure. Disable it first.",
    deleteError: "Could not delete procedure.",
  },
  pt: {
    forbidden: "Não autorizado.",
    dbRequired: "A administração do catálogo de procedimentos requer base de dados configurada.",
    listError: "Não foi possível carregar o catálogo de procedimentos.",
    createError: "Não foi possível criar o procedimento.",
    updateError: "Não foi possível atualizar o procedimento.",
    invalidBody: "Formato da solicitação inválido.",
    missingCode: "O código do procedimento é obrigatório.",
    missingName: "O nome do procedimento é obrigatório.",
    missingFields: "Configure ao menos um campo solicitado para o procedimento.",
    missingCamundaProcessId: "O ID do processo do Camunda é obrigatório.",
    invalidTechnicalFieldKey:
      "A chave técnica do campo é inválida. Use apenas letras, números ou sublinhado (sem espaços/acentos/caracteres especiais).",
    missingChannels: "Configure ao menos um canal habilitado.",
    duplicateCode: "Já existe um procedimento com esse código.",
    notFound: "Não foi encontrado o procedimento solicitado.",
    cannotDeleteActive: "Não é possível eliminar um procedimento ativo. Primeiro desabilite-o.",
    deleteError: "Não foi possível eliminar o procedimento.",
  },
};

function resolveRequestLocale(request, searchParams) {
  return (
    normalizeLocale(searchParams.get("locale")) ||
    resolveLocaleFromAcceptLanguage(request.headers.get("accept-language")) ||
    getDefaultLocale()
  );
}

function normalizeLookup(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCode(value) {
  const lookup = normalizeLookup(value);
  return lookup.replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 120);
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
  return normalizeLookup(value).replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, maxLength);
}

function normalizeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const normalized = normalizeText(item, maxLength);
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
  const allowed = new Set(["web", "whatsapp"]);
  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const channel = normalizeLookup(item);
    if (!allowed.has(channel) || seen.has(channel)) {
      return;
    }
    seen.add(channel);
    output.push(channel);
  });
  return output;
}

function normalizeRequiredFields(value, { strict = false } = {}) {
  if (!Array.isArray(value)) {
    return { fields: [], invalidKey: null };
  }

  const seenKeys = new Set();
  const output = [];
  let invalidKey = null;
  value.forEach((rawField, index) => {
    if (!rawField || typeof rawField !== "object") {
      return;
    }

    const hasExplicitKey = typeof rawField.key === "string" && rawField.key.trim().length > 0;
    const key =
      normalizeTechnicalFieldKey(rawField.key, 60) ||
      (!hasExplicitKey ? normalizeLegacyFieldKey(rawField.label || `field_${index + 1}`, 60) : "");
    if (hasExplicitKey && !key) {
      if (!invalidKey) {
        invalidKey = normalizeText(rawField.key, 120);
      }
      return;
    }
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const minLength =
      Number.isInteger(rawField?.validation?.minLength) && rawField.validation.minLength > 0
        ? rawField.validation.minLength
        : null;
    const maxLength =
      Number.isInteger(rawField?.validation?.maxLength) && rawField.validation.maxLength >= 1
        ? rawField.validation.maxLength
        : null;
    const pattern = normalizeText(rawField?.validation?.pattern, 120);
    const validation = {};
    if (minLength) {
      validation.minLength = minLength;
    }
    if (maxLength) {
      validation.maxLength = maxLength;
    }
    if (pattern) {
      validation.pattern = pattern;
    }

    output.push({
      key,
      label: normalizeText(rawField.label || key, 120),
      prompt: normalizeText(rawField.prompt || `Indícame ${rawField.label || key}.`, 280),
      type: normalizeLookup(rawField.type || "text") || "text",
      required: rawField.required !== false,
      options: normalizeStringArray(rawField.options || [], 80),
      validation,
      order: Number.isInteger(rawField.order) ? rawField.order : index,
    });
  });

  if (strict && invalidKey) {
    return { fields: [], invalidKey };
  }
  return { fields: output.sort((a, b) => a.order - b.order), invalidKey: null };
}

function normalizeCamundaVariableMappings(value, { strict = false } = {}) {
  if (!Array.isArray(value)) {
    return { mappings: [], invalidFieldKey: null };
  }
  const mappings = [];
  let invalidFieldKey = null;
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const scope = normalizeLookup(entry.scope || "start_instance").toUpperCase();
    const normalizedScope = scope === "COMPLETE_TASK" ? "COMPLETE_TASK" : "START_INSTANCE";
    const taskDefinitionKey =
      normalizedScope === "COMPLETE_TASK"
        ? normalizeText(entry.camundaTaskDefinitionKey, 160) || null
        : null;
    const hasExplicitFieldKey =
      typeof entry.procedureFieldKey === "string" && entry.procedureFieldKey.trim().length > 0;
    const procedureFieldKey =
      normalizeTechnicalFieldKey(entry.procedureFieldKey, 60) ||
      (!hasExplicitFieldKey ? normalizeLegacyFieldKey(entry.procedureFieldKey || "", 60) : "");
    if (hasExplicitFieldKey && !procedureFieldKey) {
      if (!invalidFieldKey) {
        invalidFieldKey = normalizeText(entry.procedureFieldKey, 120);
      }
      return;
    }
    const camundaVariableName = normalizeText(entry.camundaVariableName, 160);
    if (!procedureFieldKey || !camundaVariableName) {
      return;
    }
    const camundaVariableType = normalizeLookup(entry.camundaVariableType || "string");
    mappings.push({
      scope: normalizedScope,
      camundaTaskDefinitionKey: taskDefinitionKey,
      procedureFieldKey,
      camundaVariableName,
      camundaVariableType: ["string", "number", "boolean", "json", "date"].includes(camundaVariableType)
        ? camundaVariableType
        : "string",
      required: entry.required !== false,
      enabled: entry.enabled !== false,
    });
  });
  if (strict && invalidFieldKey) {
    return { mappings: [], invalidFieldKey };
  }
  return { mappings, invalidFieldKey: null };
}

function validateCamundaVariableMappings(mappings, requiredFields) {
  const fieldKeys = new Set(
    (Array.isArray(requiredFields) ? requiredFields : [])
      .map((field) => normalizeTechnicalFieldKey(field?.key || "", 60))
      .filter(Boolean)
  );
  const seenVariableNames = new Set();
  for (const mapping of mappings) {
    if (!fieldKeys.has(mapping.procedureFieldKey)) {
      return {
        ok: false,
        error: `El campo "${mapping.procedureFieldKey}" no existe en los campos solicitados del procedimiento.`,
      };
    }
    if (!normalizeText(mapping.camundaVariableName, 160)) {
      return {
        ok: false,
        error: "camundaVariableName es obligatorio en todos los mappings.",
      };
    }
    const dedupeKey = [
      mapping.scope,
      mapping.camundaTaskDefinitionKey || "",
      normalizeText(mapping.camundaVariableName, 160).toLowerCase(),
    ].join("|");
    if (seenVariableNames.has(dedupeKey)) {
      return {
        ok: false,
        error:
          "No se permiten mappings duplicados para la misma combinación de scope, camundaTaskDefinitionKey y camundaVariableName.",
      };
    }
    seenVariableNames.add(dedupeKey);
    if (mapping.scope === "COMPLETE_TASK" && !normalizeText(mapping.camundaTaskDefinitionKey, 160)) {
      return {
        ok: false,
        error: "Los mappings COMPLETE_TASK requieren camundaTaskDefinitionKey.",
      };
    }
    if (mapping.scope === "START_INSTANCE" && mapping.camundaTaskDefinitionKey) {
      return {
        ok: false,
        error: "Los mappings START_INSTANCE no deben incluir camundaTaskDefinitionKey.",
      };
    }
  }
  return { ok: true };
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
  Object.entries(citizenInfoTasksInput).forEach(([taskKey, rawConfig]) => {
    const normalizedTaskKey = normalizeText(taskKey, 160);
    if (!normalizedTaskKey || !rawConfig || typeof rawConfig !== "object") {
      return;
    }
    const fieldKey = normalizeTechnicalFieldKey(rawConfig.fieldKey, 60);
    const prompt = normalizeText(rawConfig.prompt, 280);
    if (!fieldKey || !prompt) {
      return;
    }
    citizenInfoTasks[normalizedTaskKey] = { fieldKey, prompt };
  });
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
  taskUiDictionaryInput.forEach((rawTaskConfig) => {
    if (!rawTaskConfig || typeof rawTaskConfig !== "object") {
      return;
    }
    const taskDefinitionKey = normalizeText(rawTaskConfig.taskDefinitionKey, 160);
    if (!taskDefinitionKey) {
      return;
    }
    const title = normalizeText(rawTaskConfig.title, 180);
    const description = normalizeText(rawTaskConfig.description, 320);
    const primaryActionLabel = normalizeText(rawTaskConfig.primaryActionLabel, 120);
    const requiredVariablesInput = Array.isArray(rawTaskConfig.requiredVariables)
      ? rawTaskConfig.requiredVariables
      : [];
    const requiredVariables = [];
    requiredVariablesInput.forEach((rawVariable) => {
      if (!rawVariable || typeof rawVariable !== "object") {
        return;
      }
      const camundaVariableName = normalizeText(rawVariable.camundaVariableName, 160);
      const procedureFieldKey = normalizeTechnicalFieldKey(rawVariable.procedureFieldKey, 60);
      if (!camundaVariableName && !procedureFieldKey) {
        return;
      }
      const camundaVariableType = normalizeLookup(rawVariable.camundaVariableType || "string");
      requiredVariables.push({
        ...(camundaVariableName ? { camundaVariableName } : {}),
        ...(procedureFieldKey ? { procedureFieldKey } : {}),
        label: normalizeText(rawVariable.label, 120),
        camundaVariableType: ["string", "number", "boolean", "json", "date"].includes(camundaVariableType)
          ? camundaVariableType
          : "string",
        required: rawVariable.required !== false,
      });
    });
    taskUiDictionary.push({
      taskDefinitionKey,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(primaryActionLabel ? { primaryActionLabel } : {}),
      ...(requiredVariables.length ? { requiredVariables } : {}),
    });
  });
  return {
    ...(completionMessage ? { completionMessage } : {}),
    ...(completionOutcomeVariable ? { completionOutcomeVariable } : {}),
    ...(completionOutcomeResolvedValue ? { completionOutcomeResolvedValue } : {}),
    ...(Object.keys(citizenInfoTasks).length > 0 ? { citizenInfoTasks } : {}),
    ...(taskUiDictionary.length > 0 ? { taskUiDictionary } : {}),
  };
}

function normalizeProcedurePayload(rawPayload, messages) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : null;
  if (!payload) {
    return { ok: false, error: messages.invalidBody };
  }

  const code = normalizeCode(payload.code);
  if (!code) {
    return { ok: false, error: messages.missingCode };
  }
  const name = normalizeText(payload.name, 160);
  if (!name) {
    return { ok: false, error: messages.missingName };
  }

  const requiredFieldsResult = normalizeRequiredFields(payload.fieldDefinitions || payload.requiredFields || [], {
    strict: true,
  });
  if (requiredFieldsResult.invalidKey) {
    return {
      ok: false,
      error: `${messages.invalidTechnicalFieldKey} (key="${requiredFieldsResult.invalidKey}")`,
    };
  }
  const fieldDefinitions = requiredFieldsResult.fields;
  if (fieldDefinitions.length === 0) {
    return { ok: false, error: messages.missingFields };
  }
  const camundaProcessId = normalizeText(payload.camundaProcessId, 160);
  if (!camundaProcessId) {
    return { ok: false, error: messages.missingCamundaProcessId };
  }
  const enabledChannels = normalizeEnabledChannels(payload.enabledChannels);
  if (enabledChannels.length === 0) {
    return { ok: false, error: messages.missingChannels };
  }

  const mappingsResult = normalizeCamundaVariableMappings(payload.camundaVariableMappings, {
    strict: true,
  });
  if (mappingsResult.invalidFieldKey) {
    return {
      ok: false,
      error: `${messages.invalidTechnicalFieldKey} (key="${mappingsResult.invalidFieldKey}")`,
    };
  }
  const camundaVariableMappings = mappingsResult.mappings;
  const mappingsValidation = validateCamundaVariableMappings(camundaVariableMappings, fieldDefinitions);
  if (!mappingsValidation.ok) {
    return { ok: false, error: mappingsValidation.error };
  }

  return {
    ok: true,
    value: {
      code,
      name,
      description: normalizeText(payload.description, 320),
      category: normalizeText(payload.category, 80),
      aliases: normalizeStringArray(payload.aliases || [], 120),
      keywords: normalizeStringArray(payload.keywords || [], 120),
      isActive: payload.isActive !== false,
      camundaProcessId,
      camundaVersion: normalizeText(payload.camundaVersion, 80),
      enabledChannels,
      fieldDefinitions,
      // Deprecated alias for backward-compatible payload handling.
      requiredFields: fieldDefinitions,
      camundaVariableMappings,
      flowDefinition: normalizeFlowDefinition(payload.flowDefinition),
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    await ensureProcedureCatalogSchema();
    const includeInactive = normalizeLookup(searchParams.get("includeInactive")) === "true";
    const procedures = await listProcedureCatalog({ includeInactive });
    return NextResponse.json({ procedures });
  } catch (_error) {
    return NextResponse.json({ error: messages.listError }, { status: 500 });
  }
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }
    const normalized = normalizeProcedurePayload(body, messages);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const sql = ensureDatabase();
    const [existing] = await sql`
      SELECT id
      FROM chatbot_procedure_catalog
      WHERE code = ${normalized.value.code}
        AND case_type = 'procedure'
      LIMIT 1;
    `;
    if (existing) {
      return NextResponse.json({ error: messages.duplicateCode }, { status: 409 });
    }

    const [created] = await sql`
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
        camunda_process_id,
        version,
        enabled_channels_json,
        required_fields_json,
        flow_definition_json,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${normalized.value.code},
        ${normalized.value.name},
        ${normalized.value.description},
        ${normalized.value.category},
        'procedure',
        ${JSON.stringify(normalized.value.aliases)}::jsonb,
        ${JSON.stringify(normalized.value.keywords)}::jsonb,
        ${normalized.value.isActive},
        ${normalized.value.camundaProcessId},
        ${normalized.value.camundaVersion || null},
        ${JSON.stringify(normalized.value.enabledChannels)}::jsonb,
        ${JSON.stringify(normalized.value.fieldDefinitions)}::jsonb,
        ${JSON.stringify(normalized.value.flowDefinition)}::jsonb,
        NOW()
      )
      RETURNING id, code;
    `;

    if (created?.id) {
      await replaceProcedureTypeFields(created.id, normalized.value.fieldDefinitions);
      await replaceProcedureTypeCamundaVariableMappings(
        created.id,
        normalized.value.camundaVariableMappings
      );
    }

    const procedure = await getProcedureCatalogEntryByCode(created?.code || normalized.value.code, {
      includeInactive: true,
    });
    return NextResponse.json(
      { ok: true, code: created?.code || normalized.value.code, procedure },
      { status: 201 }
    );
  } catch (_error) {
    return NextResponse.json({ error: messages.createError }, { status: 500 });
  }
}

export async function PATCH(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const originalCode = normalizeCode(body?.originalCode || body?.code);
    const code = normalizeCode(body?.code || body?.originalCode);
    if (!code) {
      return NextResponse.json({ error: messages.missingCode }, { status: 400 });
    }

    const existingProcedure = await getProcedureCatalogEntryByCode(originalCode, {
      includeInactive: true,
    });
    if (!existingProcedure) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }

    const isStatusOnlyPatch =
      typeof body?.isActive === "boolean" &&
      typeof body?.name !== "string" &&
      typeof body?.description !== "string" &&
      typeof body?.category !== "string" &&
      !Array.isArray(body?.requiredFields) &&
      !Array.isArray(body?.aliases) &&
      !Array.isArray(body?.keywords);

    if (isStatusOnlyPatch) {
      const sql = ensureDatabase();
      const [updated] = await sql`
        UPDATE chatbot_procedure_catalog
        SET
          is_active = ${body.isActive},
          updated_at = NOW()
        WHERE code = ${originalCode}
          AND case_type = 'procedure'
        RETURNING code;
      `;
      if (!updated) {
        return NextResponse.json({ error: messages.notFound }, { status: 404 });
      }

      const procedure = await getProcedureCatalogEntryByCode(updated.code, {
        includeInactive: true,
      });
      return NextResponse.json({ ok: true, code: updated.code, procedure });
    }

    const normalized = normalizeProcedurePayload(
      {
        ...existingProcedure,
        ...body,
        code,
        isActive:
          typeof body?.isActive === "boolean"
            ? body.isActive
            : Boolean(existingProcedure.isActive),
      },
      messages
    );
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const sql = ensureDatabase();
    if (code !== originalCode) {
      const [duplicateCode] = await sql`
        SELECT id
        FROM chatbot_procedure_catalog
        WHERE code = ${code}
          AND case_type = 'procedure'
          AND code <> ${originalCode}
        LIMIT 1;
      `;
      if (duplicateCode) {
        return NextResponse.json({ error: messages.duplicateCode }, { status: 409 });
      }
    }

    const [updated] = await sql`
      UPDATE chatbot_procedure_catalog
      SET
        code = ${normalized.value.code},
        name = ${normalized.value.name},
        description = ${normalized.value.description},
        category = ${normalized.value.category},
        aliases_json = ${JSON.stringify(normalized.value.aliases)}::jsonb,
        keywords_json = ${JSON.stringify(normalized.value.keywords)}::jsonb,
        is_active = ${normalized.value.isActive},
        camunda_process_id = ${normalized.value.camundaProcessId},
        version = ${normalized.value.camundaVersion || null},
        enabled_channels_json = ${JSON.stringify(normalized.value.enabledChannels)}::jsonb,
        required_fields_json = ${JSON.stringify(normalized.value.fieldDefinitions)}::jsonb,
        flow_definition_json = ${JSON.stringify(normalized.value.flowDefinition)}::jsonb,
        updated_at = NOW()
      WHERE code = ${originalCode}
        AND case_type = 'procedure'
      RETURNING id, code;
    `;
    if (!updated) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }

    await replaceProcedureTypeFields(updated.id, normalized.value.fieldDefinitions);
    await replaceProcedureTypeCamundaVariableMappings(
      updated.id,
      normalized.value.camundaVariableMappings
    );

    const procedure = await getProcedureCatalogEntryByCode(updated.code, {
      includeInactive: true,
    });
    return NextResponse.json({ ok: true, code: updated.code, procedure });
  } catch (_error) {
    return NextResponse.json({ error: messages.updateError }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }

    const code = normalizeCode(body?.code);
    if (!code) {
      return NextResponse.json({ error: messages.missingCode }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const sql = ensureDatabase();
    const [existing] = await sql`
      SELECT code, is_active
      FROM chatbot_procedure_catalog
      WHERE code = ${code}
        AND case_type = 'procedure'
      LIMIT 1;
    `;
    if (!existing) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }
    if (existing.is_active) {
      return NextResponse.json({ error: messages.cannotDeleteActive }, { status: 400 });
    }

    const [deleted] = await sql`
      DELETE FROM chatbot_procedure_catalog
      WHERE code = ${code}
        AND case_type = 'procedure'
      RETURNING code;
    `;

    return NextResponse.json({ ok: true, code: deleted.code });
  } catch (_error) {
    return NextResponse.json({ error: messages.deleteError }, { status: 500 });
  }
}

import {
  getProcedureCatalogEntryById,
  listProcedureTypeCamundaVariableMappings,
} from "../procedureCatalog";

const MAPPING_SCOPES = {
  START_INSTANCE: "START_INSTANCE",
  COMPLETE_TASK: "COMPLETE_TASK",
};

function normalizeScope(value) {
  return String(value || "").trim().toUpperCase() === MAPPING_SCOPES.COMPLETE_TASK
    ? MAPPING_SCOPES.COMPLETE_TASK
    : MAPPING_SCOPES.START_INSTANCE;
}

function normalizeLookup(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function looksLikeUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed);
}

function normalizeText(value, maxLength = 500) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function normalizeNumeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLocationValue(rawValue) {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue === "string") {
    const text = normalizeText(rawValue, 500);
    return text ? { text } : null;
  }
  if (typeof rawValue !== "object") {
    return null;
  }
  const text =
    normalizeText(rawValue.text, 500) ||
    normalizeText(rawValue.address, 500) ||
    normalizeText(rawValue.location, 500) ||
    normalizeText(rawValue.description, 500);
  const latitude =
    normalizeNumeric(rawValue.latitude) ??
    normalizeNumeric(rawValue.lat) ??
    normalizeNumeric(rawValue.locationLatitude);
  const longitude =
    normalizeNumeric(rawValue.longitude) ??
    normalizeNumeric(rawValue.lng) ??
    normalizeNumeric(rawValue.lon) ??
    normalizeNumeric(rawValue.locationLongitude);
  if (!text && latitude == null && longitude == null) {
    return null;
  }
  return {
    ...(text ? { text } : {}),
    ...(latitude != null ? { latitude } : {}),
    ...(longitude != null ? { longitude } : {}),
  };
}

function normalizeFileLikeValue(rawValue) {
  if (rawValue == null) {
    return null;
  }
  if (typeof rawValue === "string") {
    const text = normalizeText(rawValue, 2000);
    if (!text) {
      return null;
    }
    return looksLikeUrl(text) ? text : null;
  }
  if (typeof rawValue !== "object") {
    return null;
  }
  const url =
    normalizeText(rawValue.publicUrl, 2000) ||
    normalizeText(rawValue.url, 2000) ||
    normalizeText(rawValue.href, 2000);
  const mimeType = normalizeText(rawValue.mimeType, 120);
  const originalName = normalizeText(rawValue.originalName, 200);
  const uploadedAt = normalizeText(rawValue.uploadedAt, 120);
  const output = {
    ...(url ? { url } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(originalName ? { originalName } : {}),
    ...(uploadedAt ? { uploadedAt } : {}),
  };
  if (Object.keys(output).length > 0) {
    return output;
  }
  // Último recurso para no enviar estructura técnica irrelevante.
  return null;
}

function normalizeFieldTypeToCamundaType(fieldType) {
  const lookup = normalizeLookup(fieldType);
  if (lookup === "number") {
    return "number";
  }
  if (lookup === "boolean") {
    return "boolean";
  }
  if (lookup === "date") {
    return "date";
  }
  if (lookup === "json") {
    return "json";
  }
  if (lookup === "location") {
    return "json";
  }
  if (lookup === "image" || lookup === "file" || lookup === "attachment") {
    return "json";
  }
  return "string";
}

function getConfiguredFieldDefinitions(procedureType) {
  if (Array.isArray(procedureType?.fieldDefinitions)) {
    return procedureType.fieldDefinitions;
  }
  if (Array.isArray(procedureType?.requiredFields)) {
    // Legado: en el catálogo actual `requiredFields` contiene todos los campos configurados
    // y cada entrada marca obligatoriedad con `required`.
    return procedureType.requiredFields;
  }
  return [];
}

function buildFieldMappingsFromProcedureDefinition(procedureType) {
  const fieldDefinitions = getConfiguredFieldDefinitions(procedureType);
  const seen = new Set();
  const mappings = [];
  fieldDefinitions.forEach((field) => {
    const procedureFieldKey = String(field?.key || "").trim();
    if (!procedureFieldKey || seen.has(procedureFieldKey)) {
      return;
    }
    seen.add(procedureFieldKey);
    mappings.push({
      scope: MAPPING_SCOPES.START_INSTANCE,
      camundaTaskDefinitionKey: null,
      procedureFieldKey,
      camundaVariableName: procedureFieldKey,
      camundaVariableType: normalizeFieldTypeToCamundaType(field?.type),
      procedureFieldType: normalizeLookup(field?.type),
      required: field?.required !== false,
      enabled: true,
    });
  });
  return mappings;
}

function preprocessValueByFieldType(rawValue, fieldType) {
  const lookup = normalizeLookup(fieldType);
  if (lookup === "location") {
    return normalizeLocationValue(rawValue);
  }
  if (lookup === "image" || lookup === "file" || lookup === "attachment") {
    return normalizeFileLikeValue(rawValue);
  }
  return rawValue;
}

function convertVariableValue(rawValue, variableType) {
  if (rawValue == null) {
    return null;
  }
  switch (variableType) {
    case "number": {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        throw new Error("Valor no numérico.");
      }
      return parsed;
    }
    case "boolean": {
      if (typeof rawValue === "boolean") {
        return rawValue;
      }
      const lookup = normalizeLookup(String(rawValue));
      if (["true", "1", "si", "sí", "yes"].includes(lookup)) {
        return true;
      }
      if (["false", "0", "no"].includes(lookup)) {
        return false;
      }
      throw new Error("Valor booleano inválido.");
    }
    case "json": {
      if (typeof rawValue === "object") {
        return rawValue;
      }
      if (typeof rawValue === "string") {
        try {
          return JSON.parse(rawValue);
        } catch (_error) {
          throw new Error("JSON inválido.");
        }
      }
      return rawValue;
    }
    case "date": {
      const date = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
      if (Number.isNaN(date.getTime())) {
        throw new Error("Fecha inválida.");
      }
      return date.toISOString();
    }
    default:
      return String(rawValue);
  }
}

function hasValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

export class CamundaVariableMappingValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CamundaVariableMappingValidationError";
    this.details = details;
  }
}

export class CamundaVariableMapperService {
  async buildVariables({
    procedureTypeId,
    scope,
    taskDefinitionKey = null,
    collectedData = {},
    requireMappings = false,
    includeProcedureFieldDefinitions = false,
  }) {
    const normalizedProcedureTypeId = String(procedureTypeId || "").trim();
    if (!normalizedProcedureTypeId) {
      throw new CamundaVariableMappingValidationError("procedureTypeId es obligatorio.");
    }
    const normalizedScope = normalizeScope(scope);
    const normalizedTaskDefinitionKey =
      normalizedScope === MAPPING_SCOPES.COMPLETE_TASK
        ? String(taskDefinitionKey || "").trim()
        : "";

    const procedureType = await getProcedureCatalogEntryById(normalizedProcedureTypeId, {
      includeInactive: true,
    });
    if (!procedureType) {
      throw new CamundaVariableMappingValidationError("No existe el tipo de procedimiento configurado.");
    }

    const mappings = await listProcedureTypeCamundaVariableMappings(normalizedProcedureTypeId);
    const fieldDefinitions = getConfiguredFieldDefinitions(procedureType);
    const fieldDefinitionByKey = new Map(
      fieldDefinitions
        .map((field) => {
          const key = String(field?.key || "").trim();
          return key ? [key, field] : null;
        })
        .filter(Boolean)
    );
    const scopedMappings = mappings.filter((mapping) => {
      if (mapping.enabled === false || normalizeScope(mapping.scope) !== normalizedScope) {
        return false;
      }
      if (normalizedScope !== MAPPING_SCOPES.COMPLETE_TASK) {
        return true;
      }
      return String(mapping.camundaTaskDefinitionKey || "").trim() === normalizedTaskDefinitionKey;
    });

    let effectiveMappings = [...scopedMappings].map((mapping) => {
      const procedureFieldKey = String(mapping?.procedureFieldKey || "").trim();
      const fieldType = fieldDefinitionByKey.get(procedureFieldKey)?.type;
      return {
        ...mapping,
        procedureFieldType: normalizeLookup(fieldType),
      };
    });
    if (includeProcedureFieldDefinitions && normalizedScope === MAPPING_SCOPES.START_INSTANCE) {
      const configuredFieldKeys = new Set(
        effectiveMappings.map((mapping) => String(mapping?.procedureFieldKey || "").trim()).filter(Boolean)
      );
      const fallbackFieldMappings = buildFieldMappingsFromProcedureDefinition(procedureType).filter(
        (mapping) => !configuredFieldKeys.has(String(mapping?.procedureFieldKey || "").trim())
      );
      effectiveMappings = [...scopedMappings, ...fallbackFieldMappings];
    }

    if (effectiveMappings.length === 0) {
      if (requireMappings) {
        throw new CamundaVariableMappingValidationError(
          "No hay mappings configurados para el scope indicado.",
          {
            scope: normalizedScope,
            taskDefinitionKey: normalizedTaskDefinitionKey || null,
            missingMappings: true,
          }
        );
      }
      return {};
    }

    const variables = {};
    const missingRequired = [];
    const invalidValues = [];
    for (const mapping of effectiveMappings) {
      const rawValue = collectedData?.[mapping.procedureFieldKey];
      const normalizedRawValue = preprocessValueByFieldType(rawValue, mapping?.procedureFieldType);
      if (!hasValue(normalizedRawValue)) {
        if (mapping.sendNullWhenMissing === true) {
          variables[mapping.camundaVariableName] = null;
          continue;
        }
        if (mapping.required !== false) {
          missingRequired.push(mapping.procedureFieldKey);
        }
        continue;
      }
      try {
        variables[mapping.camundaVariableName] = convertVariableValue(
          normalizedRawValue,
          mapping.camundaVariableType
        );
      } catch (error) {
        invalidValues.push({
          field: mapping.procedureFieldKey,
          variable: mapping.camundaVariableName,
          reason: error?.message || "Valor inválido.",
        });
      }
    }

    if (missingRequired.length > 0 || invalidValues.length > 0) {
      throw new CamundaVariableMappingValidationError(
        "No se pudieron construir las variables para Camunda.",
        {
          missingRequired,
          invalidValues,
          scope: normalizedScope,
          taskDefinitionKey: normalizedTaskDefinitionKey || null,
        }
      );
    }

    return variables;
  }
}

export const camundaVariableMapper = new CamundaVariableMapperService();

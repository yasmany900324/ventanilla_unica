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
  async buildVariables({ procedureTypeId, scope, taskDefinitionKey = null, collectedData = {} }) {
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
    const scopedMappings = mappings.filter((mapping) => {
      if (mapping.enabled === false || normalizeScope(mapping.scope) !== normalizedScope) {
        return false;
      }
      if (normalizedScope !== MAPPING_SCOPES.COMPLETE_TASK) {
        return true;
      }
      return String(mapping.camundaTaskDefinitionKey || "").trim() === normalizedTaskDefinitionKey;
    });

    if (scopedMappings.length === 0) {
      return {};
    }

    const variables = {};
    const missingRequired = [];
    const invalidValues = [];
    for (const mapping of scopedMappings) {
      const rawValue = collectedData?.[mapping.procedureFieldKey];
      if (!hasValue(rawValue)) {
        if (mapping.required !== false) {
          missingRequired.push(mapping.procedureFieldKey);
        }
        continue;
      }
      try {
        variables[mapping.camundaVariableName] = convertVariableValue(
          rawValue,
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

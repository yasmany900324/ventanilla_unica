import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProcedureCatalogEntryById: vi.fn(),
  listProcedureTypeCamundaVariableMappings: vi.fn(),
}));

vi.mock("../../procedureCatalog", () => ({
  getProcedureCatalogEntryById: mocks.getProcedureCatalogEntryById,
  listProcedureTypeCamundaVariableMappings: mocks.listProcedureTypeCamundaVariableMappings,
}));

import {
  CamundaVariableMappingValidationError,
  CamundaVariableMapperService,
} from "../CamundaVariableMapperService";

describe("CamundaVariableMapperService", () => {
  const service = new CamundaVariableMapperService();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [],
    });
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([
      {
        scope: "START_INSTANCE",
        procedureFieldKey: "description",
        camundaVariableName: "descripcion",
        camundaVariableType: "string",
        required: true,
        enabled: true,
      },
    ]);
  });

  it("construye variables para START_INSTANCE", async () => {
    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      collectedData: { description: "texto" },
    });
    expect(result).toEqual({ descripcion: "texto" });
  });

  it("falla si falta variable obligatoria", async () => {
    await expect(
      service.buildVariables({
        procedureTypeId: "proc-1",
        scope: "START_INSTANCE",
        collectedData: {},
      })
    ).rejects.toBeInstanceOf(CamundaVariableMappingValidationError);
  });

  it("rechaza scope sin mappings cuando requireMappings=true", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    await expect(
      service.buildVariables({
        procedureTypeId: "proc-1",
        scope: "START_INSTANCE",
        collectedData: {},
        requireMappings: true,
      })
    ).rejects.toBeInstanceOf(CamundaVariableMappingValidationError);
  });

  it("filtra mappings de tarea por taskDefinitionKey", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([
      {
        scope: "COMPLETE_TASK",
        camundaTaskDefinitionKey: "Task_A",
        procedureFieldKey: "decision",
        camundaVariableName: "decision",
        camundaVariableType: "string",
        required: true,
        enabled: true,
      },
      {
        scope: "COMPLETE_TASK",
        camundaTaskDefinitionKey: "Task_B",
        procedureFieldKey: "decision",
        camundaVariableName: "decision_b",
        camundaVariableType: "string",
        required: true,
        enabled: true,
      },
    ]);
    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "COMPLETE_TASK",
      taskDefinitionKey: "Task_A",
      collectedData: { decision: "aprobar" },
    });
    expect(result).toEqual({ decision: "aprobar" });
  });

  it("incluye campos definidos del procedimiento cuando se habilita fallback", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [
        { key: "description", type: "text", required: true },
        { key: "padron", type: "number", required: true },
        { key: "acepta_notificaciones", type: "boolean", required: false },
      ],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {
        description: "Necesito habilitación",
        padron: "12345",
        acepta_notificaciones: "si",
      },
    });
    expect(result).toEqual({
      description: "Necesito habilitación",
      padron: 12345,
      acepta_notificaciones: true,
    });
  });

  it("incluye campo opcional sin mapping cuando tiene valor", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [{ key: "observaciones", type: "text", required: false }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: { observaciones: "Dato opcional" },
    });
    expect(result).toEqual({ observaciones: "Dato opcional" });
  });

  it("prioriza mapping explícito sobre fallback para el mismo campo", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([
      {
        scope: "START_INSTANCE",
        procedureFieldKey: "description",
        camundaVariableName: "descripcion_camunda",
        camundaVariableType: "string",
        required: true,
        enabled: true,
      },
    ]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [{ key: "description", type: "text", required: true }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: { description: "Texto" },
    });
    expect(result).toEqual({ descripcion_camunda: "Texto" });
    expect(result.description).toBeUndefined();
  });

  it("normaliza ubicación como json cuando no hay mapping explícito", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [{ key: "location", type: "location", required: false }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {
        location: {
          text: "Av. Principal y Calle 2",
          latitude: -34.9011,
          longitude: -56.1645,
        },
      },
    });
    expect(result).toEqual({
      location: {
        text: "Av. Principal y Calle 2",
        latitude: -34.9011,
        longitude: -56.1645,
      },
    });
  });

  it("normaliza imagen como url/json útil cuando no hay mapping explícito", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [{ key: "photo", type: "image", required: false }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {
        photo: {
          publicUrl: "https://example.org/files/photo.jpg",
          mimeType: "image/jpeg",
          originalName: "foto.jpg",
        },
      },
    });
    expect(result).toEqual({
      photo: {
        url: "https://example.org/files/photo.jpg",
        mimeType: "image/jpeg",
        originalName: "foto.jpg",
      },
    });
  });

  it("no envía campo configurado sin valor recolectado", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      requiredFields: [{ key: "detalle_opcional", type: "text", required: false }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {},
    });
    expect(result).toEqual({});
  });

  it("usa fieldDefinitions como fuente principal y conserva requiredFields como alias", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      fieldDefinitions: [
        { key: "campo_requerido", type: "text", required: true },
        { key: "campo_opcional", type: "text", required: false },
      ],
      requiredFields: [{ key: "legacy_alias", type: "text", required: true }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {
        campo_requerido: "A",
        campo_opcional: "B",
        legacy_alias: "NO_DEBE_USARSE_SI_HAY_FIELD_DEFINITIONS",
      },
    });
    expect(result).toEqual({
      campo_requerido: "A",
      campo_opcional: "B",
    });
  });

  it("envía null cuando el mapping define sendNullWhenMissing", async () => {
    mocks.listProcedureTypeCamundaVariableMappings.mockResolvedValue([
      {
        scope: "START_INSTANCE",
        procedureFieldKey: "observaciones",
        camundaVariableName: "observaciones",
        camundaVariableType: "string",
        required: false,
        enabled: true,
        sendNullWhenMissing: true,
      },
    ]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-1",
      code: "tramite_a",
      fieldDefinitions: [{ key: "observaciones", type: "text", required: false }],
      requiredFields: [{ key: "observaciones", type: "text", required: false }],
    });

    const result = await service.buildVariables({
      procedureTypeId: "proc-1",
      scope: "START_INSTANCE",
      includeProcedureFieldDefinitions: true,
      collectedData: {},
    });
    expect(result).toEqual({ observaciones: null });
  });
});

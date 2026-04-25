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
    mocks.getProcedureCatalogEntryById.mockResolvedValue({ id: "proc-1", code: "tramite_a" });
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
});

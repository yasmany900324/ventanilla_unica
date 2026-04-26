import { describe, expect, it } from "vitest";
import { normalizeProcedureCollectedData } from "../procedureCatalog";

describe("procedure field definitions compatibility", () => {
  it("normaliza fieldDefinitions con campos requeridos y opcionales", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureFieldDefinitions: [
        { key: "padron", type: "number", required: true },
        { key: "aclaracion", type: "text", required: false },
      ],
      padron: "12345",
      aclaracion: "dato opcional",
    });

    expect(normalized.procedureFieldDefinitions).toHaveLength(2);
    expect(normalized.procedureFieldDefinitions[0].key).toBe("padron");
    expect(normalized.procedureFieldDefinitions[0].required).toBe(true);
    expect(normalized.procedureFieldDefinitions[1].key).toBe("aclaracion");
    expect(normalized.procedureFieldDefinitions[1].required).toBe(false);
  });

  it("mantiene requiredFields como alias temporal de compatibilidad", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureFieldDefinitions: [{ key: "descripcion", type: "text", required: true }],
      descripcion: "texto",
    });

    expect(normalized.requiredFields).toEqual(normalized.procedureFieldDefinitions);
    expect(normalized.procedureRequiredFields).toEqual(normalized.procedureFieldDefinitions);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeProcedureCollectedData, validateProcedureFieldInput } from "../procedureCatalog";

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

  it("rechaza location inválida y acepta location descriptiva", () => {
    const invalid = validateProcedureFieldInput({
      fieldDefinition: { key: "ubicacion", label: "Ubicación", type: "location", required: true },
      inputValue: "dd",
    });
    const valid = validateProcedureFieldInput({
      fieldDefinition: { key: "ubicacion", label: "Ubicación", type: "location", required: true },
      inputValue: "Av. Principal y Calle 2",
    });
    expect(invalid.ok).toBe(false);
    expect(valid.ok).toBe(true);
  });

  it("acepta referencias de imagen válidas y rechaza texto no imagen", () => {
    const invalid = validateProcedureFieldInput({
      fieldDefinition: { key: "foto", label: "Imagen", type: "image", required: true },
      inputValue: "dd",
    });
    const validUrl = validateProcedureFieldInput({
      fieldDefinition: { key: "foto", label: "Imagen", type: "image", required: true },
      inputValue: "https://example.org/file.jpg",
    });
    const validFilename = validateProcedureFieldInput({
      fieldDefinition: { key: "foto", label: "Imagen", type: "image", required: true },
      inputValue: "arbol-cerro-1.webp",
    });
    const validDataUrl = validateProcedureFieldInput({
      fieldDefinition: { key: "foto", label: "Imagen", type: "image", required: true },
      inputValue: "data:image/png;base64,Zm9v",
    });
    expect(invalid.ok).toBe(false);
    expect(validUrl.ok).toBe(true);
    expect(validFilename.ok).toBe(true);
    expect(validDataUrl.ok).toBe(true);
  });
});

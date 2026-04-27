import { describe, expect, it } from "vitest";
import {
  augmentCollectedDataWithLegacyProcedureFields,
  buildCanonicalImageOrFileFieldValue,
  buildCanonicalLocationFieldValue,
  catalogProcedureFieldHasPresentValue,
  getProcedureMissingFieldsFromDefinition,
  normalizeProcedureCollectedData,
} from "../procedureCatalog";

const REGISTRAR_INCIDENCIA_FIELDS = [
  { key: "description", type: "text", required: true, label: "Descripción" },
  { key: "photo", type: "image", required: true, label: "Foto" },
  { key: "location", type: "location", required: true, label: "Ubicación" },
];

describe("registrar_incidencia — datos canónicos por key de catálogo", () => {
  it("normaliza description, photo y location desde claves legacy de incidencia", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureCode: "registrar_incidencia",
      procedureFieldDefinitions: REGISTRAR_INCIDENCIA_FIELDS,
      description: "Rama caída",
      photoAttachmentPublicUrl: "https://cdn.example.org/incidents/x.jpg",
      photoAttachmentOriginalName: "foto.jpg",
      photoAttachmentMimeType: "image/jpeg",
      photoAttachmentSizeBytes: 1024,
      location: "Av. Brasil 1000",
      locationLatitude: -34.9,
      locationLongitude: -56.16,
      locationAddressText: "Av. Brasil 1000",
    });

    expect(normalized.description).toBe("Rama caída");
    expect(normalized.photo).toEqual({
      url: "https://cdn.example.org/incidents/x.jpg",
      filename: "foto.jpg",
      mimeType: "image/jpeg",
      size: 1024,
    });
    expect(normalized.location).toMatchObject({
      lat: -34.9,
      lng: -56.16,
      address: "Av. Brasil 1000",
    });
    expect(getProcedureMissingFieldsFromDefinition(REGISTRAR_INCIDENCIA_FIELDS, normalized)).toEqual([]);
  });

  it("resuelve photo requerido con metadata legacy aun sin publicUrl", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureCode: "registrar_incidencia",
      procedureFieldDefinitions: REGISTRAR_INCIDENCIA_FIELDS,
      description: "Rama caída",
      location: "Av. Brasil 1000",
      photoAttachmentStoredFilename: "draft-local.jpg",
      photoAttachmentMimeType: "image/jpeg",
      photoAttachmentSizeBytes: 640,
    });
    expect(normalized.photo).toEqual({
      filename: "draft-local.jpg",
      mimeType: "image/jpeg",
      size: 640,
    });
    expect(getProcedureMissingFieldsFromDefinition(REGISTRAR_INCIDENCIA_FIELDS, normalized)).toEqual([]);
  });
});

describe("procedimiento genérico — campo image distinto de photo", () => {
  const fields = [
    { key: "titulo", type: "text", required: true, label: "Título" },
    { key: "comprobantePago", type: "image", required: true, label: "Comprobante de pago" },
  ];

  it("persiste comprobantePago como objeto canónico cuando viene en la key oficial", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureCode: "pago_tasas",
      procedureFieldDefinitions: fields,
      titulo: "Solicitud",
      comprobantePago: {
        url: "https://storage.example.org/comp/recibo.png",
        filename: "recibo.png",
        mimeType: "image/png",
        size: 2048,
      },
    });
    expect(normalized.comprobantePago).toEqual({
      url: "https://storage.example.org/comp/recibo.png",
      filename: "recibo.png",
      mimeType: "image/png",
      size: 2048,
    });
    expect(getProcedureMissingFieldsFromDefinition(fields, normalized)).toEqual([]);
  });

  it("acepta compatibilidad leyendo dato legacy en minúsculas (comprobantepago)", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureCode: "pago_tasas",
      procedureFieldDefinitions: fields,
      titulo: "Solicitud",
      comprobantepago: {
        url: "https://storage.example.org/comp/legacy.png",
      },
    });
    expect(normalized.comprobantePago).toEqual({ url: "https://storage.example.org/comp/legacy.png" });
    expect(getProcedureMissingFieldsFromDefinition(fields, normalized)).toEqual([]);
  });

  it("no rellena comprobantePago desde photoAttachmentPublicUrl (legacy solo para key photo/foto)", () => {
    const normalized = normalizeProcedureCollectedData({
      procedureCode: "pago_tasas",
      procedureFieldDefinitions: fields,
      titulo: "Solicitud",
      photoAttachmentPublicUrl: "https://legacy.example.org/only-legacy.jpg",
    });
    expect(normalized.comprobantePago).toBeUndefined();
    expect(getProcedureMissingFieldsFromDefinition(fields, normalized)).toContain("comprobantePago");
  });

  it("buildCanonicalImageOrFileFieldValue usa la key oficial y luego legacy solo para photo", () => {
    const defs = [
      { key: "photo", type: "image" },
      { key: "comprobantePago", type: "image" },
    ];
    expect(
      buildCanonicalImageOrFileFieldValue(
        { photoAttachmentPublicUrl: "https://x/u.jpg" },
        "comprobantePago",
        defs
      )
    ).toBe(null);
    expect(
      buildCanonicalImageOrFileFieldValue(
        { photoAttachmentPublicUrl: "https://x/u.jpg" },
        "photo",
        defs
      )
    ).toEqual({ url: "https://x/u.jpg" });
  });
});

describe("augmentCollectedDataWithLegacyProcedureFields", () => {
  it("completa photo y location en copia sin mutar el objeto original mínimo", () => {
    const raw = {
      procedureFieldDefinitions: REGISTRAR_INCIDENCIA_FIELDS,
      description: "Test",
      photoAttachmentPublicUrl: "https://a/b.jpg",
      locationLatitude: -1,
      locationLongitude: -2,
      locationAddressText: "Calle 1",
    };
    const augmented = augmentCollectedDataWithLegacyProcedureFields(raw, REGISTRAR_INCIDENCIA_FIELDS);
    expect(augmented.photo?.url).toBe("https://a/b.jpg");
    expect(augmented.location?.lat).toBe(-1);
    expect(raw.photo).toBeUndefined();
  });
});

describe("catalogProcedureFieldHasPresentValue", () => {
  it("detecta location por address o por lat/lng", () => {
    const f = { key: "location", type: "location", required: true };
    expect(catalogProcedureFieldHasPresentValue(f, { address: "Calle larga suficiente" })).toBe(true);
    expect(catalogProcedureFieldHasPresentValue(f, { lat: -34, lng: -56 })).toBe(true);
    expect(catalogProcedureFieldHasPresentValue(f, { address: "ab" })).toBe(false);
  });
});

describe("buildCanonicalLocationFieldValue", () => {
  it("prioriza el valor en la key del catálogo sobre location genérico cuando hay varios campos location", () => {
    const defs = [
      { key: "origen", type: "location" },
      { key: "destino", type: "location" },
    ];
    const raw = {
      origen: "Mercado central",
      location: "NO USAR PARA ORIGEN",
      locationLatitude: -5,
      locationLongitude: -6,
    };
    const o = buildCanonicalLocationFieldValue(raw, "origen", defs);
    expect(o?.address).toBe("Mercado central");
    const d = buildCanonicalLocationFieldValue(raw, "destino", defs);
    expect(d).toBeNull();
  });

  it("no fabrica coordenadas 0,0 cuando lat/lng vienen nulos", () => {
    const defs = [{ key: "location", type: "location" }];
    const raw = {
      location: "",
      locationLatitude: null,
      locationLongitude: null,
      locationAddressText: "",
    };
    const loc = buildCanonicalLocationFieldValue(raw, "location", defs);
    expect(loc).toBeNull();
  });
});

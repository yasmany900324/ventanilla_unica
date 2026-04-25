import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sqlQueue = [];
  const sqlTag = vi.fn(async () => sqlQueue.shift() || []);
  sqlTag.unsafe = (value) => value;
  return {
    sqlQueue,
    sqlTag,
    requireAdministrator: vi.fn(),
    hasDatabase: vi.fn(),
    ensureProcedureCatalogSchema: vi.fn(),
    listProcedureCatalog: vi.fn(),
    getProcedureCatalogEntryByCode: vi.fn(),
    replaceProcedureTypeFields: vi.fn(),
    replaceProcedureTypeCamundaVariableMappings: vi.fn(),
  };
});

vi.mock("../../../../lib/auth", () => ({
  requireAdministrator: mocks.requireAdministrator,
}));

vi.mock("../../../../lib/procedureCatalog", () => ({
  ensureProcedureCatalogSchema: mocks.ensureProcedureCatalogSchema,
  getProcedureCatalogEntryByCode: mocks.getProcedureCatalogEntryByCode,
  listProcedureCatalog: mocks.listProcedureCatalog,
  replaceProcedureTypeFields: mocks.replaceProcedureTypeFields,
  replaceProcedureTypeCamundaVariableMappings: mocks.replaceProcedureTypeCamundaVariableMappings,
}));

vi.mock("../../../../lib/db", () => ({
  ensureDatabase: () => mocks.sqlTag,
  hasDatabase: mocks.hasDatabase,
}));

import { DELETE, GET, PATCH } from "./route";

function createProcedure(overrides = {}) {
  return {
    id: "proc-1",
    code: "registrar_incidencia",
    name: "Registrar incidencia",
    description: "Permite reportar incidencias.",
    category: "Incidencia",
    aliases: [],
    keywords: [],
    isActive: true,
    camundaProcessId: "proceso_incidencia_v1",
    enabledChannels: ["web", "whatsapp"],
    requiredFields: [
      { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
      { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
    ],
    flowDefinition: {},
    ...overrides,
  };
}

describe("api/admin/procedures", () => {
  beforeEach(() => {
    mocks.sqlQueue.length = 0;
    mocks.sqlTag.mockClear();
    mocks.requireAdministrator.mockReset();
    mocks.hasDatabase.mockReset();
    mocks.ensureProcedureCatalogSchema.mockReset();
    mocks.listProcedureCatalog.mockReset();
    mocks.getProcedureCatalogEntryByCode.mockReset();
    mocks.replaceProcedureTypeFields.mockReset();
    mocks.replaceProcedureTypeCamundaVariableMappings.mockReset();

    mocks.requireAdministrator.mockResolvedValue({ id: "admin-1", role: "administrador" });
    mocks.hasDatabase.mockReturnValue(true);
    mocks.ensureProcedureCatalogSchema.mockResolvedValue(true);
    mocks.replaceProcedureTypeFields.mockResolvedValue([]);
    mocks.replaceProcedureTypeCamundaVariableMappings.mockResolvedValue([]);
  });

  it("GET devuelve registrar_incidencia desde el catálogo", async () => {
    mocks.listProcedureCatalog.mockResolvedValue([createProcedure()]);
    const request = new Request("http://localhost/api/admin/procedures?includeInactive=true&locale=es");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listProcedureCatalog).toHaveBeenCalledWith({ includeInactive: true });
    expect(body.procedures).toHaveLength(1);
    expect(body.procedures[0].code).toBe("registrar_incidencia");
  });

  it("PATCH permite editar nombre, código, tipo, estado, processId, campos y canales", async () => {
    const existing = createProcedure();
    const updated = createProcedure({
      code: "registrar_incidencia_v2",
      name: "Registrar incidencia urbana",
      category: "Incidencia urbana",
      isActive: false,
      camundaProcessId: "proceso_incidencia_v2",
      enabledChannels: ["web"],
      requiredFields: [
        { key: "description", label: "Descripción ampliada", type: "text", required: true, order: 1 },
      ],
    });
    mocks.getProcedureCatalogEntryByCode
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updated);
    mocks.sqlQueue.push([], [{ id: "proc-1", code: "registrar_incidencia_v2" }]);

    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "registrar_incidencia_v2",
        name: "Registrar incidencia urbana",
        category: "Incidencia urbana",
        isActive: false,
        camundaProcessId: "proceso_incidencia_v2",
        enabledChannels: ["web"],
        requiredFields: [
          { key: "description", label: "Descripción ampliada", type: "text", required: true },
        ],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.procedure.code).toBe("registrar_incidencia_v2");
    expect(body.procedure.camundaProcessId).toBe("proceso_incidencia_v2");
    expect(body.procedure.enabledChannels).toEqual(["web"]);
    expect(body.procedure.isActive).toBe(false);
  });

  it("PATCH valida camundaProcessId obligatorio", async () => {
    mocks.getProcedureCatalogEntryByCode.mockResolvedValue(createProcedure());
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "Incidencia",
        camundaProcessId: "",
        enabledChannels: ["web"],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Camunda/i);
  });

  it("PATCH valida al menos un campo solicitado", async () => {
    mocks.getProcedureCatalogEntryByCode.mockResolvedValue(createProcedure());
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "Incidencia",
        camundaProcessId: "proceso_incidencia_v1",
        enabledChannels: ["web"],
        requiredFields: [],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/campo/i);
  });

  it("PATCH valida al menos un canal habilitado", async () => {
    mocks.getProcedureCatalogEntryByCode.mockResolvedValue(createProcedure());
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "Incidencia",
        camundaProcessId: "proceso_incidencia_v1",
        enabledChannels: [],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/canal/i);
  });

  it("PATCH valida código único", async () => {
    mocks.getProcedureCatalogEntryByCode.mockResolvedValue(createProcedure());
    mocks.sqlQueue.push([{ id: "dup-1" }]);
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "otro_codigo",
        name: "Registrar incidencia",
        category: "Incidencia",
        camundaProcessId: "proceso_incidencia_v1",
        enabledChannels: ["web"],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/existe|code/i);
  });

  it("PATCH valida mappings Camunda duplicados", async () => {
    mocks.getProcedureCatalogEntryByCode.mockResolvedValue(createProcedure());
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalCode: "registrar_incidencia",
        code: "registrar_incidencia",
        name: "Registrar incidencia",
        category: "Incidencia",
        camundaProcessId: "proceso_incidencia_v1",
        enabledChannels: ["web"],
        requiredFields: [{ key: "description", label: "Descripción", type: "text", required: true }],
        camundaVariableMappings: [
          {
            scope: "START_INSTANCE",
            procedureFieldKey: "description",
            camundaVariableName: "descripcion",
            camundaVariableType: "string",
            required: true,
            enabled: true,
          },
          {
            scope: "START_INSTANCE",
            procedureFieldKey: "description",
            camundaVariableName: "descripcion",
            camundaVariableType: "string",
            required: true,
            enabled: true,
          },
        ],
      }),
    });
    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/duplicados|scope/i);
  });

  it("DELETE bloquea eliminación de procedimientos activos", async () => {
    mocks.sqlQueue.push([{ code: "registrar_incidencia", is_active: true }]);
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "registrar_incidencia" }),
    });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/deshabilitar|active/i);
  });

  it("DELETE permite eliminar procedimientos inactivos", async () => {
    mocks.sqlQueue.push(
      [{ code: "registrar_incidencia", is_active: false }],
      [{ code: "registrar_incidencia" }]
    );
    const request = new Request("http://localhost/api/admin/procedures?locale=es", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "registrar_incidencia" }),
    });
    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.code).toBe("registrar_incidencia");
  });
});


import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sqlTag = vi.fn(async (strings, ...values) => {
    const query = strings.join(" ");
    if (query.includes("INSERT INTO incidents")) {
      return [
        {
          id: values[0],
          user_id: values[1],
          whatsapp_wa_id: values[2],
          catalog_item_id: values[3],
          category: values[4],
          description: values[5],
          location: values[6],
          location_latitude: values[7],
          location_longitude: values[8],
          status: "recibido",
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
          attachment_storage_provider: null,
          attachment_storage_key: null,
          attachment_url: null,
          attachment_original_name: null,
          attachment_mime_type: null,
          attachment_size_bytes: null,
          attachment_uploaded_at: null,
        },
      ];
    }
    return [];
  });
  sqlTag.unsafe = (input) => input;
  return {
    sqlTag,
    getActiveCatalogItemById: vi.fn(),
  };
});

vi.mock("../db", () => ({
  ensureDatabase: () => mocks.sqlTag,
}));

vi.mock("../auth", () => ({
  ensureAuthSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../attachments/getIncidentAttachmentStorage", () => ({
  ATTACHMENT_PROVIDER_LOCAL_FS: "local_fs",
  ATTACHMENT_PROVIDER_VERCEL_BLOB: "vercel_blob",
  getIncidentAttachmentStorageByProvider: vi.fn(() => ({
    promoteDraftToIncident: vi.fn(),
  })),
}));

vi.mock("../procedureCatalog", () => ({
  getActiveCatalogItemById: mocks.getActiveCatalogItemById,
}));

import { createIncident } from "../incidents";

describe("createIncident con catalogo unico", () => {
  beforeEach(() => {
    mocks.sqlTag.mockClear();
    mocks.getActiveCatalogItemById.mockReset();
    mocks.getActiveCatalogItemById.mockResolvedValue({
      id: "catalog-incident-1",
      caseType: "incident",
      category: "incidencias",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persiste catalog_item_id y deriva category desde catalogo si no viene", async () => {
    const incident = await createIncident({
      userId: "user-1",
      catalogItemId: "catalog-incident-1",
      category: "",
      description: "Rama por caer",
      location: "Calle 123",
    });

    expect(mocks.getActiveCatalogItemById).toHaveBeenCalledWith("catalog-incident-1");
    expect(incident.catalogItemId).toBe("catalog-incident-1");
    expect(incident.category).toBe("incidencias");
  });
});

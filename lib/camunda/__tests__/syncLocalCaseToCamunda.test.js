import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCamundaProcessInstance: vi.fn(),
  getCamundaBaseUrl: vi.fn(),
  upsertCamundaCaseLink: vi.fn(),
  getActiveCatalogItemById: vi.fn(),
  getActiveCatalogItemByCode: vi.fn(),
}));

vi.mock("../client", () => ({
  CamundaClientError: class CamundaClientError extends Error {},
  createCamundaProcessInstance: mocks.createCamundaProcessInstance,
  getCamundaBaseUrl: mocks.getCamundaBaseUrl,
}));

vi.mock("../camundaCaseLinks", () => ({
  upsertCamundaCaseLink: mocks.upsertCamundaCaseLink,
}));

vi.mock("../../procedureCatalog", () => ({
  getActiveCatalogItemById: mocks.getActiveCatalogItemById,
  getActiveCatalogItemByCode: mocks.getActiveCatalogItemByCode,
}));

import {
  syncIncidentToCamundaAfterCreate,
  syncTramiteToCamundaAfterCreate,
} from "../syncLocalCaseToCamunda";

const originalEnv = { ...process.env };

describe("syncLocalCaseToCamunda", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CAMUNDA_CLIENT_ID: "client",
      CAMUNDA_CLIENT_SECRET: "secret",
      CAMUNDA_OAUTH_URL: "https://oauth.example/token",
      CAMUNDA_PROCESS_ID_INCIDENT: "fallback_incident",
      CAMUNDA_PROCESS_ID_TRAMITE: "fallback_tramite",
    };
    mocks.getCamundaBaseUrl.mockReturnValue("https://camunda.example/v2");
    mocks.createCamundaProcessInstance.mockResolvedValue({
      processInstanceKey: "12345",
      processDefinitionId: "proc-id",
    });
    mocks.upsertCamundaCaseLink.mockResolvedValue(undefined);
    mocks.getActiveCatalogItemById.mockResolvedValue(null);
    mocks.getActiveCatalogItemByCode.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("prioriza camunda_process_id del catalogo para incidencias", async () => {
    mocks.getActiveCatalogItemById.mockResolvedValue({
      id: "catalog-1",
      caseType: "incident",
      camundaProcessId: "seguimiento_incidencia",
    });

    await syncIncidentToCamundaAfterCreate({
      id: "inc-1",
      catalogItemId: "catalog-1",
      description: "desc",
      location: "loc",
      status: "recibido",
      category: "incidencias",
    });

    expect(mocks.createCamundaProcessInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: "seguimiento_incidencia",
      })
    );
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "inc-1",
        camundaState: "started",
        catalogItemId: "catalog-1",
      })
    );
  });

  it("usa fallback env si el catalogo no define process id", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-1",
      caseType: "procedure",
      camundaProcessId: "",
    });

    await syncTramiteToCamundaAfterCreate({
      id: "tra-1",
      procedureCode: "habilitacion_comercial",
      requestCode: "TRA-12345678",
      summary: "sum",
      status: "recibido",
    });

    expect(mocks.createCamundaProcessInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        processId: "fallback_tramite",
      })
    );
  });

  it("si no hay process id en catalogo ni fallback, no rompe y marca skipped", async () => {
    process.env.CAMUNDA_PROCESS_ID_INCIDENT = "";
    mocks.getActiveCatalogItemById.mockResolvedValue({
      id: "catalog-2",
      caseType: "incident",
      camundaProcessId: "",
    });

    await expect(
      syncIncidentToCamundaAfterCreate({
        id: "inc-2",
        catalogItemId: "catalog-2",
        description: "desc",
        location: "loc",
        status: "recibido",
        category: "incidencias",
      })
    ).resolves.toBeUndefined();

    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "inc-2",
        camundaState: "camunda_sync_skipped",
        lastErrorSummary: "missing_process_id",
      })
    );
  });
});

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

  it("usa camunda_process_id del catalogo procedure para tramites", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-1",
      caseType: "procedure",
      camundaProcessId: "Process_1hvmc45",
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
        processId: "Process_1hvmc45",
      })
    );
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "tra-1",
        camundaState: "started",
        camundaProcessDefinitionId: "Process_1hvmc45",
      })
    );
  });

  it("si el procedure no define camunda_process_id, marca skipped y no usa fallback", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-2",
      caseType: "procedure",
      camundaProcessId: "",
    });

    await syncTramiteToCamundaAfterCreate({
      id: "tra-no-process",
      procedureCode: "registrar_incidencia",
      requestCode: "TRA-NOPROC",
      summary: "sum",
      status: "recibido",
    });

    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "tra-no-process",
        camundaState: "camunda_sync_skipped",
        lastErrorSummary: "procedure_catalog_missing_process_id",
      })
    );
  });

  it("ignora filas incident cuando resuelve process id de tramite", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "incident-catalog-row",
      caseType: "incident",
      camundaProcessId: "incidencias",
    });

    await syncTramiteToCamundaAfterCreate({
      id: "tra-ignore-incident",
      procedureCode: "inc_arbol_caido",
      requestCode: "TRA-IGN",
      summary: "sum",
      status: "recibido",
    });

    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "tra-ignore-incident",
        camundaState: "camunda_sync_skipped",
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
        lastErrorSummary: "catalog_item_missing_process_id",
      })
    );
  });

  it("si hay hint de catalogo sin process id no usa fallback incident", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "catalog-3",
      caseType: "incident",
      camundaProcessId: "",
    });

    await expect(
      syncIncidentToCamundaAfterCreate(
        {
          id: "inc-3",
          catalogItemId: null,
          description: "desc",
          location: "loc",
          status: "recibido",
          category: "incidencias",
        },
        { catalogCode: "registrar_incidencia" }
      )
    ).resolves.toBeUndefined();

    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.upsertCamundaCaseLink).toHaveBeenCalledWith(
      expect.objectContaining({
        localCaseId: "inc-3",
        camundaState: "camunda_sync_skipped",
        lastErrorSummary: "catalog_item_missing_process_id",
      })
    );
  });
});

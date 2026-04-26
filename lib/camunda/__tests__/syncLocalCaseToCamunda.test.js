import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCamundaProcessInstance: vi.fn(),
  getCamundaBaseUrl: vi.fn(),
  searchCamundaUserTasks: vi.fn(),
  upsertCamundaCaseLink: vi.fn(),
  getActiveCatalogItemById: vi.fn(),
  getActiveCatalogItemByCode: vi.fn(),
  updateProcedureRequestCamundaData: vi.fn(),
  getProcedureRequestById: vi.fn(),
  addProcedureRequestEvent: vi.fn(),
  transitionProcedureRequestStatus: vi.fn(),
  hasProcessedOperation: vi.fn(),
  markOperationAsProcessed: vi.fn(),
  incrementProcedureMetric: vi.fn(),
  getActiveTaskForProcedure: vi.fn(),
  buildVariables: vi.fn(),
}));

vi.mock("../client", () => ({
  CamundaClientError: class CamundaClientError extends Error {},
  createCamundaProcessInstance: mocks.createCamundaProcessInstance,
  getCamundaBaseUrl: mocks.getCamundaBaseUrl,
  searchCamundaUserTasks: mocks.searchCamundaUserTasks,
}));

vi.mock("../camundaCaseLinks", () => ({
  upsertCamundaCaseLink: mocks.upsertCamundaCaseLink,
}));

vi.mock("../../procedureCatalog", () => ({
  getActiveCatalogItemById: mocks.getActiveCatalogItemById,
  getActiveCatalogItemByCode: mocks.getActiveCatalogItemByCode,
}));

vi.mock("../../procedureRequests", () => ({
  PROCEDURE_REQUEST_EVENT_TYPES: {
    CAMUNDA_SYNC_STARTED: "CAMUNDA_SYNC_STARTED",
    CAMUNDA_SYNC_FAILED: "CAMUNDA_SYNC_FAILED",
    CAMUNDA_INSTANCE_CREATED: "CAMUNDA_INSTANCE_CREATED",
    STATUS_CHANGED: "STATUS_CHANGED",
    PROCEDURE_CLOSED: "PROCEDURE_CLOSED",
  },
  PROCEDURE_REQUEST_STATUSES: {
    ERROR_CAMUNDA_SYNC: "ERROR_CAMUNDA_SYNC",
    IN_PROGRESS: "IN_PROGRESS",
    PENDING_BACKOFFICE_ACTION: "PENDING_BACKOFFICE_ACTION",
  },
  updateProcedureRequestCamundaData: mocks.updateProcedureRequestCamundaData,
  getProcedureRequestById: mocks.getProcedureRequestById,
  addProcedureRequestEvent: mocks.addProcedureRequestEvent,
  transitionProcedureRequestStatus: mocks.transitionProcedureRequestStatus,
  hasProcessedOperation: mocks.hasProcessedOperation,
  markOperationAsProcessed: mocks.markOperationAsProcessed,
  incrementProcedureMetric: mocks.incrementProcedureMetric,
}));

vi.mock("../getActiveTaskForProcedure", () => ({
  getActiveTaskForProcedure: mocks.getActiveTaskForProcedure,
}));

vi.mock("../CamundaVariableMapperService", () => ({
  CamundaVariableMappingValidationError: class CamundaVariableMappingValidationError extends Error {},
  camundaVariableMapper: {
    buildVariables: mocks.buildVariables,
  },
}));

import {
  retryProcedureCamundaSync,
  syncIncidentToCamundaAfterCreate,
  syncTramiteToCamundaAfterCreate,
} from "../syncLocalCaseToCamunda";
import { CamundaVariableMappingValidationError } from "../CamundaVariableMapperService";

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
    mocks.updateProcedureRequestCamundaData.mockResolvedValue(null);
    mocks.getProcedureRequestById.mockImplementation(async (id) => ({
      id,
      procedureTypeId: "proc-catalog-1",
      procedureCode: "habilitacion_comercial",
      status: "PENDING_CAMUNDA_SYNC",
      collectedData: { description: "texto" },
      camundaProcessInstanceKey: null,
    }));
    mocks.addProcedureRequestEvent.mockResolvedValue(null);
    mocks.transitionProcedureRequestStatus.mockResolvedValue(null);
    mocks.getActiveTaskForProcedure.mockResolvedValue(null);
    mocks.searchCamundaUserTasks.mockResolvedValue([]);
    mocks.buildVariables.mockResolvedValue({ localCaseId: "tra-1" });
    mocks.hasProcessedOperation.mockResolvedValue(false);
    mocks.markOperationAsProcessed.mockResolvedValue({ ok: true, duplicate: false });
    mocks.incrementProcedureMetric.mockResolvedValue(undefined);
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
      status: "PENDING_CAMUNDA_SYNC",
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
    expect(mocks.buildVariables).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "START_INSTANCE",
        requireMappings: true,
        includeProcedureFieldDefinitions: true,
      })
    );
  });

  it("si el procedure no define camunda_process_id, marca skipped y no usa fallback", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-2",
      caseType: "procedure",
      camundaProcessId: "",
    });

    const out = await syncTramiteToCamundaAfterCreate({
      id: "tra-no-process",
      procedureCode: "registrar_incidencia",
      requestCode: "TRA-NOPROC",
      summary: "sum",
      status: "PENDING_CAMUNDA_SYNC",
    });

    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("missing_process_id");
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
      status: "PENDING_CAMUNDA_SYNC",
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

  it("cuando Camunda falla, conserva expediente y marca error de sync", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-1",
      caseType: "procedure",
      camundaProcessId: "Process_1hvmc45",
    });
    mocks.createCamundaProcessInstance.mockRejectedValueOnce(new Error("boom"));

    const out = await syncTramiteToCamundaAfterCreate({
      id: "tra-error",
      procedureCode: "habilitacion_comercial",
      status: "PENDING_CAMUNDA_SYNC",
    });

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("camunda_sync_failed");
    expect(mocks.transitionProcedureRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "ERROR_CAMUNDA_SYNC" })
    );
  });

  it("rechaza creación Camunda sin mappings START_INSTANCE", async () => {
    mocks.getActiveCatalogItemByCode.mockResolvedValue({
      id: "proc-catalog-1",
      caseType: "procedure",
      camundaProcessId: "Process_1hvmc45",
    });
    mocks.buildVariables.mockRejectedValueOnce(
      new CamundaVariableMappingValidationError("missing mappings", { missingMappings: true })
    );

    const out = await syncTramiteToCamundaAfterCreate({
      id: "tra-missing-mapping",
      procedureCode: "habilitacion_comercial",
      status: "PENDING_CAMUNDA_SYNC",
    });

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("camunda_mapping_validation_error");
    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.transitionProcedureRequestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: "ERROR_CAMUNDA_SYNC" })
    );
  });

  it("reintento manual no duplica instancia si ya existe", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce({
      id: "pr-sync",
      procedureTypeId: "proc-catalog-1",
      status: "ERROR_CAMUNDA_SYNC",
      camundaProcessInstanceKey: "already-1",
      collectedData: {},
    });
    const out = await retryProcedureCamundaSync({
      procedureRequestId: "pr-sync",
      actorId: "admin-1",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("camunda_instance_already_exists");
    expect(mocks.createCamundaProcessInstance).not.toHaveBeenCalled();
  });
});

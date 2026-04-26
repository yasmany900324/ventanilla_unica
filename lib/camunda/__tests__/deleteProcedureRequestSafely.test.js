import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProcedureRequestById: vi.fn(),
  addProcedureRequestEvent: vi.fn(),
  deleteProcedureRequestById: vi.fn(),
  deleteCamundaProcessInstance: vi.fn(),
}));

vi.mock("../../procedureRequests", () => ({
  PROCEDURE_REQUEST_EVENT_TYPES: {
    CASE_DELETE_REQUESTED: "CASE_DELETE_REQUESTED",
    CAMUNDA_DELETE_STARTED: "CAMUNDA_DELETE_STARTED",
    CAMUNDA_DELETE_OK: "CAMUNDA_DELETE_OK",
    CAMUNDA_DELETE_FAILED: "CAMUNDA_DELETE_FAILED",
    CAMUNDA_INSTANCE_ALREADY_MISSING: "CAMUNDA_INSTANCE_ALREADY_MISSING",
    CASE_DELETE_FAILED: "CASE_DELETE_FAILED",
    CASE_DELETE_DB_STARTED: "CASE_DELETE_DB_STARTED",
    CASE_DELETE_DB_FAILED: "CASE_DELETE_DB_FAILED",
    CASE_DELETE_DB_OK: "CASE_DELETE_DB_OK",
  },
  getProcedureRequestById: mocks.getProcedureRequestById,
  addProcedureRequestEvent: mocks.addProcedureRequestEvent,
  deleteProcedureRequestById: mocks.deleteProcedureRequestById,
}));

vi.mock("../client", () => ({
  CamundaClientError: class CamundaClientError extends Error {},
  deleteCamundaProcessInstance: mocks.deleteCamundaProcessInstance,
}));

import { deleteProcedureRequestSafely } from "../deleteProcedureRequestSafely";

describe("deleteProcedureRequestSafely", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      requestCode: "TRA-12345678",
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: null,
      camundaProcessDefinitionId: null,
      camundaMetadata: {},
    });
    mocks.addProcedureRequestEvent.mockResolvedValue({});
    mocks.deleteProcedureRequestById.mockResolvedValue({ ok: true, deleted: true, reason: "deleted" });
    mocks.deleteCamundaProcessInstance.mockResolvedValue({ ok: true, status: 204 });
  });

  it("elimina expediente sin instancia Camunda", async () => {
    const result = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(result.ok).toBe(true);
    expect(mocks.deleteCamundaProcessInstance).not.toHaveBeenCalled();
    expect(mocks.deleteProcedureRequestById).toHaveBeenCalledWith("pr-1");
  });

  it("elimina expediente con instancia Camunda cuando delete OK", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce({
      id: "pr-1",
      requestCode: "TRA-12345678",
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: "2251799813686098",
      camundaProcessDefinitionId: "Process_abc",
      camundaMetadata: {},
    });
    const result = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(result.ok).toBe(true);
    expect(mocks.deleteCamundaProcessInstance).toHaveBeenCalledWith("2251799813686098");
    expect(mocks.deleteProcedureRequestById).toHaveBeenCalledWith("pr-1");
  });

  it("si Camunda falla no elimina en BD", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce({
      id: "pr-1",
      requestCode: "TRA-12345678",
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: "2251799813686098",
      camundaMetadata: {},
    });
    mocks.deleteCamundaProcessInstance.mockRejectedValueOnce(new Error("camunda down"));
    const result = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("camunda_delete_failed");
    expect(mocks.deleteProcedureRequestById).not.toHaveBeenCalled();
  });

  it("si Camunda reporta instancia faltante se considera éxito", async () => {
    mocks.getProcedureRequestById.mockResolvedValueOnce({
      id: "pr-1",
      requestCode: "TRA-12345678",
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: "2251799813686098",
      camundaMetadata: {},
    });
    mocks.deleteCamundaProcessInstance.mockResolvedValueOnce({
      ok: true,
      alreadyMissing: true,
      status: 404,
    });
    const result = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(result.ok).toBe(true);
    expect(mocks.deleteProcedureRequestById).toHaveBeenCalledWith("pr-1");
  });

  it("si la eliminación DB falla devuelve error claro", async () => {
    mocks.deleteProcedureRequestById.mockResolvedValueOnce({ ok: true, deleted: false, reason: "not_found" });
    const result = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("db_delete_failed");
  });

  it("maneja doble petición concurrente como delete_in_progress", async () => {
    let releaseDelete;
    mocks.deleteProcedureRequestById.mockReturnValue(
      new Promise((resolve) => {
        releaseDelete = resolve;
      })
    );
    const firstPromise = deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    const secondResult = await deleteProcedureRequestSafely({ procedureRequestId: "pr-1", actorId: "agente-1" });
    expect(secondResult.ok).toBe(false);
    expect(secondResult.reason).toBe("delete_in_progress");
    releaseDelete({ ok: true, deleted: true, reason: "deleted" });
    const firstResult = await firstPromise;
    expect(firstResult.ok).toBe(true);
  });
});

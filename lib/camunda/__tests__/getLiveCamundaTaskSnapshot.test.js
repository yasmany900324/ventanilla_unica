import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCamundaCaseLinkByLocalCase: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  executeCamundaUserTaskSearch: vi.fn(),
  runCamundaUserTaskSearchDiagnosticQueries: vi.fn(),
}));

vi.mock("../camundaCaseLinks", () => ({
  getCamundaCaseLinkByLocalCase: mocks.getCamundaCaseLinkByLocalCase,
}));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal();
  class MockCamundaClientError extends Error {
    constructor(message, extra = {}) {
      super(message);
      this.name = "CamundaClientError";
      this.status = extra.status;
      this.detail = extra.detail;
      this.errorCode = extra.errorCode;
    }
  }
  return {
    ...actual,
    CamundaClientError: MockCamundaClientError,
    getCamundaProcessInstance: mocks.getCamundaProcessInstance,
    executeCamundaUserTaskSearch: mocks.executeCamundaUserTaskSearch,
    runCamundaUserTaskSearchDiagnosticQueries: mocks.runCamundaUserTaskSearchDiagnosticQueries,
  };
});

import { getLiveCamundaTaskSnapshot } from "../getLiveCamundaTaskSnapshot";
import { CamundaClientError } from "../client";

function mockSearchOk(items, payloadShape = {}) {
  return {
    items,
    orchestrationRestBaseUrl: "https://gw.example/v2",
    requestUrl: "https://gw.example/v2/user-tasks/search",
    method: "POST",
    endpoint: "/v2/user-tasks/search",
    requestPayload: payloadShape,
    processInstanceKeyInFilter: payloadShape?.filter?.processInstanceKey ?? null,
    processInstanceKeyInFilterTypeof: typeof payloadShape?.filter?.processInstanceKey,
    statesConsulted: payloadShape?.filter?.state ?? null,
    httpStatus: 200,
    responseBodySanitized: { items },
    totalItems: items.length,
    firstItemSanitized: items[0] ? { userTaskKey: items[0].userTaskKey } : null,
  };
}

describe("getLiveCamundaTaskSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCamundaCaseLinkByLocalCase.mockResolvedValue(null);
    mocks.getCamundaProcessInstance.mockResolvedValue({
      state: "ACTIVE",
      processDefinitionId: "Process_abc:7:xyz",
    });
    mocks.executeCamundaUserTaskSearch.mockImplementation(async (payload) => mockSearchOk([], payload));
    mocks.runCamundaUserTaskSearchDiagnosticQueries.mockResolvedValue(undefined);
  });

  it("normaliza id de tarea activa y devuelve acciones operativas", async () => {
    const taskRow = {
      userTaskKey: "2251799813691234",
      taskDefinitionId: "registrar_datos_iniciales",
      name: "Registrar Datos Iniciales",
      state: "CREATED",
    };
    mocks.executeCamundaUserTaskSearch.mockResolvedValueOnce(
      mockSearchOk([taskRow], {
        filter: { state: "CREATED", processInstanceKey: "2251799813689999" },
        page: { limit: 25 },
      })
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-1",
        camundaProcessInstanceKey: "2251799813689999",
      },
      actorId: "func-1",
    });
    expect(out.sourceOfTruth).toBe("camunda_live");
    expect(out.process.instanceKey).toBe("2251799813689999");
    expect(out.activeTask.exists).toBe(true);
    expect(out.activeTask.id).toBe("2251799813691234");
    expect(out.activeTask.taskDefinitionKey).toBe("registrar_datos_iniciales");
    expect(mocks.executeCamundaUserTaskSearch).toHaveBeenCalledTimes(1);
    expect(mocks.executeCamundaUserTaskSearch).toHaveBeenCalledWith({
      filter: { state: "CREATED", processInstanceKey: "2251799813689999" },
      page: { limit: 25 },
    });
    expect(out.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "CLAIM_TASK", enabled: true }),
        expect.objectContaining({ action: "COMPLETE_TASK", enabled: true }),
      ])
    );
    expect(mocks.runCamundaUserTaskSearchDiagnosticQueries).not.toHaveBeenCalled();
  });

  it("devuelve error operacional cuando la instancia no existe", async () => {
    mocks.getCamundaProcessInstance.mockResolvedValueOnce(null);
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-2",
        camundaProcessInstanceKey: "999",
      },
    });
    expect(out.process.state).toBe("NOT_FOUND");
    expect(out.activeTask.exists).toBe(false);
    expect(out.errors[0]?.code).toBe("CAMUNDA_INSTANCE_NOT_FOUND");
    expect(out.availableActions.every((item) => item.enabled === false)).toBe(true);
  });

  it("devuelve CAMUNDA_UNAVAILABLE cuando Camunda no responde", async () => {
    mocks.getCamundaProcessInstance.mockRejectedValueOnce(
      new CamundaClientError("network_fail", { status: 503 })
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-3",
        camundaProcessInstanceKey: "321",
      },
    });
    expect(out.process.state).toBe("UNKNOWN");
    expect(out.activeTask.exists).toBe(false);
    expect(out.errors[0]?.code).toBe("CAMUNDA_UNAVAILABLE");
  });

  it("usa assignee para decidir claim/complete sin estado ASSIGNED", async () => {
    mocks.executeCamundaUserTaskSearch.mockResolvedValueOnce(
      mockSearchOk(
        [
          {
            userTaskKey: "2251799813691235",
            taskDefinitionId: "registrar_datos_iniciales",
            name: "Registrar Datos Iniciales",
            state: "CREATED",
            assignee: "func-2",
          },
        ],
        { filter: { state: "CREATED", processInstanceKey: "2251799813692030" }, page: { limit: 25 } }
      )
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-assignee",
        camundaProcessInstanceKey: "2251799813692030",
      },
      actorId: "func-2",
    });
    expect(out.activeTask.exists).toBe(true);
    expect(out.activeTask.state).toBe("CREATED");
    expect(out.activeTask.assignee).toBe("func-2");
    expect(out.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "CLAIM_TASK", enabled: false, reason: "TASK_ALREADY_ASSIGNED" }),
        expect.objectContaining({ action: "COMPLETE_TASK", enabled: true, reason: null }),
      ])
    );
  });

  it("devuelve CAMUNDA_TASK_SEARCH_BAD_REQUEST cuando la búsqueda de tareas responde 400", async () => {
    mocks.executeCamundaUserTaskSearch.mockRejectedValueOnce(
      new CamundaClientError("Camunda search user tasks falló (HTTP 400).", {
        status: 400,
        errorCode: "CAMUNDA_TASK_SEARCH_BAD_REQUEST",
      })
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-400",
        camundaProcessInstanceKey: "2251799813692030",
      },
    });
    expect(out.errors[0]?.code).toBe("CAMUNDA_TASK_SEARCH_BAD_REQUEST");
    expect(out.errors[0]?.retryable).toBe(false);
  });

  it("ACTIVE sin user tasks devuelve CAMUNDA_ACTIVE_TASK_NOT_FOUND y corre diagnósticos A/B/C", async () => {
    mocks.getCamundaProcessInstance.mockResolvedValueOnce({
      state: "ACTIVE",
      processDefinitionId: "Process_x:1:key",
    });
    mocks.executeCamundaUserTaskSearch.mockResolvedValueOnce(
      mockSearchOk([], { filter: { state: "CREATED", processInstanceKey: "2251799813704048" }, page: { limit: 25 } })
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-active-empty",
        camundaProcessInstanceKey: "2251799813704048",
      },
      actorId: "func-1",
    });
    expect(out.process.state).toBe("ACTIVE");
    expect(out.activeTask.exists).toBe(false);
    expect(out.errors[0]?.code).toBe("CAMUNDA_ACTIVE_TASK_NOT_FOUND");
    expect(mocks.runCamundaUserTaskSearchDiagnosticQueries).toHaveBeenCalledTimes(1);
    expect(mocks.runCamundaUserTaskSearchDiagnosticQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        processInstanceKey: "2251799813704048",
        procedureRequestId: "pr-active-empty",
      })
    );
  });

  it("item Orchestration v2 (userTaskKey + elementId) mapea tarea y habilita CLAIM_TASK", async () => {
    mocks.getCamundaProcessInstance.mockResolvedValueOnce({
      state: "ACTIVE",
      processDefinitionId: "proc:1:key",
    });
    mocks.executeCamundaUserTaskSearch.mockResolvedValueOnce(
      mockSearchOk(
        [
          {
            userTaskKey: "2251799813704056",
            elementId: "Activity_registrar_datos",
            name: "Registrar Datos Iniciales",
            state: "CREATED",
            assignee: null,
            processInstanceKey: "2251799813704048",
          },
        ],
        { filter: { state: "CREATED", processInstanceKey: "2251799813704048" }, page: { limit: 25 } }
      )
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: {
        id: "pr-v2",
        camundaProcessInstanceKey: "2251799813704048",
      },
      actorId: "func-1",
    });
    expect(out.activeTask.exists).toBe(true);
    expect(out.activeTask.id).toBe("2251799813704056");
    expect(out.activeTask.taskDefinitionKey).toBe("Activity_registrar_datos");
    expect(out.activeTask.name).toBe("Registrar Datos Iniciales");
    expect(out.activeTask.state).toBe("CREATED");
    expect(out.activeTask.assignee).toBeNull();
    expect(out.errors.some((e) => e?.code === "CAMUNDA_ACTIVE_TASK_NOT_FOUND")).toBe(false);
    expect(out.availableActions.find((a) => a.action === "CLAIM_TASK")?.enabled).toBe(true);
    expect(out.availableActions.find((a) => a.action === "COMPLETE_TASK")?.enabled).toBe(true);
    expect(mocks.runCamundaUserTaskSearchDiagnosticQueries).not.toHaveBeenCalled();
  });

  it("COMPLETED sin tareas no agrega error NO_ACTIVE_TASK", async () => {
    mocks.getCamundaProcessInstance.mockResolvedValueOnce({
      state: "COMPLETED",
      processDefinitionId: "Process_x:1:key",
    });
    mocks.executeCamundaUserTaskSearch.mockResolvedValueOnce(
      mockSearchOk([], { filter: { state: "CREATED", processInstanceKey: "999" }, page: { limit: 25 } })
    );
    const out = await getLiveCamundaTaskSnapshot({
      procedureRequest: { id: "pr-done", camundaProcessInstanceKey: "999" },
    });
    expect(out.process.state).toBe("COMPLETED");
    expect(out.errors.length).toBe(0);
    expect(mocks.runCamundaUserTaskSearchDiagnosticQueries).not.toHaveBeenCalled();
  });
});

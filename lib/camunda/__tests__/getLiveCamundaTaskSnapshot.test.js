import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCamundaCaseLinkByLocalCase: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  searchCamundaUserTasks: vi.fn(),
}));

vi.mock("../camundaCaseLinks", () => ({
  getCamundaCaseLinkByLocalCase: mocks.getCamundaCaseLinkByLocalCase,
}));

vi.mock("../client", () => {
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
    CamundaClientError: MockCamundaClientError,
    getCamundaProcessInstance: mocks.getCamundaProcessInstance,
    searchCamundaUserTasks: mocks.searchCamundaUserTasks,
  };
});

import { getLiveCamundaTaskSnapshot } from "../getLiveCamundaTaskSnapshot";
import { CamundaClientError } from "../client";

describe("getLiveCamundaTaskSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCamundaCaseLinkByLocalCase.mockResolvedValue(null);
    mocks.getCamundaProcessInstance.mockResolvedValue({
      state: "ACTIVE",
      processDefinitionId: "Process_abc:7:xyz",
    });
    mocks.searchCamundaUserTasks.mockResolvedValue([]);
  });

  it("normaliza id de tarea activa y devuelve acciones operativas", async () => {
    mocks.searchCamundaUserTasks
      .mockResolvedValueOnce([
        {
          userTaskKey: "2251799813691234",
          taskDefinitionId: "registrar_datos_iniciales",
          name: "Registrar Datos Iniciales",
          state: "CREATED",
        },
      ])
      .mockResolvedValueOnce([]);
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
    expect(out.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "CLAIM_TASK", enabled: true }),
        expect.objectContaining({ action: "COMPLETE_TASK", enabled: true }),
      ])
    );
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

  it("devuelve CAMUNDA_TASK_SEARCH_BAD_REQUEST cuando la búsqueda de tareas responde 400", async () => {
    mocks.searchCamundaUserTasks.mockRejectedValueOnce(
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
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFuncionario: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getCamundaUserTaskForm: vi.fn(),
  canAccessProcedureRequestStrict: vi.fn(),
  getProcedureRequestById: vi.fn(),
}));

vi.mock("../../../../../../../lib/auth", () => ({
  requireFuncionario: mocks.requireFuncionario,
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

vi.mock("../../../../../../../lib/camunda/client", () => ({
  getCamundaUserTaskForm: mocks.getCamundaUserTaskForm,
}));

vi.mock("../../../../../../../lib/procedureRequestInboxDetail", () => ({
  canAccessProcedureRequestStrict: mocks.canAccessProcedureRequestStrict,
}));

vi.mock("../../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
}));

import { GET } from "./route";

describe("GET /api/funcionario/procedures/requests/[id]/active-task-form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFuncionario.mockResolvedValue({ id: "func-1" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      assignedToUserId: "func-1",
      camundaProcessInstanceKey: "123",
    });
    mocks.canAccessProcedureRequestStrict.mockReturnValue(true);
  });

  it("devuelve ok con schema", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      activeTask: {
        exists: true,
        id: "task-1",
        userTaskKey: "task-1",
        taskDefinitionKey: "review_incident",
        name: "Revisar",
        assignee: "func-1",
      },
    });
    mocks.getCamundaUserTaskForm.mockResolvedValue({
      status: "ok",
      form: {
        id: "f-1",
        key: "FormA",
        version: 1,
        schema: { components: [] },
      },
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.form?.id).toBe("f-1");
  });

  it("devuelve no_active_task cuando no hay tarea activa", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      activeTask: {
        exists: false,
      },
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(body.status).toBe("no_active_task");
  });

  it("devuelve no_form cuando Camunda no tiene formulario", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      activeTask: {
        exists: true,
        id: "task-1",
        userTaskKey: "task-1",
        taskDefinitionKey: "review_incident",
        name: "Revisar",
        assignee: "func-1",
      },
    });
    mocks.getCamundaUserTaskForm.mockResolvedValue({
      status: "no_form",
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(body.status).toBe("no_form");
  });

  it("devuelve error cuando falla obtener formulario", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      activeTask: {
        exists: true,
        id: "task-1",
        userTaskKey: "task-1",
        taskDefinitionKey: "review_incident",
        name: "Revisar",
        assignee: "func-1",
      },
    });
    mocks.getCamundaUserTaskForm.mockResolvedValue({
      status: "error",
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();
    expect(body.status).toBe("error");
  });
});

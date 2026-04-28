import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppRouteParamString: vi.fn(),
  resolveFuncionarioProcedureRequestReadContext: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  getCamundaProcessDefinitionXml: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
}));

vi.mock("../../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../../lib/funcionarioProcedureRequestReadContext", () => ({
  resolveFuncionarioProcedureRequestReadContext: mocks.resolveFuncionarioProcedureRequestReadContext,
}));

vi.mock("../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

vi.mock("../../../../../../../lib/camunda/client", async () => {
  const actual = await vi.importActual("../../../../../../../lib/camunda/client");
  return {
    ...actual,
    getCamundaProcessInstance: mocks.getCamundaProcessInstance,
    getCamundaProcessDefinitionXml: mocks.getCamundaProcessDefinitionXml,
  };
});

vi.mock("../../../../../../../lib/procedureCatalog", () => ({
  getProcedureCatalogEntryById: mocks.getProcedureCatalogEntryById,
}));

import { GET } from "./route";

describe("api/funcionario/procedures/requests/[id]/bpmn-xml GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.resolveFuncionarioProcedureRequestReadContext.mockResolvedValue({
      ok: true,
      actor: { id: "func-1" },
      procedureRequest: {
        id: "pr-1",
        camundaProcessInstanceKey: "2251",
        camundaProcessDefinitionId: null,
        procedureTypeId: "pt-1",
      },
    });
    mocks.getProcedureCatalogEntryById.mockResolvedValue({ camundaProcessId: "Process_fallback" });
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251", definitionId: "Process_x:1:key", state: "ACTIVE" },
      activeTask: { exists: true, taskDefinitionKey: "UserTask_Active", name: "Tarea activa" },
    });
    mocks.getCamundaProcessInstance.mockResolvedValue(null);
    mocks.getCamundaProcessDefinitionXml.mockResolvedValue("<bpmn/>");
  });

  it("valida acceso vía resolveFuncionarioProcedureRequestReadContext", async () => {
    mocks.resolveFuncionarioProcedureRequestReadContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "No autorizado." }, { status: 403 }),
    });
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    expect(res.status).toBe(403);
    expect(mocks.getCamundaProcessDefinitionXml).not.toHaveBeenCalled();
  });

  it("devuelve XML y activeElementId", async () => {
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.bpmnXml).toBe("<bpmn/>");
    expect(body.activeElementId).toBe("UserTask_Active");
    expect(body.processInstanceKey).toBe("2251");
    expect(body.processDefinitionId).toBe("Process_x:1:key");
    expect(mocks.getCamundaProcessDefinitionXml).toHaveBeenCalledWith("Process_x:1:key");
  });
});

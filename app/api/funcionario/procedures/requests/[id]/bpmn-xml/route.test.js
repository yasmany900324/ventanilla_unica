import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppRouteParamString: vi.fn(),
  resolveFuncionarioProcedureRequestReadContext: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  getCamundaProcessDefinitionXml: vi.fn(),
  resolveProcedureCamundaProcessDefinitionKey: vi.fn(),
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

vi.mock("../../../../../../../lib/camunda/resolveProcedureCamundaProcessDefinitionKey", () => ({
  resolveProcedureCamundaProcessDefinitionKey: mocks.resolveProcedureCamundaProcessDefinitionKey,
}));

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
    mocks.resolveProcedureCamundaProcessDefinitionKey.mockResolvedValue({
      processDefinitionKey: "2251799813689999",
      bpmnProcessId: "Process_x",
      resolutionSource: "search.process-definitions",
    });
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
    expect(body.processDefinitionKey).toBe("2251799813689999");
    expect(body.processDefinitionId).toBe("2251799813689999");
    expect(mocks.getCamundaProcessDefinitionXml).toHaveBeenCalledWith("2251799813689999");
  });

  it("devuelve error funcional si no puede resolver processDefinitionKey", async () => {
    mocks.resolveProcedureCamundaProcessDefinitionKey.mockResolvedValueOnce({
      processDefinitionKey: null,
      bpmnProcessId: "Process_1hvmc45",
      resolutionSource: null,
    });
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toBe("No se pudo resolver la key de definición de proceso para descargar el BPMN XML.");
    expect(mocks.getCamundaProcessDefinitionXml).not.toHaveBeenCalled();
  });
});

import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROCEDURE_REQUEST_EVENT_TYPES } from "../../../../../../../lib/procedureRequests";

const mocks = vi.hoisted(() => ({
  getAppRouteParamString: vi.fn(),
  resolveFuncionarioProcedureRequestReadContext: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getCamundaProcessInstance: vi.fn(),
  getCamundaProcessDefinitionXml: vi.fn(),
  resolveProcedureCamundaProcessDefinitionKey: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
  listProcedureRequestEvents: vi.fn(),
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

vi.mock("../../../../../../../lib/procedureRequests", async () => {
  const actual = await vi.importActual("../../../../../../../lib/procedureRequests");
  return {
    ...actual,
    listProcedureRequestEvents: mocks.listProcedureRequestEvents,
  };
});

import { GET } from "./route";

const SAMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Start" />
    <bpmn:userTask id="UserTask_A" name="Registrar Datos Iniciales" />
    <bpmn:userTask id="UserTask_B" name="Revisar Incidencia" />
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:userTask id="UserTask_C" name="Atender Incidencia" />
    <bpmn:endEvent id="EndEvent_1" name="Fin" />
    <bpmn:sequenceFlow id="F1" sourceRef="StartEvent_1" targetRef="UserTask_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="UserTask_A" targetRef="UserTask_B" />
    <bpmn:sequenceFlow id="F3" sourceRef="UserTask_B" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="F4" name="Si sí" sourceRef="Gateway_1" targetRef="UserTask_C" />
    <bpmn:sequenceFlow id="F5" name="Si no" sourceRef="Gateway_1" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

describe("api/funcionario/procedures/requests/[id]/process-flow-summary GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.resolveFuncionarioProcedureRequestReadContext.mockResolvedValue({
      ok: true,
      actor: { id: "func-1" },
      procedureRequest: {
        id: "pr-1",
        camundaProcessInstanceKey: "2251",
        procedureTypeId: "pt-1",
      },
    });
    mocks.getProcedureCatalogEntryById.mockResolvedValue(null);
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251", definitionId: "def-1", state: "ACTIVE" },
      activeTask: { exists: true, taskDefinitionKey: "UserTask_A", name: "Registrar Datos Iniciales" },
    });
    mocks.getCamundaProcessInstance.mockResolvedValue(null);
    mocks.resolveProcedureCamundaProcessDefinitionKey.mockResolvedValue({
      processDefinitionKey: "2251799813689999",
      bpmnProcessId: "Process_1hvmc45",
      resolutionSource: "search.process-definitions",
    });
    mocks.getCamundaProcessDefinitionXml.mockResolvedValue(SAMPLE_BPMN);
    mocks.listProcedureRequestEvents.mockResolvedValue([]);
  });

  it("valida acceso", async () => {
    mocks.resolveFuncionarioProcedureRequestReadContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "No autorizado." }, { status: 403 }),
    });
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    expect(res.status).toBe(403);
  });

  it("devuelve current desde activeTaskDefinitionKey y next directo", async () => {
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.current?.elementId).toBe("UserTask_A");
    expect(body.next).toHaveLength(1);
    expect(body.next[0].targetElementId).toBe("UserTask_B");
  });

  it("resuelve alternativas cuando el siguiente es exclusiveGateway", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      process: { instanceKey: "2251", definitionId: "def-1", state: "ACTIVE" },
      activeTask: { exists: true, taskDefinitionKey: "UserTask_B", name: "Revisar Incidencia" },
    });
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(body.next.length).toBeGreaterThanOrEqual(2);
  });

  it("no inventa visited si no hay historial", async () => {
    mocks.listProcedureRequestEvents.mockResolvedValue([
      {
        type: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
        createdAt: "2020-01-01T00:00:00Z",
        metadata: {},
      },
    ]);
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(body.visited).toEqual([]);
    expect(body.hasFullHistory).toBe(false);
    expect(body.message).toBeTruthy();
  });

  it("reconstruye visited desde eventos con taskDefinitionKey", async () => {
    mocks.listProcedureRequestEvents.mockResolvedValue([
      {
        type: PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED,
        createdAt: "2020-01-02T00:00:00Z",
        metadata: { taskDefinitionKey: "UserTask_A" },
      },
    ]);
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "pr-1" }) });
    const body = await res.json();
    expect(body.visited.length).toBe(1);
    expect(body.visited[0].elementId).toBe("UserTask_A");
    expect(body.hasFullHistory).toBe(true);
    expect(body.message).toBeNull();
  });
});

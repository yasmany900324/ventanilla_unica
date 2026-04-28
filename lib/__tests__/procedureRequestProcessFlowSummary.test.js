import { describe, expect, it } from "vitest";
import {
  buildProcedureRequestProcessFlowSummary,
  buildVisitedFromLocalEvents,
} from "../procedureRequestProcessFlowSummary";
import { PROCEDURE_REQUEST_EVENT_TYPES } from "../procedureRequests";

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

describe("buildVisitedFromLocalEvents", () => {
  it("no inventa visitados si no hay metadata de tarea", () => {
    const nodes = { Task_X: { elementId: "Task_X", label: "X", type: "userTask" } };
    const { visited, hasFullHistory } = buildVisitedFromLocalEvents(
      [{ type: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED, createdAt: "2020-01-01T00:00:00Z", metadata: {} }],
      nodes
    );
    expect(visited).toEqual([]);
    expect(hasFullHistory).toBe(false);
  });

  it("reconstruye visited desde BACKOFFICE_TASK_COMPLETED con taskDefinitionKey", () => {
    const nodes = {
      UserTask_A: { elementId: "UserTask_A", label: "Registrar Datos Iniciales", type: "userTask" },
    };
    const { visited, hasFullHistory } = buildVisitedFromLocalEvents(
      [
        {
          type: PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED,
          createdAt: "2020-01-02T00:00:00Z",
          metadata: { taskDefinitionKey: "UserTask_A" },
        },
      ],
      nodes
    );
    expect(hasFullHistory).toBe(true);
    expect(visited).toHaveLength(1);
    expect(visited[0].elementId).toBe("UserTask_A");
    expect(visited[0].label).toBe("Registrar Datos Iniciales");
  });
});

describe("buildProcedureRequestProcessFlowSummary", () => {
  it("expone current desde activeTaskDefinitionKey y next directo", async () => {
    const snapshot = {
      process: { state: "ACTIVE", instanceKey: "99" },
      activeTask: {
        exists: true,
        taskDefinitionKey: "UserTask_A",
        name: "Registrar Datos Iniciales",
      },
    };
    const summary = await buildProcedureRequestProcessFlowSummary({
      bpmnXml: SAMPLE_BPMN,
      snapshot,
      events: [],
    });
    expect(summary.current?.elementId).toBe("UserTask_A");
    expect(summary.current?.label).toBe("Registrar Datos Iniciales");
    expect(summary.next).toHaveLength(1);
    expect(summary.next[0].targetElementId).toBe("UserTask_B");
    expect(summary.hasFullDiagram).toBe(true);
    expect(summary.hasFullHistory).toBe(false);
    expect(summary.message).toBeTruthy();
  });

  it("resuelve alternativas cuando el siguiente inmediato es exclusiveGateway", async () => {
    const snapshot = {
      process: { state: "ACTIVE", instanceKey: "99" },
      activeTask: {
        exists: true,
        taskDefinitionKey: "UserTask_B",
        name: "Revisar Incidencia",
      },
    };
    const summary = await buildProcedureRequestProcessFlowSummary({
      bpmnXml: SAMPLE_BPMN,
      snapshot,
      events: [],
    });
    expect(summary.next.length).toBeGreaterThanOrEqual(2);
  });
});

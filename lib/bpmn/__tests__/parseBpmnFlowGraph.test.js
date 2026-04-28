import { describe, expect, it } from "vitest";
import { computeNextTransitions, parseBpmnToFlowGraph } from "../parseBpmnFlowGraph";

const SAMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Incidencia creada" />
    <bpmn:userTask id="UserTask_Review" name="Revisar Incidencia" />
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:userTask id="UserTask_Atender" name="Atender Incidencia" />
    <bpmn:endEvent id="EndEvent_1" name="Incidencia cerrada sin intervención" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="UserTask_Review" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="UserTask_Review" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_3" name="Si se requiere intervención" sourceRef="Gateway_1" targetRef="UserTask_Atender">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">\${requiere}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="Flow_4" name="Si no se requiere intervención" sourceRef="Gateway_1" targetRef="EndEvent_1" />
  </bpmn:process>
</bpmn:definitions>`;

describe("parseBpmnToFlowGraph", () => {
  it("extrae nodos y flujos salientes", async () => {
    const graph = await parseBpmnToFlowGraph(SAMPLE_BPMN);
    expect(graph.nodesById.UserTask_Review).toEqual(
      expect.objectContaining({
        elementId: "UserTask_Review",
        label: "Revisar Incidencia",
        type: "userTask",
      })
    );
    expect(graph.outgoingBySource.get("UserTask_Review")?.[0]?.to).toBe("Gateway_1");
  });

  it("computeNextTransitions expande exclusiveGateway en alternativas", async () => {
    const graph = await parseBpmnToFlowGraph(SAMPLE_BPMN);
    const next = computeNextTransitions(graph, "UserTask_Review");
    expect(next.length).toBe(2);
    const labels = next.map((n) => n.targetLabel).sort();
    expect(labels).toEqual(["Atender Incidencia", "Incidencia cerrada sin intervención"].sort());
    const conds = next.map((n) => n.conditionLabel).sort();
    expect(conds.some((c) => c.includes("Si se requiere"))).toBe(true);
    expect(conds.some((c) => c.includes("Si no se requiere"))).toBe(true);
  });

  it("siguiente directo desde startEvent", async () => {
    const graph = await parseBpmnToFlowGraph(SAMPLE_BPMN);
    const next = computeNextTransitions(graph, "StartEvent_1");
    expect(next).toHaveLength(1);
    expect(next[0].targetElementId).toBe("UserTask_Review");
  });
});

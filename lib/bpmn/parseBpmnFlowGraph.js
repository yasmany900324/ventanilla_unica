import { BpmnModdle } from "bpmn-moddle";

/** @typedef {{ elementId: string, label: string, type: string }} BpmnFlowNode */
/** @typedef {{ id: string, from: string, to: string, label: string|null, conditionExpression: string|null }} BpmnFlowEdge */

function shortenType($type) {
  const t = String($type || "");
  const i = t.indexOf(":");
  return i >= 0 ? t.slice(i + 1) : t;
}

/** Normaliza tipo BPMN (p. ej. `UserTask` → `usertask`) para comparaciones. */
function typeKey($type) {
  return shortenType($type).toLowerCase();
}

/** Tipo estable para la API (camelCase corto). */
function apiNodeType($type) {
  const k = typeKey($type);
  const map = {
    startevent: "startEvent",
    endevent: "endEvent",
    usertask: "userTask",
    servicetask: "serviceTask",
    task: "task",
    exclusivegateway: "exclusiveGateway",
    parallelgateway: "parallelGateway",
    intermediatecatchevent: "intermediateCatchEvent",
    intermediatethrowevent: "intermediateThrowEvent",
  };
  return map[k] || shortenType($type);
}

function refId(ref) {
  if (ref == null) {
    return "";
  }
  if (typeof ref === "string") {
    return ref.trim();
  }
  if (typeof ref === "object" && ref.id != null) {
    return String(ref.id).trim();
  }
  return "";
}

function extractConditionExpression(flow) {
  const ce = flow?.conditionExpression;
  if (ce == null) {
    return null;
  }
  if (typeof ce === "string") {
    return ce.trim() || null;
  }
  if (typeof ce === "object") {
    const body = ce.body != null ? String(ce.body).trim() : "";
    if (body) {
      return body;
    }
  }
  return null;
}

function nodeLabel(el, elementId) {
  const name = el?.name != null ? String(el.name).trim() : "";
  if (name) {
    return name;
  }
  const k = typeKey(el?.$type);
  if (k === "exclusivegateway" || k === "parallelgateway") {
    return "Decisión del proceso";
  }
  return elementId;
}

/**
 * @param {string} xml
 * @returns {Promise<{
 *   nodesById: Record<string, BpmnFlowNode>,
 *   outgoingBySource: Map<string, BpmnFlowEdge[]>,
 *   incomingByTarget: Map<string, BpmnFlowEdge[]>,
 *   edges: BpmnFlowEdge[],
 * }>}
 */
export async function parseBpmnToFlowGraph(xml) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(String(xml || "").trim());
  if (!rootElement || rootElement.$type !== "bpmn:Definitions") {
    throw new Error("parseBpmnToFlowGraph: raíz no es bpmn:Definitions.");
  }

  /** @type {Record<string, BpmnFlowNode>} */
  const nodesById = {};
  /** @type {BpmnFlowEdge[]} */
  const edges = [];
  /** @type {Map<string, BpmnFlowEdge[]>} */
  const outgoingBySource = new Map();
  /** @type {Map<string, BpmnFlowEdge[]>} */
  const incomingByTarget = new Map();

  const processes = (rootElement.rootElements || []).filter((el) => el && el.$type === "bpmn:Process");
  if (processes.length === 0) {
    return { nodesById, outgoingBySource, incomingByTarget, edges };
  }

  for (const proc of processes) {
    const flowElements = Array.isArray(proc.flowElements) ? proc.flowElements : [];
    for (const el of flowElements) {
      if (!el || !el.$type) {
        continue;
      }
      const shortKey = typeKey(el.$type);
      if (shortKey === "sequenceflow") {
        const id = String(el.id || "").trim();
        const from = refId(el.sourceRef);
        const to = refId(el.targetRef);
        if (!id || !from || !to) {
          continue;
        }
        const edge = {
          id,
          from,
          to,
          label: el.name != null && String(el.name).trim() ? String(el.name).trim() : null,
          conditionExpression: extractConditionExpression(el),
        };
        edges.push(edge);
        if (!outgoingBySource.has(from)) {
          outgoingBySource.set(from, []);
        }
        outgoingBySource.get(from).push(edge);
        if (!incomingByTarget.has(to)) {
          incomingByTarget.set(to, []);
        }
        incomingByTarget.get(to).push(edge);
        continue;
      }
      if (!isFlowNodeType(shortKey)) {
        continue;
      }
      const elementId = String(el.id || "").trim();
      if (!elementId) {
        continue;
      }
      nodesById[elementId] = {
        elementId,
        label: nodeLabel(el, elementId),
        type: apiNodeType(el.$type),
      };
    }
  }

  return { nodesById, outgoingBySource, incomingByTarget, edges };
}

function isFlowNodeType(shortKeyLower) {
  const s = String(shortKeyLower || "").toLowerCase();
  return (
    s === "startevent" ||
    s === "endevent" ||
    s === "usertask" ||
    s === "servicetask" ||
    s === "task" ||
    s === "exclusivegateway" ||
    s === "parallelgateway" ||
    s === "intermediatecatchevent" ||
    s === "intermediatethrowevent"
  );
}

/**
 * @param {BpmnFlowEdge} edge
 * @returns {string}
 */
export function edgeConditionLabel(edge) {
  if (edge.label) {
    return edge.label;
  }
  if (edge.conditionExpression) {
    const raw = String(edge.conditionExpression).trim();
    const collapsed = raw.replace(/\s+/g, " ").slice(0, 120);
    return collapsed || "Camino posible";
  }
  return "Camino posible";
}

/**
 * @param {Map<string, BpmnFlowEdge[]>} outgoingBySource
 * @param {Record<string, BpmnFlowNode>} nodesById
 * @param {string} gatewayId
 * @param {Set<string>} seen
 * @returns {Array<{ conditionLabel: string, targetElementId: string, targetLabel: string, targetType: string }>}
 */
export function expandGatewayBranches(outgoingBySource, nodesById, gatewayId, seen = new Set()) {
  const outs = outgoingBySource.get(gatewayId) || [];
  const results = [];
  for (const edge of outs) {
    const targetId = edge.to;
    if (seen.has(targetId)) {
      continue;
    }
    seen.add(targetId);
    const cond = edgeConditionLabel(edge);
    const node = nodesById[targetId];
    if (!node) {
      results.push({
        conditionLabel: cond,
        targetElementId: targetId,
        targetLabel: targetId,
        targetType: "unknown",
      });
      continue;
    }
    if (node.type === "exclusiveGateway" || node.type === "parallelGateway") {
      results.push(...expandGatewayBranches(outgoingBySource, nodesById, targetId, seen));
    } else {
      results.push({
        conditionLabel: cond,
        targetElementId: node.elementId,
        targetLabel: node.label,
        targetType: node.type,
      });
    }
  }
  return results;
}

/**
 * @param {{
 *   nodesById: Record<string, BpmnFlowNode>,
 *   outgoingBySource: Map<string, BpmnFlowEdge[]>,
 * }} graph
 * @param {string} currentElementId
 * @returns {Array<{ conditionLabel: string, targetElementId: string, targetLabel: string, targetType: string }>}
 */
export function computeNextTransitions(graph, currentElementId) {
  const { nodesById, outgoingBySource } = graph;
  const outgoing = outgoingBySource.get(currentElementId) || [];
  if (outgoing.length === 0) {
    return [];
  }

  if (outgoing.length === 1) {
    const edge = outgoing[0];
    const target = nodesById[edge.to];
    if (target && (target.type === "exclusiveGateway" || target.type === "parallelGateway")) {
      return expandGatewayBranches(outgoingBySource, nodesById, target.elementId, new Set([currentElementId]));
    }
    if (target) {
      return [
        {
          conditionLabel: edgeConditionLabel(edge),
          targetElementId: target.elementId,
          targetLabel: target.label,
          targetType: target.type,
        },
      ];
    }
    return [
      {
        conditionLabel: edgeConditionLabel(edge),
        targetElementId: edge.to,
        targetLabel: edge.to,
        targetType: "unknown",
      },
    ];
  }

  const multi = [];
  for (const edge of outgoing) {
    const target = nodesById[edge.to];
    if (target && (target.type === "exclusiveGateway" || target.type === "parallelGateway")) {
      multi.push(
        ...expandGatewayBranches(outgoingBySource, nodesById, target.elementId, new Set([currentElementId]))
      );
    } else if (target) {
      multi.push({
        conditionLabel: edgeConditionLabel(edge),
        targetElementId: target.elementId,
        targetLabel: target.label,
        targetType: target.type,
      });
    } else {
      multi.push({
        conditionLabel: edgeConditionLabel(edge),
        targetElementId: edge.to,
        targetLabel: edge.to,
        targetType: "unknown",
      });
    }
  }
  return multi;
}

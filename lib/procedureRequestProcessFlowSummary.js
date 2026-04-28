import { PROCEDURE_REQUEST_EVENT_TYPES } from "./procedureRequests";
import { computeNextTransitions, parseBpmnToFlowGraph } from "./bpmn/parseBpmnFlowGraph";

export const PROCESS_FLOW_HISTORY_MESSAGE =
  "El recorrido completo se mostrará cuando exista historial suficiente.";

/**
 * @param {unknown[]} events
 * @param {Record<string, { elementId: string, label: string, type: string }>|null} nodesById
 * @returns {{ visited: Array<{ elementId: string, label: string, type: string }>, hasFullHistory: boolean }}
 */
export function buildVisitedFromLocalEvents(events, nodesById) {
  const sorted = [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return ta - tb;
  });

  const keys = [];
  for (const ev of sorted) {
    const type = String(ev?.type || "").trim();
    const meta = ev?.metadata && typeof ev.metadata === "object" ? ev.metadata : {};
    if (type === PROCEDURE_REQUEST_EVENT_TYPES.BACKOFFICE_TASK_COMPLETED) {
      const k = String(meta.taskDefinitionKey || "").trim();
      if (k) {
        keys.push(k);
      }
      continue;
    }
    if (type === PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED) {
      const prev = String(meta.previousTaskDefinitionKey || "").trim();
      if (prev && keys[keys.length - 1] !== prev) {
        keys.push(prev);
      }
    }
  }

  const deduped = [];
  for (const k of keys) {
    if (deduped[deduped.length - 1] !== k) {
      deduped.push(k);
    }
  }

  const visited = deduped.map((elementId) => {
    const node = nodesById?.[elementId];
    return {
      elementId,
      label: node?.label || elementId,
      type: node?.type || "unknown",
    };
  });

  const hasFullHistory = visited.length > 0;
  return { visited, hasFullHistory };
}

/**
 * @param {{
 *   bpmnXml: string|null,
 *   snapshot: Record<string, unknown>|null,
 *   events: unknown[],
 * }} input
 */
export async function buildProcedureRequestProcessFlowSummary({ bpmnXml, snapshot, events }) {
  /** @type {Record<string, { elementId: string, label: string, type: string }>|null} */
  let nodesById = null;
  /** @type {Map<string, import("./bpmn/parseBpmnFlowGraph").BpmnFlowEdge[]>|null} */
  let outgoingBySource = null;

  let hasFullDiagram = false;
  if (bpmnXml && String(bpmnXml).trim()) {
    try {
      const graph = await parseBpmnToFlowGraph(bpmnXml);
      nodesById = graph.nodesById;
      outgoingBySource = graph.outgoingBySource;
      hasFullDiagram = Object.keys(nodesById).length > 0;
    } catch (_e) {
      nodesById = null;
      outgoingBySource = null;
      hasFullDiagram = false;
    }
  }

  const { visited, hasFullHistory } = buildVisitedFromLocalEvents(events, nodesById);

  const activeExists = Boolean(snapshot?.activeTask?.exists);
  const activeTaskDef = activeExists ? String(snapshot?.activeTask?.taskDefinitionKey || "").trim() : "";
  const activeTaskName =
    activeExists && snapshot?.activeTask?.name != null ? String(snapshot.activeTask.name).trim() : "";

  let current = null;
  if (activeTaskDef) {
    const node = nodesById?.[activeTaskDef];
    current = {
      elementId: activeTaskDef,
      label: (activeTaskName || node?.label || activeTaskDef).trim() || activeTaskDef,
      type: node?.type || "userTask",
    };
  }

  let next = [];
  if (nodesById && outgoingBySource && current?.elementId) {
    next = computeNextTransitions({ nodesById, outgoingBySource }, current.elementId);
  }

  const message = hasFullHistory ? null : PROCESS_FLOW_HISTORY_MESSAGE;

  return {
    visited,
    current,
    next,
    hasFullDiagram,
    hasFullHistory,
    activeElementId: activeTaskDef || null,
    message,
  };
}

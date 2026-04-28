import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { searchCamundaProcessDefinitions } from "./client";

function normalizeKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return /^\d+$/u.test(raw) ? raw : "";
}

function normalizeBpmnProcessId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return /^\d+$/u.test(raw) ? "" : raw;
}

/**
 * Resuelve processDefinitionKey (numérico) para consumir `/process-definitions/{key}/xml`.
 * Nunca devuelve `bpmnProcessId` textual como key.
 *
 * @param {{
 *   snapshot?: Record<string, unknown>|null,
 *   processInstance?: Record<string, unknown>|null,
 *   procedureRequest?: Record<string, unknown>|null,
 *   procedureType?: Record<string, unknown>|null,
 * }} ctx
 * @returns {Promise<{ processDefinitionKey: string|null, bpmnProcessId: string|null, resolutionSource: string|null }>}
 */
export async function resolveProcedureCamundaProcessDefinitionKey({
  snapshot = null,
  processInstance = null,
  procedureRequest = null,
  procedureType = null,
} = {}) {
  const processInstanceKey = String(
    snapshot?.process?.instanceKey || procedureRequest?.camundaProcessInstanceKey || ""
  ).trim() || null;

  const snapshotKey =
    normalizeKey(snapshot?.process?.processDefinitionKey) || normalizeKey(snapshot?.process?.definitionKey);
  const instanceKey =
    normalizeKey(processInstance?.processDefinitionKey) || normalizeKey(processInstance?.definitionKey);
  const rowKey = normalizeKey(procedureRequest?.camundaProcessDefinitionId);

  const bpmnProcessId =
    normalizeBpmnProcessId(snapshot?.process?.bpmnProcessId) ||
    normalizeBpmnProcessId(snapshot?.process?.definitionId) ||
    normalizeBpmnProcessId(processInstance?.bpmnProcessId) ||
    normalizeBpmnProcessId(processInstance?.processDefinitionId) ||
    normalizeBpmnProcessId(procedureType?.camundaProcessId) ||
    null;

  if (snapshotKey) {
    return {
      processDefinitionKey: snapshotKey,
      bpmnProcessId,
      resolutionSource: "snapshot.processDefinitionKey",
    };
  }
  if (instanceKey) {
    return {
      processDefinitionKey: instanceKey,
      bpmnProcessId,
      resolutionSource: "processInstance.processDefinitionKey",
    };
  }
  if (rowKey) {
    return {
      processDefinitionKey: rowKey,
      bpmnProcessId,
      resolutionSource: "procedureRequest.camundaProcessDefinitionId",
    };
  }
  if (bpmnProcessId) {
    try {
      const defs = await searchCamundaProcessDefinitions({ bpmnProcessId, pageSize: 5 });
      const match = defs.find((item) => normalizeKey(item?.processDefinitionKey || item?.key || item?.definitionKey));
      const searchedKey = match
        ? normalizeKey(match.processDefinitionKey || match.key || match.definitionKey)
        : "";
      if (searchedKey) {
        return {
          processDefinitionKey: searchedKey,
          bpmnProcessId,
          resolutionSource: "search.process-definitions",
        };
      }
    } catch (error) {
      console.warn(
        "[camunda] no se pudo resolver processDefinitionKey por búsqueda de process-definitions",
        sanitizeForLogs({
          processInstanceKey,
          bpmnProcessId,
          error: String(error?.message || "search_failed").slice(0, 220),
        })
      );
    }
  }

  return {
    processDefinitionKey: null,
    bpmnProcessId,
    resolutionSource: null,
  };
}

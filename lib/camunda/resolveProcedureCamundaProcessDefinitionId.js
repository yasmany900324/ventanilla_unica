/**
 * Resuelve el identificador de definición de proceso Camunda 8 para descargar BPMN XML.
 * Prioriza datos live del snapshot / instancia y cae al expediente o catálogo local.
 *
 * @param {{
 *   snapshot?: Record<string, unknown>|null,
 *   processInstance?: Record<string, unknown>|null,
 *   procedureRequest?: Record<string, unknown>|null,
 *   procedureType?: Record<string, unknown>|null,
 * }} ctx
 * @returns {string|null}
 */
export function resolveProcedureCamundaProcessDefinitionId({
  snapshot = null,
  processInstance = null,
  procedureRequest = null,
  procedureType = null,
} = {}) {
  const fromSnapshot = String(
    snapshot?.process?.definitionId || snapshot?.process?.bpmnProcessId || ""
  ).trim();
  if (fromSnapshot) {
    return fromSnapshot;
  }
  const fromInstance = String(
    processInstance?.processDefinitionId || processInstance?.bpmnProcessId || ""
  ).trim();
  if (fromInstance) {
    return fromInstance;
  }
  const fromRow = String(procedureRequest?.camundaProcessDefinitionId || "").trim();
  if (fromRow) {
    return fromRow;
  }
  const fromType = String(procedureType?.camundaProcessId || "").trim();
  return fromType || null;
}

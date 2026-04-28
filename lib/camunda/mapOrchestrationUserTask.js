function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Mapea fila de `/v2/user-tasks/search` (Orchestration REST v2) al modelo de tarea activa del snapshot.
 * Acepta ítems con `userTaskKey` + `elementId` sin `id` ni `taskDefinitionKey` legacy.
 * @param {Record<string, unknown>|null|undefined} task
 * @returns {Record<string, unknown>|null}
 */
export function mapCamundaOrchestrationUserTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  const finalId = String(task.id ?? task.key ?? task.userTaskKey ?? "").trim();
  const finalDef = String(task.taskDefinitionKey ?? task.taskDefinitionId ?? task.elementId ?? "").trim();
  if (!finalId || !finalDef) {
    return null;
  }

  const userTaskKey = String(task.userTaskKey ?? task.id ?? task.key ?? "").trim() || finalId;
  const taskDefinitionId =
    String(task.taskDefinitionId ?? task.taskDefinitionKey ?? task.elementId ?? "").trim() || finalDef;

  return {
    id: finalId,
    taskId: finalId,
    userTaskKey,
    taskDefinitionKey: finalDef,
    taskDefinitionId,
    name: String(task.name || "").trim() || null,
    state: toUpper(task.state || task.status || "") || null,
    assignee:
      task.assignee != null && String(task.assignee).trim() ? String(task.assignee).trim() : null,
    processInstanceKey:
      task.processInstanceKey != null && String(task.processInstanceKey).trim()
        ? String(task.processInstanceKey).trim()
        : null,
    elementInstanceKey:
      task.elementInstanceKey != null && String(task.elementInstanceKey).trim()
        ? String(task.elementInstanceKey).trim()
        : null,
    formKey: task.formKey != null && String(task.formKey).trim() ? String(task.formKey).trim() : null,
    candidateGroups: Array.isArray(task.candidateGroups) ? task.candidateGroups : [],
    candidateUsers: Array.isArray(task.candidateUsers) ? task.candidateUsers : [],
    createdAt: task.creationDate || task.createdAt || null,
  };
}

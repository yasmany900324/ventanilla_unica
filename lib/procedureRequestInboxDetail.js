/**
 * Shared helpers for procedure request inbox detail (admin vs funcionario).
 * Admin detail uses lax assignee visibility; funcionario routes use strict checks separately.
 */

export function canAccessProcedureRequestLax(userId, procedureRequest) {
  if (!procedureRequest) {
    return false;
  }
  const assignedTo = String(
    procedureRequest.assignedToUserId || procedureRequest.taskAssigneeId || ""
  ).trim();
  if (!assignedTo) {
    return true;
  }
  return assignedTo === String(userId || "").trim();
}

export function canAccessProcedureRequestStrict(userId, procedureRequest) {
  if (!procedureRequest) {
    return false;
  }
  const assignedTo = String(
    procedureRequest.assignedToUserId || procedureRequest.taskAssigneeId || ""
  ).trim();
  return Boolean(assignedTo) && assignedTo === String(userId || "").trim();
}

export function humanizeTaskDefinitionKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Sin tarea activa";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function resolveTaskUiConfig({ activeTask, procedureType }) {
  const taskDefinitionKey = String(activeTask?.taskDefinitionKey || "").trim();
  if (!taskDefinitionKey) {
    return null;
  }
  const flowDefinition =
    procedureType?.flowDefinition && typeof procedureType.flowDefinition === "object"
      ? procedureType.flowDefinition
      : null;
  if (!flowDefinition) {
    return null;
  }
  const dictionaryAsArray = Array.isArray(flowDefinition.taskUiDictionary)
    ? flowDefinition.taskUiDictionary
    : [];
  const dictionaryAsObject =
    flowDefinition.taskUiDictionary &&
    typeof flowDefinition.taskUiDictionary === "object" &&
    !Array.isArray(flowDefinition.taskUiDictionary)
      ? flowDefinition.taskUiDictionary
      : null;
  if (dictionaryAsObject?.[taskDefinitionKey] && typeof dictionaryAsObject[taskDefinitionKey] === "object") {
    return {
      taskDefinitionKey,
      ...dictionaryAsObject[taskDefinitionKey],
    };
  }
  return (
    dictionaryAsArray.find(
      (item) =>
        item &&
        typeof item === "object" &&
        String(item.taskDefinitionKey || "").trim() === taskDefinitionKey
    ) || null
  );
}

export function resolveTaskDisplayConfig({ activeTask, procedureType }) {
  const taskDefinitionKey = String(activeTask?.taskDefinitionKey || "").trim();
  if (!taskDefinitionKey) {
    return {
      taskDefinitionKey: "",
      title: "Sin tarea activa",
      description: "",
      primaryActionLabel: "Completar tarea",
      requiredVariables: [],
    };
  }
  const citizenInfoTasks =
    procedureType?.flowDefinition && typeof procedureType.flowDefinition === "object"
      ? procedureType.flowDefinition.citizenInfoTasks
      : null;
  const citizenInfoConfig =
    citizenInfoTasks && typeof citizenInfoTasks === "object"
      ? citizenInfoTasks[taskDefinitionKey]
      : null;
  const taskUiConfig = resolveTaskUiConfig({ activeTask, procedureType });
  if (taskUiConfig) {
    return {
      taskDefinitionKey,
      title: String(taskUiConfig.title || "").trim() || humanizeTaskDefinitionKey(taskDefinitionKey),
      description: String(taskUiConfig.description || "").trim(),
      primaryActionLabel: String(taskUiConfig.primaryActionLabel || "").trim() || "Completar tarea",
      requiredVariables: Array.isArray(taskUiConfig.requiredVariables) ? taskUiConfig.requiredVariables : [],
    };
  }
  if (citizenInfoConfig?.prompt) {
    return {
      taskDefinitionKey,
      title: `Solicitud de información: ${String(citizenInfoConfig.prompt).trim()}`,
      description: "",
      primaryActionLabel: "Completar tarea",
      requiredVariables: [],
    };
  }
  return {
    taskDefinitionKey,
    title: humanizeTaskDefinitionKey(taskDefinitionKey),
    description: "",
    primaryActionLabel: "Completar tarea",
    requiredVariables: [],
  };
}

/**
 * @param {"admin" | "funcionario"} requestsApiSegment
 */
export function buildAvailableActions({
  procedureRequest,
  activeTask,
  procedureType,
  actorId,
  requestsApiSegment,
  includeClaimTask,
}) {
  const actions = [];
  const basePath = `/api/${requestsApiSegment}/procedures/requests/${encodeURIComponent(procedureRequest.id)}`;
  const taskDisplay = resolveTaskDisplayConfig({ activeTask, procedureType });
  const taskDisplayName = taskDisplay.title;
  const requiredFields = Array.isArray(procedureType?.requiredFields) ? procedureType.requiredFields : [];
  if (procedureRequest?.camundaError) {
    actions.push({
      actionKey: "retry_camunda_sync",
      label: "Reintentar sincronización Camunda",
      displayLabel: "Reintentar sincronización",
      endpoint: `${basePath}/retry-camunda-sync`,
      method: "POST",
      requiresTaskClaim: false,
      requiredVariables: [],
    });
  }
  if (includeClaimTask && activeTask?.taskDefinitionKey && !procedureRequest?.taskAssigneeId) {
    actions.push({
      actionKey: "claim_task",
      label: `Reclamar tarea: ${taskDisplayName}`,
      displayLabel: "Reclamar tarea",
      endpoint: `${basePath}/claim-task`,
      method: "POST",
      requiresTaskClaim: false,
      requiredVariables: [],
    });
  }
  const completeTaskMappings = Array.isArray(procedureType?.camundaVariableMappings)
    ? procedureType.camundaVariableMappings.filter(
        (mapping) =>
          mapping?.enabled !== false &&
          String(mapping?.scope || "").toUpperCase() === "COMPLETE_TASK" &&
          String(mapping?.camundaTaskDefinitionKey || "").trim() ===
            String(activeTask?.taskDefinitionKey || "").trim()
      )
    : [];
  const requiresClaim = Boolean(
    activeTask?.taskDefinitionKey &&
      procedureRequest?.taskAssigneeId &&
      String(procedureRequest.taskAssigneeId) !== String(actorId)
  );
  if (activeTask?.taskDefinitionKey) {
    const configuredRequiredVariables = Array.isArray(taskDisplay.requiredVariables)
      ? taskDisplay.requiredVariables
      : [];
    const mergedRequiredVariables =
      configuredRequiredVariables.length > 0
        ? configuredRequiredVariables.map((configuredVariable) => {
            const configuredCamundaVariableName = String(
              configuredVariable?.camundaVariableName || ""
            ).trim();
            const configuredProcedureFieldKey = String(
              configuredVariable?.procedureFieldKey || ""
            ).trim();
            const matchingMapping = completeTaskMappings.find((mapping) => {
              if (
                configuredCamundaVariableName &&
                String(mapping?.camundaVariableName || "").trim() === configuredCamundaVariableName
              ) {
                return true;
              }
              if (
                configuredProcedureFieldKey &&
                String(mapping?.procedureFieldKey || "").trim() === configuredProcedureFieldKey
              ) {
                return true;
              }
              return false;
            });
            const procedureFieldKey =
              configuredProcedureFieldKey ||
              String(matchingMapping?.procedureFieldKey || "").trim() ||
              null;
            const fieldLabel =
              String(configuredVariable?.label || "").trim() ||
              requiredFields.find((field) => field?.key === procedureFieldKey)?.label ||
              procedureFieldKey ||
              configuredCamundaVariableName ||
              "Variable";
            return {
              procedureFieldKey,
              camundaVariableName:
                configuredCamundaVariableName ||
                String(matchingMapping?.camundaVariableName || "").trim() ||
                null,
              camundaVariableType:
                String(configuredVariable?.camundaVariableType || "").trim() ||
                String(matchingMapping?.camundaVariableType || "").trim() ||
                "string",
              required:
                typeof configuredVariable?.required === "boolean"
                  ? configuredVariable.required
                  : matchingMapping?.required !== false,
              fieldLabel,
            };
          })
        : completeTaskMappings.map((mapping) => ({
            procedureFieldKey: mapping.procedureFieldKey,
            camundaVariableName: mapping.camundaVariableName,
            camundaVariableType: mapping.camundaVariableType,
            required: mapping.required !== false,
            fieldLabel:
              requiredFields.find((field) => field?.key === mapping.procedureFieldKey)?.label ||
              mapping.procedureFieldKey,
          }));
    actions.push({
      actionKey: "complete_task",
      label: `Completar tarea: ${taskDisplayName}`,
      displayLabel: taskDisplay.primaryActionLabel || "Completar tarea",
      description: taskDisplay.description || "",
      endpoint: `${basePath}/complete-task`,
      method: "POST",
      requiresTaskClaim: requiresClaim,
      expectedTaskDefinitionKey: activeTask.taskDefinitionKey,
      taskDisplayName,
      requiredVariables: mergedRequiredVariables,
    });
  }
  return actions;
}

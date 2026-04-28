import { deriveCamundaStatus } from "./funcionarioExpedienteOperationalCamunda";

const TERMINAL_LOCAL = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function trimStr(value) {
  const s = value != null && String(value).trim();
  return s || "";
}

export function isFuncionarioProcessEnded({ processStateUpper, camundaStatusKey, procedureStatus }) {
  const proc = String(processStateUpper || "").trim().toUpperCase();
  if (["COMPLETED", "TERMINATED", "CANCELED", "CANCELLED"].includes(proc)) {
    return true;
  }
  if (String(camundaStatusKey || "").trim().toUpperCase() === "PROCESS_COMPLETED") {
    return true;
  }
  if (TERMINAL_LOCAL.has(String(procedureStatus || "").trim().toUpperCase())) {
    return true;
  }
  return false;
}

/**
 * Reglas de UI para acciones del detalle funcionario (sin tocar backend).
 * @param {{
 *   showCamundaSyncAlert: boolean,
 *   assignmentScope: string|null|undefined,
 *   isAvailable: boolean,
 *   isAssignedToMe: boolean,
 *   isAdmin: boolean,
 *   currentUserId: string|null|undefined,
 *   activeTask: Record<string, unknown>|null|undefined,
 *   operationalActions: unknown[],
 *   claimAction: Record<string, unknown>|null|undefined,
 *   procedureRequest: Record<string, unknown>|null|undefined,
 *   detail: Record<string, unknown>|null|undefined,
 * }} input
 */
export function deriveFuncionarioExpedienteActionUi(input) {
  const {
    showCamundaSyncAlert,
    assignmentScope,
    isAvailable,
    isAssignedToMe,
    isAdmin,
    currentUserId,
    activeTask,
    operationalActions,
    claimAction,
    procedureRequest,
    detail,
  } = input;

  const list = Array.isArray(operationalActions) ? operationalActions : [];
  const procedureStatus = procedureRequest?.status;
  const processStateUpper = String(detail?.operationalState?.process?.state || "").trim();
  const camundaStatusKey = deriveCamundaStatus(procedureRequest, detail);
  const hasActiveTask = Boolean(activeTask?.taskDefinitionKey);

  const assignee = trimStr(activeTask?.assignee);
  const current = trimStr(currentUserId);
  const taskUnassigned = !assignee;
  const taskAssignedToMe = Boolean(assignee && current && assignee === current);
  const taskAssignedToOther = Boolean(assignee && current && assignee !== current);
  /** Assignee existe pero no hay usuario en sesión para comparar: no ofrecer completar. */
  const taskAssigneeUnknownSession = Boolean(assignee && !current);

  const scope = String(assignmentScope || "").trim().toLowerCase();
  const canUseGestorActions = isAssignedToMe || scope === "admin";

  if (showCamundaSyncAlert) {
    return {
      mode: "sync_required",
      siguienteAccionLabel: "Sincronizar con el motor de procesos",
      blockingMessage: null,
      showClaimExpediente: false,
      completeActionForWide: null,
      railOperationalActions: list.filter((a) => a?.actionKey !== "claim_task" && a?.actionKey !== "complete_task"),
    };
  }

  if (isFuncionarioProcessEnded({ processStateUpper, camundaStatusKey, procedureStatus })) {
    return {
      mode: "process_finished",
      siguienteAccionLabel: "Proceso finalizado",
      blockingMessage: null,
      showClaimExpediente: false,
      completeActionForWide: null,
      railOperationalActions: [],
    };
  }

  /** Expediente en bandeja general: solo tomar expediente (claim local). */
  if (isAvailable || scope === "available") {
    return {
      mode: "take_expediente",
      siguienteAccionLabel: "Tomar expediente",
      blockingMessage: null,
      showClaimExpediente: Boolean(claimAction && claimAction.enabled !== false),
      completeActionForWide: null,
      railOperationalActions: list.filter((a) => a?.actionKey !== "claim_task" && a?.actionKey !== "complete_task"),
    };
  }

  if (hasActiveTask && (taskAssignedToOther || taskAssigneeUnknownSession)) {
    return {
      mode: "blocked_other_assignee",
      siguienteAccionLabel: "Sin acción",
      blockingMessage:
        "La tarea activa está asignada a otro funcionario. No podés actuar hasta que la libere o se reasigne.",
      showClaimExpediente: false,
      completeActionForWide: null,
      railOperationalActions: [],
    };
  }

  if (!canUseGestorActions) {
    return {
      mode: "blocked_other_inbox",
      siguienteAccionLabel: "Sin acción",
      blockingMessage: "Este expediente está en la bandeja de otro funcionario.",
      showClaimExpediente: false,
      completeActionForWide: null,
      railOperationalActions: [],
    };
  }

  /** Bandeja propia (o admin): User Task sin assignee en Camunda → tomar tarea, nunca completar. */
  if (hasActiveTask && taskUnassigned) {
    const hasCamundaClaim = list.some((a) => a?.actionKey === "claim_task" && a?.enabled !== false);
    return {
      mode: "take_camunda_task",
      siguienteAccionLabel: hasCamundaClaim ? "Tomar tarea" : "Sin acción",
      blockingMessage: hasCamundaClaim
        ? null
        : "La tarea está sin responsable asignado, pero no hay una acción disponible para tomarla. Revisá la sincronización o contactá a sistemas.",
      showClaimExpediente: false,
      completeActionForWide: null,
      railOperationalActions: hasCamundaClaim ? list.filter((a) => a?.actionKey !== "complete_task") : [],
    };
  }

  /** User Task asignada a mí → completar paso (formulario ancho). */
  if (hasActiveTask && taskAssignedToMe) {
    const complete = list.find((a) => a?.actionKey === "complete_task") || null;
    const showWide = Boolean(complete && complete.enabled !== false);
    return {
      mode: "complete_step",
      siguienteAccionLabel: showWide ? "Completar este paso" : "Sin acción",
      blockingMessage: showWide
        ? null
        : "No hay una acción de completar disponible para esta tarea en este momento.",
      showClaimExpediente: false,
      completeActionForWide: showWide ? complete : null,
      railOperationalActions: list.filter((a) => a?.actionKey !== "complete_task" && a?.actionKey !== "claim_task"),
    };
  }

  /** Sin tarea activa en Camunda pero proceso no terminado. */
  return {
    mode: "idle_no_task",
    siguienteAccionLabel: "Sin acción",
    blockingMessage: null,
    showClaimExpediente: false,
    completeActionForWide: null,
    railOperationalActions: list.filter((a) => a?.actionKey !== "complete_task"),
  };
}

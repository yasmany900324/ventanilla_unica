/**
 * Heuristic workflow stages for funcionario expediente detail UI (non-BPMN).
 * Maps local status + task label keywords to a 5-step institutional journey.
 */

const TERMINAL = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

/** Etiquetas de estado para historial ciudadano/funcionario (solo lectura). */
const EXPEDIENTE_ESTADO_LECTURA = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de procesamiento",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  CAMUNDA_ACTIVE_TASK_NOT_FOUND: "Instancia activa (sin tarea visible)",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

export const FUNCIONARIO_WORKFLOW_STEPS = [
  { id: "initial", label: "Datos iniciales" },
  { id: "review", label: "Revisión" },
  { id: "attention", label: "Atención" },
  { id: "verification", label: "Verificación" },
  { id: "closure", label: "Cierre" },
];

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ");
}

/**
 * @param {{
 *   procedureStatus?: string|null,
 *   operativeStepLabel?: string|null,
 *   hasActiveTask?: boolean,
 * }} input
 * @returns {{ currentIndex: number, completedBefore: number }}
 */
export function inferFuncionarioWorkflowProgress({
  procedureStatus,
  operativeStepLabel,
  hasActiveTask = false,
}) {
  const status = String(procedureStatus || "").trim().toUpperCase();
  if (TERMINAL.has(status)) {
    return { currentIndex: 4, completedBefore: 4 };
  }

  const text = norm(operativeStepLabel);
  if (text.includes("cierre") || text.includes("cerrar") || text.includes("archiv")) {
    return { currentIndex: 4, completedBefore: 3 };
  }
  if (text.includes("verific") || text.includes("comprobac")) {
    return { currentIndex: 3, completedBefore: 2 };
  }
  if (text.includes("atenc") || text.includes("resoluc") || text.includes("gestion operativa")) {
    return { currentIndex: 2, completedBefore: 1 };
  }
  if (text.includes("revis") || text.includes("validac")) {
    return { currentIndex: 1, completedBefore: 0 };
  }
  if (
    text.includes("inicial") ||
    text.includes("registrar datos") ||
    text.includes("datos iniciales") ||
    text.includes("alta") ||
    text.includes("ingreso")
  ) {
    return { currentIndex: 0, completedBefore: -1 };
  }

  if (status === "PENDING_CAMUNDA_SYNC" || status === "PENDING_CONFIRMATION" || status === "DRAFT") {
    return { currentIndex: 0, completedBefore: -1 };
  }
  if (status === "PENDING_BACKOFFICE_ACTION") {
    return { currentIndex: 1, completedBefore: 0 };
  }
  if (status === "WAITING_CITIZEN_INFO") {
    return { currentIndex: 2, completedBefore: 1 };
  }
  if (status === "IN_PROGRESS") {
    if (hasActiveTask) {
      return { currentIndex: 2, completedBefore: 1 };
    }
    return { currentIndex: 1, completedBefore: 0 };
  }
  if (status === "ERROR_CAMUNDA_SYNC" || status === "CAMUNDA_ACTIVE_TASK_NOT_FOUND") {
    return { currentIndex: 1, completedBefore: 0 };
  }

  return { currentIndex: 1, completedBefore: 0 };
}

/**
 * @param {string} type
 * @param {string|null} [newStatus]
 * @param {string|null} [previousStatus]
 */
export function humanizeProcedureEventLabel(type, newStatus, _previousStatus) {
  const t = norm(type).replace(/\s+/g, "_");
  if (t.includes("create") || t === "created") {
    return "Expediente creado";
  }
  if (t.includes("channel") || t.includes("whatsapp") || t.includes("ingreso")) {
    return "Solicitud registrada por el canal ciudadano";
  }
  if (t.includes("status") || t.includes("state")) {
    const key = String(newStatus || "").trim().toUpperCase();
    const label = EXPEDIENTE_ESTADO_LECTURA[key];
    if (label) {
      return `El expediente pasó a ${label}`;
    }
    if (newStatus && /^[A-Z][A-Z0-9_]*$/.test(String(newStatus).trim())) {
      return "Actualización de estado del expediente";
    }
    return "Cambio de estado del expediente";
  }
  if (t.includes("assign") || t.includes("claim")) {
    return "Asignación o toma de expediente";
  }
  if (t.includes("camunda") || t.includes("sync")) {
    return "Actualización del proceso interno";
  }
  const rawType = String(type || "").trim();
  if (/^[A-Z][A-Z0-9_]*$/.test(rawType)) {
    return "Movimiento registrado en el expediente";
  }
  return rawType
    ? rawType
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "Evento";
}

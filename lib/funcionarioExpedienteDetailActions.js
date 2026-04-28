function normalizeApiDisplayTitle(displayLabel) {
  const s = String(displayLabel || "").trim();
  if (!s) {
    return null;
  }
  if (/completar\s+tarea/i.test(s)) {
    return "Completar paso";
  }
  if (/tomar\s+tr[aá]mite/i.test(s)) {
    return "Tomar tarea";
  }
  return s;
}

export function partitionPrimaryOperationalActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) {
    return { primary: null, secondary: [] };
  }
  const completeIdx = list.findIndex((a) => a?.actionKey === "complete_task");
  if (completeIdx >= 0) {
    const primary = list[completeIdx];
    const secondary = list.filter((_, i) => i !== completeIdx);
    return { primary, secondary };
  }
  return { primary: list[0], secondary: list.slice(1) };
}

/**
 * Texto único y alineado con la acción principal real de la pantalla (sin contradicciones).
 */
export function buildFuncionarioSiguienteAccionLabel({
  isAvailable,
  claimAction,
  showCamundaSyncAlert,
  operationalActions,
}) {
  if (showCamundaSyncAlert) {
    return "Sincronizar con el motor de procesos";
  }
  if (isAvailable && claimAction && claimAction.enabled !== false) {
    return "Tomar tarea";
  }
  const complete = operationalActions.find((a) => a?.actionKey === "complete_task");
  if (complete && complete.enabled !== false) {
    return "Completar paso";
  }
  const firstEnabled = operationalActions.find((a) => a?.enabled !== false);
  if (firstEnabled) {
    return buildActionTitle(firstEnabled);
  }
  return "Sin acción disponible por ahora";
}

export function buildActionTitle(action) {
  const normalized = normalizeApiDisplayTitle(action?.displayLabel);
  if (normalized) {
    return normalized;
  }
  if (action?.actionKey === "claim_task") {
    return "Tomar tarea";
  }
  if (action?.actionKey === "complete_task") {
    return "Completar paso";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reintentar sincronización";
  }
  return action?.label || "Acción";
}

export function buildActionDescription(action) {
  if (typeof action?.description === "string" && action.description.trim()) {
    const d = action.description.trim();
    if (/completar\s+tarea/i.test(d)) {
      return d.replace(/completar\s+tarea/gi, "Completar el paso");
    }
    return d;
  }
  if (action?.actionKey === "claim_task") {
    return "Asigná este expediente a tu bandeja para habilitar la gestión y las acciones del proceso.";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reenviá el expediente al motor de procesos cuando hubo un error de sincronización.";
  }
  if (action?.actionKey === "complete_task") {
    return `Registrá la información necesaria y avanzá el trámite: ${action.taskDisplayName || "paso actual"}.`;
  }
  return action?.label || "";
}

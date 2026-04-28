export function buildActionTitle(action) {
  if (action?.displayLabel) {
    return action.displayLabel;
  }
  if (action?.actionKey === "claim_task") {
    return "Tomar trámite";
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
    return action.description.trim();
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

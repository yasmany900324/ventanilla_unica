export const STATUS_STEPS = [
  { value: "recibido", label: "Recibido" },
  { value: "en revision", label: "En revision" },
  { value: "en proceso", label: "En proceso" },
  { value: "resuelto", label: "Resuelto" },
];

export const STATUS_LABELS = STATUS_STEPS.reduce((accumulator, status) => {
  return { ...accumulator, [status.value]: status.label };
}, {});

export function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatIncidentCode(id) {
  return `INC-${String(id).slice(0, 8).toUpperCase()}`;
}

export function shortenText(value, limit = 120) {
  if (!value) {
    return "";
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}

function getDateValue(value) {
  if (!value) {
    return 0;
  }

  const date = new Date(value);
  const timeValue = date.getTime();
  return Number.isNaN(timeValue) ? 0 : timeValue;
}

export function getIncidentCreationValue(incident) {
  if (!incident) {
    return 0;
  }

  return getDateValue(incident.createdAt) || getDateValue(incident.date);
}

export function getIncidentRecencyValue(incident) {
  if (!incident) {
    return 0;
  }

  return (
    getDateValue(incident.updatedAt) ||
    getDateValue(incident.createdAt) ||
    getDateValue(incident.date)
  );
}

export function buildHistoryEntries(incident) {
  if (!incident) {
    return [];
  }

  const currentStatusIndex = STATUS_STEPS.findIndex(
    (step) => step.value === incident.status
  );
  const reachedSteps = STATUS_STEPS.slice(
    0,
    currentStatusIndex >= 0 ? currentStatusIndex + 1 : 1
  );

  return reachedSteps.map((step, index) => ({
    id: `${incident.id}-${step.value}`,
    title: index === 0 ? "Caso recibido" : `Cambio a ${step.label}`,
    date:
      index === 0
        ? formatDate(incident.createdAt)
        : formatDate(incident.updatedAt || incident.createdAt),
    description:
      index === 0
        ? "La incidencia fue registrada y enviada al sistema institucional."
        : "El caso avanzo dentro del flujo oficial de atencion.",
  }));
}

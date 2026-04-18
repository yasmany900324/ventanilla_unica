import { getLocaleCopy } from "./uiTranslations";

const STATUS_KEYS = ["recibido", "en revision", "en proceso", "resuelto"];

export function getStatusSteps(locale = "es") {
  const copy = getLocaleCopy(locale);
  const steps = copy.incident.statusSteps;
  if (Array.isArray(steps) && steps.length === STATUS_KEYS.length) {
    return steps;
  }

  return STATUS_KEYS.map((value) => ({
    value,
    label: copy.incident.statusLabels[value] || value,
  }));
}

export function getStatusLabels(locale = "es") {
  const copy = getLocaleCopy(locale);
  return {
    ...copy.incident.statusLabels,
  };
}

export function formatDate(value, locale = "es") {
  const copy = getLocaleCopy(locale);
  if (!value) {
    return copy.incident.unknownDate;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return copy.incident.unknownDate;
  }

  const localeMap = {
    es: "es-ES",
    en: "en-US",
    pt: "pt-BR",
  };

  return new Intl.DateTimeFormat(localeMap[locale] || "es-ES", {
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

export function buildHistoryEntries(incident, locale = "es") {
  if (!incident) {
    return [];
  }

  const copy = getLocaleCopy(locale);
  const statusSteps = getStatusSteps(locale);
  const currentStatusIndex = statusSteps.findIndex(
    (step) => step.value === incident.status
  );
  const reachedSteps = statusSteps.slice(
    0,
    currentStatusIndex >= 0 ? currentStatusIndex + 1 : 1
  );

  return reachedSteps.map((step, index) => ({
    id: `${incident.id}-${step.value}`,
    title:
      index === 0 ? copy.incident.caseReceived : `${copy.incident.changeTo} ${step.label}`,
    date:
      index === 0
        ? formatDate(incident.createdAt, locale)
        : formatDate(incident.updatedAt || incident.createdAt, locale),
    description:
      index === 0
        ? copy.incident.registeredAndSent
        : copy.incident.progressedOfficialFlow,
  }));
}

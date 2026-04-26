"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import { resolveLocationReferenceLabel } from "../lib/resolveLocationReferenceLabel";
import LocationPickerModal from "./LocationPickerModal";

const MAX_MESSAGE_LENGTH = 500;

const MAX_TEXTAREA_HEIGHT = 168;
const AUTO_SCROLL_THRESHOLD = 120;
const SESSION_ID_STORAGE_KEY = "chatbot_session_id";
const SESSION_LOCALE_STORAGE_KEY = "chatbot_session_locale";
const CHATBOT_MESSAGES_STORAGE_KEY = "chatbot_messages";
const CHATBOT_RESUME_PENDING_KEY = "chatbot_resume_pending";
const DEFAULT_CHAT_COMMAND = "none";
const MAX_PERSISTED_MESSAGES = 80;
const DEFAULT_LOCATION_MAP_CENTER = {
  lat: -34.9011,
  lng: -56.1645,
};
const LOCATION_SHARE_SOURCE_GEO = "geo";
const LOCATION_SHARE_SOURCE_MAP = "map";
const MESSAGE_TYPE_TEXT = "text";
const MESSAGE_TYPE_IMAGE = "image";
const MESSAGE_TYPE_LOCATION = "location";
const MESSAGE_TYPE_QUICK_REPLY = "quick_reply";

function createLocalMessage(partial) {
  const sender = partial?.sender === "user" ? "user" : "bot";
  const role =
    normalizeContextParam(partial?.role, 20) || (sender === "user" ? "user" : "assistant");
  const type = normalizeContextParam(partial?.type, 40) || MESSAGE_TYPE_TEXT;
  return {
    ...partial,
    id: normalizeContextParam(partial?.id, 120) || `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: partial?.createdAt || new Date().toISOString(),
    sender,
    role,
    type,
  };
}

function normalizeInput(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function formatConfidence(confidence) {
  if (typeof confidence !== "number") {
    return null;
  }

  return `${Math.round(confidence * 100)}%`;
}

function buildUserPhotoAttachedLine(_fileName, copy) {
  const fallback = "Listo, adjunte tu foto.";
  const rawTemplate =
    normalizeContextParam(copy?.incidentPhoto?.userAttachedLine, MAX_MESSAGE_LENGTH) || fallback;
  const merged = rawTemplate.includes("{name}") ? rawTemplate.replace("{name}", "foto") : rawTemplate;
  return normalizeChipLabel(merged) || fallback;
}

function formatMessageTime(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeChipLabel(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeLocationPayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    latitude,
    longitude,
    source: normalizeContextParam(value.source, 24) || LOCATION_SHARE_SOURCE_MAP,
    reference: normalizeContextParam(value.reference, 220),
  };
}

function buildUserLocationSentText(copy) {
  return (
    normalizeContextParam(copy?.locationMap?.historyLabel, 80) ||
    normalizeContextParam(copy?.locationMap?.locationHistoryConfirmedPrefix, 80) ||
    "Ubicación enviada"
  );
}

function isNearBottom(container) {
  if (!container) {
    return true;
  }
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= AUTO_SCROLL_THRESHOLD;
}

function extractPayloadChips(fulfillmentMessages) {
  if (!Array.isArray(fulfillmentMessages)) {
    return [];
  }

  const chipSet = new Set();
  const addChip = (candidate) => {
    const normalized = normalizeChipLabel(candidate);
    if (normalized) {
      chipSet.add(normalized);
    }
  };

  fulfillmentMessages.forEach((message) => {
    if (message?.type !== "payload" || !message.payload || typeof message.payload !== "object") {
      return;
    }

    const payload = message.payload;
    if (Array.isArray(payload?.richContent)) {
      payload.richContent.forEach((group) => {
        if (!Array.isArray(group)) {
          return;
        }

        group.forEach((item) => {
          if (item?.type !== "chips" || !Array.isArray(item.options)) {
            return;
          }

          item.options.forEach((option) => {
            addChip(option?.text);
          });
        });
      });
    }

    if (Array.isArray(payload?.suggestions)) {
      payload.suggestions.forEach((suggestion) => {
        addChip(suggestion?.title || suggestion?.text);
      });
    }
  });

  return Array.from(chipSet);
}

function normalizeActionOptions(actionOptions) {
  if (!Array.isArray(actionOptions)) {
    return [];
  }
  const hiddenCommands = new Set([
    "confirm",
    "cancel",
    "open_incident_correction_menu",
    "resume_confirmation",
    "request_text_correction",
  ]);

  return actionOptions
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const label = normalizeChipLabel(option.label);
      const command = normalizeChipLabel(option.command) || DEFAULT_CHAT_COMMAND;
      const value = normalizeChipLabel(option.value);
      const commandField = normalizeChipLabel(option.commandField);
      if (!label || hiddenCommands.has(command)) {
        return null;
      }

      return {
        label,
        command,
        value,
        commandField: commandField || null,
      };
    })
    .filter(Boolean);
}

function buildPhotoStepActionOptionsFromCopy(photoCopy) {
  const attach =
    normalizeContextParam(photoCopy?.attachLabel, 40) || "Adjuntar foto";
  const omit = normalizeContextParam(photoCopy?.omitLabel, 40) || "Omitir foto";
  return normalizeActionOptions([
    { label: attach, command: "set_photo_pending", value: "", commandField: null },
    { label: omit, command: "skip_photo", value: "", commandField: null },
  ]);
}

function safeSetLocalStorageItem(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

function safeGetLocalStorageItem(key) {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) || "";
}

function safeRemoveLocalStorageItem(key) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(key);
}

function normalizePersistedMessage(rawMessage, index) {
  if (!rawMessage || typeof rawMessage !== "object") {
    return null;
  }

  const sender = rawMessage.sender === "user" ? "user" : rawMessage.sender === "bot" ? "bot" : "";
  if (!sender) {
    return null;
  }

  const messageType = normalizeContextParam(rawMessage.type, 40) || MESSAGE_TYPE_TEXT;
  const location = normalizeLocationPayload(rawMessage.location);
  const text = normalizeChipLabel(rawMessage.text);
  if (!text && !location && !rawMessage.attachmentImageUrl) {
    return null;
  }

  const createdAt = normalizeContextParam(rawMessage.createdAt, 80);
  const hasValidDate = createdAt && !Number.isNaN(new Date(createdAt).getTime());
  const actionOptions = normalizeActionOptions(rawMessage.actionOptions);
  const suggestedReplies = Array.isArray(rawMessage.suggestedReplies)
    ? rawMessage.suggestedReplies
        .map((value) => normalizeChipLabel(value))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    id: normalizeContextParam(rawMessage.id, 80) || `msg-restored-${Date.now()}-${index}`,
    sender,
    role:
      normalizeContextParam(rawMessage.role, 20) || (sender === "user" ? "user" : "assistant"),
    type: messageType,
    text:
      text ||
      (messageType === MESSAGE_TYPE_LOCATION
        ? "Ubicación enviada"
        : messageType === MESSAGE_TYPE_IMAGE
          ? "Foto enviada"
          : ""),
    createdAt: hasValidDate ? createdAt : new Date().toISOString(),
    kind: normalizeContextParam(rawMessage.kind, 40) || undefined,
    intent: normalizeContextParam(rawMessage.intent, 60) || null,
    confidence: normalizeContextParam(rawMessage.confidence, 20) || null,
    action: normalizeContextParam(rawMessage.action, 80) || null,
    suggestedReplies,
    actionOptions,
    nextStep:
      rawMessage.nextStep && typeof rawMessage.nextStep === "object"
        ? {
            type: normalizeContextParam(rawMessage.nextStep.type, 60) || null,
            field: normalizeContextParam(rawMessage.nextStep.field, 60) || null,
          }
        : null,
    statusSummary: normalizeStatusSummary(rawMessage.statusSummary),
    incidentDraftPreview: normalizeIncidentDraftPreview(rawMessage.incidentDraftPreview),
    mode: normalizeContextParam(rawMessage.mode, 40) || null,
    redirectTo: normalizeContextParam(rawMessage.redirectTo, 180) || null,
    redirectLabel: normalizeContextParam(rawMessage.redirectLabel, 120) || null,
    needsClarification: Boolean(rawMessage.needsClarification),
    attachmentImageUrl: normalizeContextParam(rawMessage.attachmentImageUrl, 600) || null,
    location,
    quickReply:
      rawMessage.quickReply && typeof rawMessage.quickReply === "object"
        ? {
            label: normalizeContextParam(rawMessage.quickReply.label, 120) || "",
            command: normalizeContextParam(rawMessage.quickReply.command, 80) || DEFAULT_CHAT_COMMAND,
            commandField: normalizeContextParam(rawMessage.quickReply.commandField, 80) || null,
          }
        : null,
  };
}

function parsePersistedMessages(serializedMessages) {
  if (typeof serializedMessages !== "string" || !serializedMessages.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(serializedMessages);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((rawMessage, index) => normalizePersistedMessage(rawMessage, index))
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function buildPersistedMessagesPayload(messages) {
  if (!Array.isArray(messages)) {
    return "[]";
  }

  const normalized = messages
    .slice(-MAX_PERSISTED_MESSAGES)
    .map((message, index) => normalizePersistedMessage(message, index))
    .filter(Boolean);

  return JSON.stringify(normalized);
}

function normalizeContextParam(value, maxLength = 120) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isLocationPromptStep(message) {
  if (message?.sender !== "bot" || message?.nextStep?.type !== "ask_field") {
    return false;
  }
  const stepField = normalizeContextParam(message?.nextStep?.field, 80).toLowerCase();
  if (!stepField) {
    return false;
  }
  if (stepField === "location") {
    return true;
  }
  return (
    stepField.includes("ubic") ||
    stepField.includes("direcc") ||
    stepField.includes("address")
  );
}

function isPhotoPromptStep(message) {
  if (message?.sender !== "bot" || message?.nextStep?.type !== "ask_field") {
    return false;
  }
  const stepField = normalizeContextParam(message?.nextStep?.field, 80).toLowerCase();
  if (!stepField) {
    return false;
  }
  return stepField === "photo" || stepField.includes("foto") || stepField.includes("image");
}

function getChatEntryContext(searchParams) {
  const rawType = normalizeContextParam(searchParams.get("type"), 24).toLowerCase();
  if (rawType !== "tramite" && rawType !== "incidencia") {
    return null;
  }

  const id = normalizeContextParam(searchParams.get("id"), 60);
  const title = normalizeContextParam(searchParams.get("title"), 120);
  const description = normalizeContextParam(searchParams.get("description"), 180);
  const category = normalizeContextParam(searchParams.get("category"), 40).toLowerCase();
  if (!title) {
    return null;
  }

  return {
    type: rawType,
    id,
    title,
    description,
    category,
  };
}

function buildContextAutoPrompt({ context, copy }) {
  if (!context || !copy?.contextualEntry) {
    return "";
  }

  if (context.type === "tramite") {
    return copy.contextualEntry.procedurePrompt.replace("{title}", context.title);
  }

  const categoryLabel = context.category || context.title;
  return copy.contextualEntry.incidentPrompt.replace("{title}", categoryLabel);
}

function normalizeContextEntryPayload(context) {
  if (!context) {
    return null;
  }

  const kind = context.type === "tramite" ? "tramite" : context.type === "incidencia" ? "incidencia" : "";
  if (!kind) {
    return null;
  }

  const title = normalizeContextParam(context.title, 120);
  if (!title) {
    return null;
  }

  return {
    kind,
    title,
    description: normalizeContextParam(context.description, 180),
    category: normalizeContextParam(context.category, 40).toLowerCase(),
  };
}

function buildContextWelcomeMessage({ context, copy }) {
  if (!context || !copy?.contextualEntry) {
    return copy.welcome;
  }

  if (context.type === "tramite") {
    return copy.contextualEntry.procedureMessage.replace("{title}", context.title);
  }

  return copy.contextualEntry.incidentMessage.replace("{title}", context.title);
}

function formatStatusTimestamp(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function humanizeIncidentType(value) {
  const normalized = normalizeContextParam(value, 120).toLowerCase();
  if (!normalized) {
    return "Incidencia general";
  }
  if (normalized === "incidencia_general" || normalized === "reporte_general") {
    return "Incidencia general";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function extractRiskFromDescription(descriptionText) {
  const normalizedDescription = normalizeContextParam(descriptionText, 500);
  if (!normalizedDescription) {
    return {
      cleanedDescription: "",
      extractedRisk: "",
    };
  }

  const riskMatch = normalizedDescription.match(/\(\s*Riesgo:\s*([^)]+)\)\s*$/iu);
  if (!riskMatch?.[1]) {
    return {
      cleanedDescription: normalizedDescription,
      extractedRisk: "",
    };
  }

  const extractedRisk = normalizeContextParam(riskMatch[1], 80);
  const cleanedDescription = normalizeContextParam(
    normalizedDescription.replace(riskMatch[0], ""),
    500
  );
  return {
    cleanedDescription,
    extractedRisk,
  };
}

function isMeaningfulRiskValue(value) {
  const normalized = normalizeContextParam(value, 80).toLowerCase();
  if (!normalized) {
    return false;
  }
  return !["no", "ninguno", "ninguna", "sin", "n/a", "na", "no aplica"].includes(
    normalized
  );
}

function normalizeStatusSummary(rawSummary) {
  if (!rawSummary || typeof rawSummary !== "object") {
    return null;
  }
  const kind = normalizeContextParam(rawSummary.kind, 30).toLowerCase();
  if (kind !== "incident" && kind !== "procedure") {
    return null;
  }
  const displayCode = normalizeContextParam(rawSummary.displayCode, 120);
  const status = normalizeContextParam(rawSummary.status, 80);
  const category = normalizeContextParam(rawSummary.category, 120);
  const location = normalizeContextParam(rawSummary.location, 200);
  const rawDescription = normalizeContextParam(rawSummary.description, 500);
  const procedureName = normalizeContextParam(rawSummary.procedureName, 180);
  const procedureCategory = normalizeContextParam(rawSummary.procedureCategory, 120);
  const summary = normalizeContextParam(rawSummary.summary, 400);
  const risk = normalizeContextParam(rawSummary.risk, 80);
  const { cleanedDescription, extractedRisk } = extractRiskFromDescription(rawDescription);
  const effectiveRisk = risk || extractedRisk;
  const updatedAt = formatStatusTimestamp(rawSummary.updatedAt);
  const createdAt = formatStatusTimestamp(rawSummary.createdAt);

  return {
    kind,
    displayCode,
    status,
    category: humanizeIncidentType(category),
    location,
    description: cleanedDescription,
    procedureName,
    procedureCategory,
    summary,
    risk: isMeaningfulRiskValue(effectiveRisk) ? effectiveRisk : "",
    updatedAt,
    createdAt,
  };
}

function normalizeIncidentDraftPreview(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (normalizeContextParam(raw.kind, 40).toLowerCase() !== "incident_draft") {
    return null;
  }
  const normalizedFields = Array.isArray(raw.fields)
    ? raw.fields
        .map((field) => {
          if (!field || typeof field !== "object") {
            return null;
          }
          const label = normalizeContextParam(field.label, 120);
          const value = normalizeContextParam(field.value, 320);
          const key = normalizeContextParam(field.key, 80).toLowerCase();
          if (!label) {
            return null;
          }
          return {
            key,
            label,
            value: value || "Sin dato",
          };
        })
        .filter(Boolean)
    : [];
  return {
    kind: "incident_draft",
    procedureLabel: normalizeContextParam(raw.procedureLabel, 180) || "Registrar incidencia",
    typeLabel: normalizeContextParam(raw.typeLabel, 120) || "Incidencia",
    fields: normalizedFields,
  };
}

function buildStatusDetailRows(statusSummary) {
  if (!statusSummary) {
    return [];
  }
  if (statusSummary.kind === "incident") {
    const updateLabel = statusSummary.updatedAt ? "Última actualización" : "Fecha de registro";
    const updateValue =
      statusSummary.updatedAt || statusSummary.createdAt || "Sin dato";
    return [
      { label: updateLabel, value: updateValue },
      { label: "Ubicación", value: statusSummary.location || "Sin dato" },
      { label: "Tipo", value: statusSummary.category || "Incidencia" },
      { label: "Descripción", value: statusSummary.description || "Sin dato" },
      ...(statusSummary.risk
        ? [{ label: "Riesgo reportado", value: statusSummary.risk }]
        : []),
    ];
  }
  return [
    { label: "Última actualización", value: statusSummary.updatedAt || "Sin dato" },
    { label: "Trámite", value: statusSummary.procedureName || "Sin dato" },
    { label: "Categoría", value: statusSummary.procedureCategory || "Sin dato" },
    { label: "Detalle", value: statusSummary.summary || "Sin dato" },
  ];
}

function dedupeActionOptions(actionOptions) {
  if (!Array.isArray(actionOptions)) {
    return [];
  }
  const seenLabels = new Set();
  const deduped = [];
  actionOptions.forEach((option) => {
    if (!option?.label) {
      return;
    }
    const key = option.label.toLowerCase();
    if (seenLabels.has(key)) {
      return;
    }
    seenLabels.add(key);
    deduped.push(option);
  });
  return deduped;
}

function humanizeStatusLabel(value) {
  const normalized = normalizeContextParam(value, 80).toLowerCase();
  if (!normalized) {
    return "Sin estado";
  }
  if (normalized === "recibido") {
    return "Recibido";
  }
  if (normalized === "en revision") {
    return "En revisión";
  }
  if (normalized === "en proceso") {
    return "En proceso";
  }
  if (normalized === "resuelto") {
    return "Resuelto";
  }
  return value;
}

function inferStatusExplanation(statusSummary) {
  const normalized = normalizeContextParam(statusSummary?.status, 80).toLowerCase();
  if (normalized === "recibido") {
    return "Tu incidencia fue registrada correctamente y está pendiente de revisión por el equipo correspondiente.";
  }
  if (normalized === "en revision") {
    return "Tu incidencia está siendo revisada por el equipo correspondiente.";
  }
  if (normalized === "en proceso") {
    return "Tu incidencia está en proceso de atención.";
  }
  if (normalized === "resuelto") {
    return "Tu incidencia figura como resuelta.";
  }
  return "Te comparto el estado actualizado de tu caso.";
}

function IncidentDraftPreviewCard({ preview, copy }) {
  const normalized = normalizeIncidentDraftPreview(preview);
  if (!normalized) {
    return null;
  }
  const draftCopy = copy?.incidentDraftPreview || {};
  const statusLabel = draftCopy.statusPending || "Pendiente de confirmación";
  const rows = [
    { label: draftCopy.rowProcedure || "Procedimiento", value: normalized.procedureLabel || "—" },
    { label: draftCopy.rowType || "Tipo", value: normalized.typeLabel || "—" },
    ...normalized.fields,
    { label: draftCopy.rowStatus || "Estado", value: statusLabel },
  ];

  return (
    <section
      className="assistant-status-card assistant-status-card--draft"
      aria-label={draftCopy.ariaLabel || "Vista previa del reporte antes de crear la incidencia"}
    >
      <header className="assistant-status-card__header">
        <h3>{draftCopy.title || "Resumen de la incidencia"}</h3>
      </header>
      <p className="assistant-status-card__explanation assistant-status-card__explanation--draft">
        {draftCopy.subtitle ||
          "Vista previa: todavía no se creó el caso en el sistema ni se asignó un número de ticket."}
      </p>
      <hr className="assistant-status-card__divider" />
      <div className="assistant-status-card__details">
        <p className="assistant-status-card__details-title">
          {draftCopy.detailsTitle || "Datos del reporte"}
        </p>
        <dl className="assistant-status-card__details-list">
          {rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="assistant-status-card__detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function StatusSummaryCard({ statusSummary }) {
  const normalizedStatusSummary = normalizeStatusSummary(statusSummary);
  if (!normalizedStatusSummary) {
    return null;
  }
  const statusLabel = humanizeStatusLabel(normalizedStatusSummary.status);
  const detailRows = buildStatusDetailRows(normalizedStatusSummary);
  const explanation = inferStatusExplanation(normalizedStatusSummary);
  const title =
    normalizedStatusSummary.kind === "incident"
      ? `Incidencia ${normalizedStatusSummary.displayCode || ""}`.trim()
      : `Solicitud ${normalizedStatusSummary.displayCode || ""}`.trim();

  return (
    <section className="assistant-status-card" aria-label={title}>
      <header className="assistant-status-card__header">
        <h3>{title}</h3>
      </header>
      <div className="assistant-status-card__status-wrap">
        <p className="assistant-status-card__status-label">Estado actual</p>
        <span
          className={`assistant-status-card__pill assistant-status-card__pill--${normalizeContextParam(
            normalizedStatusSummary.status,
            40
          )
            .toLowerCase()
            .replace(/\s+/g, "-")}`}
        >
          {statusLabel}
        </span>
      </div>
      <p className="assistant-status-card__explanation">{explanation}</p>
      <hr className="assistant-status-card__divider" />
      <div className="assistant-status-card__details">
        <p className="assistant-status-card__details-title">Detalles del caso</p>
        <dl className="assistant-status-card__details-list">
          {detailRows.map((row) => (
            <div key={row.label} className="assistant-status-card__detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function buildOpenStreetMapLink(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}

function buildLocationConfirmedHistoryMessage({ reference, copy }) {
  const locationMapCopy = copy?.locationMap || {};
  const prefix =
    normalizeContextParam(locationMapCopy.locationHistoryConfirmedPrefix, 72) || "Ubicación confirmada";
  const ref = normalizeContextParam(reference, Math.max(40, MAX_MESSAGE_LENGTH - prefix.length - 3));
  if (ref) {
    return normalizeContextParam(`${prefix} · ${ref}`, MAX_MESSAGE_LENGTH);
  }
  return normalizeContextParam(prefix, MAX_MESSAGE_LENGTH);
}

function UserLocationMessageCard({ message, copy }) {
  const location = normalizeLocationPayload(message?.location);
  if (!location) {
    return null;
  }
  const locationMapCopy = copy?.locationMap || {};
  const mapUrl = buildOpenStreetMapLink(location.latitude, location.longitude);
  const referenceText = normalizeContextParam(location.reference, 220);
  return (
    <section
      className="assistant-user-location-card"
      aria-label={locationMapCopy.pendingConfirmMapPreviewAria || "Ubicación enviada por la persona usuaria"}
    >
      <header className="assistant-user-location-card__header">
        <span className="assistant-user-location-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 2.5a7 7 0 0 0-7 7c0 4.9 5.2 10.8 6.5 12.2a.65.65 0 0 0 1 0C13.8 20.3 19 14.4 19 9.5a7 7 0 0 0-7-7Zm0 9.3a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" />
          </svg>
        </span>
        <p className="assistant-user-location-card__title">{buildUserLocationSentText(copy)}</p>
      </header>
      {referenceText ? <p className="assistant-user-location-card__reference">{referenceText}</p> : null}
      <p className="assistant-user-location-card__coords">
        {Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}
      </p>
      {mapUrl ? (
        <a
          className="assistant-user-location-card__link"
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {locationMapCopy.pendingConfirmOpenMap || "Ver en mapa"}
        </a>
      ) : null}
    </section>
  );
}

function ChatHeader({ copy, onClose }) {
  return (
    <header className="assistant-chat-header">
      {onClose ? (
        <button
          type="button"
          className="assistant-chat-header__close"
          onClick={onClose}
          aria-label={copy.header.closeAria}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <div className="assistant-chat-header__row">
        <div className="assistant-chat-header__identity">
          <div className="assistant-chat-header__avatar" aria-hidden="true">
            AV
          </div>
          <div className="assistant-chat-header__titles">
            <p className="assistant-chat-header__eyebrow">{copy.header.eyebrow}</p>
            <h1 className="assistant-chat-header__title">{copy.header.title}</h1>
          </div>
        </div>
        <p className="assistant-chat-header__status" aria-live="polite">
          <span className="assistant-chat-header__status-dot" aria-hidden="true" />
          {copy.header.online}
        </p>
      </div>
      <p className="assistant-chat-header__subtitle assistant-chat-header__subtitle--desktop">
        {copy.header.subtitle}
      </p>
      {copy.header.subtitleMobile ? (
        <p className="assistant-chat-header__subtitle assistant-chat-header__subtitle--mobile">
          {copy.header.subtitleMobile}
        </p>
      ) : null}
    </header>
  );
}

function ChatMessageBubble({
  message,
  onRedirectClick,
  copy,
  onQuickReplySelect,
  isInteractive = false,
  disableInteractions = false,
}) {
  const isBot = message.sender === "bot";
  const timeLabel = formatMessageTime(message.createdAt);
  const suggestedReplies = Array.isArray(message.suggestedReplies) ? message.suggestedReplies : [];
  const actionOptions = Array.isArray(message.actionOptions) ? message.actionOptions : [];
  const interactiveItems = [];
  const seenOptionLabels = new Set();
  suggestedReplies.forEach((reply) => {
    const label = normalizeChipLabel(reply);
    if (!label || seenOptionLabels.has(label.toLowerCase())) {
      return;
    }
    seenOptionLabels.add(label.toLowerCase());
    interactiveItems.push({
      id: `reply-${label.toLowerCase()}`,
      label,
      command: DEFAULT_CHAT_COMMAND,
      commandField: null,
      type: MESSAGE_TYPE_QUICK_REPLY,
    });
  });
  actionOptions.forEach((option, index) => {
    const label = normalizeChipLabel(option?.label);
    if (!label || seenOptionLabels.has(label.toLowerCase())) {
      return;
    }
    seenOptionLabels.add(label.toLowerCase());
    interactiveItems.push({
      id: `action-${index}-${label.toLowerCase()}`,
      label,
      command: normalizeChipLabel(option?.command) || DEFAULT_CHAT_COMMAND,
      commandField: normalizeChipLabel(option?.commandField) || null,
      type: MESSAGE_TYPE_QUICK_REPLY,
    });
  });

  return (
    <li className={`assistant-thread__item assistant-thread__item--${message.sender}`}>
      <article className={`assistant-message assistant-message--${message.sender}`}>
        {message.kind === "error" ? (
          <p className="assistant-message__system-label">{copy.connectionIssue}</p>
        ) : null}
        {!isBot && message.attachmentImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa desde URL del API (sesión autenticada)
          <img
            src={message.attachmentImageUrl}
            alt={copy?.incidentPhoto?.userSentAlt || "Foto enviada por la persona usuaria"}
            className="assistant-message__image-attachment"
          />
        ) : null}
        {!isBot && message.type === MESSAGE_TYPE_LOCATION ? (
          <UserLocationMessageCard message={message} copy={copy} />
        ) : null}
        {!(isBot && message.statusSummary) ? <p>{message.text}</p> : null}
        {isBot && message.incidentDraftPreview ? (
          <IncidentDraftPreviewCard preview={message.incidentDraftPreview} copy={copy} />
        ) : null}
        {isBot && message.statusSummary ? (
          <StatusSummaryCard statusSummary={message.statusSummary} />
        ) : null}
        {isBot && message.needsClarification ? (
          <p className="assistant-message__clarification">
            {copy.clarification}
          </p>
        ) : null}
        {isBot && interactiveItems.length ? (
          <div className="assistant-chat-quick-replies">
            <p className="assistant-chat-quick-replies__title">
              {copy.quickRepliesTitle || "Sugerencias rápidas"}
            </p>
            <div className="assistant-chat-quick-replies__list">
              {interactiveItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="assistant-prompt-chip"
                  disabled={!isInteractive || disableInteractions}
                  onClick={() => onQuickReplySelect?.(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {isBot && message.redirectTo && !message.statusSummary ? (
          <div className="assistant-message__redirect-wrap">
            <p className="assistant-message__redirect-text">
              {copy.redirectIntro}
            </p>
            <Link
              href={message.redirectTo}
              className="assistant-message__redirect"
              onClick={() => onRedirectClick(message)}
            >
              {message.redirectLabel || copy.redirectCta}
            </Link>
          </div>
        ) : null}

        {timeLabel ? (
          <time className="assistant-message__time" dateTime={message.createdAt}>
            {timeLabel}
          </time>
        ) : null}
      </article>
    </li>
  );
}

function TypingIndicator({ copy }) {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article
        className="assistant-message assistant-message--bot assistant-message--typing"
        aria-live="polite"
      >
        <p className="assistant-message__typing-copy">{copy.typing}</p>
        <div className="assistant-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </article>
    </li>
  );
}

function ChatErrorMessage({ onRetry, disabled, copy }) {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article className="assistant-message assistant-message--error">
        <p className="assistant-message__system-label">{copy.retryTitle}</p>
        <p>{copy.retryBody}</p>
        <button
          type="button"
          className="assistant-message__retry-button"
          onClick={onRetry}
          disabled={disabled}
        >
          {copy.retryButton}
        </button>
      </article>
    </li>
  );
}

function ChatComposer({
  composerRef,
  inputValue,
  onInputChange,
  onSubmit,
  isSending,
  canSend,
  onKeyDown,
  characterCount,
  inputRef,
  copy,
  onLocationClick,
  onPhotoClick,
  showLocationMenu,
  onUseCurrentLocation,
  onOpenMapPicker,
  onSearchLocation,
  onUsePreviousLocation,
  canUsePreviousLocation = false,
}) {
  const shouldShowCounter = characterCount >= MAX_MESSAGE_LENGTH - 80;
  const locationMapCopy = copy?.locationMap || {};

  return (
    <form ref={composerRef} className="assistant-chat-composer" onSubmit={onSubmit}>
      <label htmlFor="assistant-chat-input" className="assistant-chat-composer__sr-only">
        {copy.composer.label}
      </label>
      <div className="assistant-chat-composer__input-wrap">
        <div className="assistant-chat-composer__tools">
          <button
            type="button"
            className="assistant-chat-composer__tool"
            onClick={onLocationClick}
            disabled={isSending}
            aria-label="Enviar ubicación"
            title="Enviar ubicación"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2.5a7 7 0 0 0-7 7c0 4.9 5.2 10.8 6.5 12.2a.65.65 0 0 0 1 0C13.8 20.3 19 14.4 19 9.5a7 7 0 0 0-7-7Zm0 9.3a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z" />
            </svg>
          </button>
          <button
            type="button"
            className="assistant-chat-composer__tool"
            onClick={onPhotoClick}
            disabled={isSending}
            aria-label="Adjuntar foto"
            title="Adjuntar foto"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.5 4A3.5 3.5 0 0 0 3 7.5v9A3.5 3.5 0 0 0 6.5 20h11a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 17.5 4h-2.2l-.8-1.2A1.9 1.9 0 0 0 12.9 2h-1.8a1.9 1.9 0 0 0-1.6.8L8.7 4H6.5Zm5.5 4a4.2 4.2 0 1 1 0 8.4A4.2 4.2 0 0 1 12 8Zm0 1.9a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
            </svg>
          </button>
          {showLocationMenu ? (
            <div className="assistant-chat-composer__location-menu" role="menu" aria-label="Opciones de ubicación">
              <button type="button" role="menuitem" onClick={onUseCurrentLocation} disabled={isSending}>
                {locationMapCopy.useCurrentLocation || "Usar mi ubicación"}
              </button>
              <button type="button" role="menuitem" onClick={onOpenMapPicker} disabled={isSending}>
                {locationMapCopy.chooseOnMap || locationMapCopy.useMapSelection || "Elegir en mapa"}
              </button>
              <button type="button" role="menuitem" onClick={onSearchLocation} disabled={isSending}>
                {locationMapCopy.searchAddress || "Buscar dirección"}
              </button>
              {canUsePreviousLocation ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onUsePreviousLocation}
                  disabled={isSending}
                >
                  {locationMapCopy.usePreviousLocation || "Usar ubicación anterior"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <textarea
          ref={inputRef}
          id="assistant-chat-input"
          name="message"
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={copy.composer.placeholder}
          value={inputValue}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          rows={1}
        />
        <button
          type="submit"
          className="assistant-chat-composer__send"
          disabled={!canSend}
          aria-label={isSending ? copy.composer.sendingAria : copy.composer.sendAria}
          title={isSending ? copy.composer.sendingAria : "Enviar mensaje"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.7 20.3 21.1 12 3.7 3.7v6.4l10.2 1.9-10.2 1.9v6.4Z" />
          </svg>
        </button>
      </div>
      {shouldShowCounter ? (
        <p className="assistant-chat-composer__counter">
          {characterCount}/{MAX_MESSAGE_LENGTH}
        </p>
      ) : null}
    </form>
  );
}

export default function AssistantChatPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useLocale();
  const uiCopy = getLocaleCopy(locale).chat;
  const entryContext = useMemo(() => getChatEntryContext(searchParams), [searchParams]);
  const contextualWelcomeMessage = useMemo(
    () => buildContextWelcomeMessage({ context: entryContext, copy: uiCopy }),
    [entryContext, uiCopy]
  );
  const contextAutoPrompt = useMemo(
    () => buildContextAutoPrompt({ context: entryContext, copy: uiCopy }),
    [entryContext, uiCopy]
  );
  const contextEntryPayload = useMemo(() => normalizeContextEntryPayload(entryContext), [entryContext]);
  const contextTriggerKey = useMemo(() => {
    if (!entryContext) {
      return "";
    }

    return `${entryContext.type}|${entryContext.id}|${entryContext.title}`;
  }, [entryContext]);
  const restartKey = useMemo(() => normalizeContextParam(searchParams.get("restart"), 8), [searchParams]);
  const scrollContainerRef = useRef(null);
  const chatCardRef = useRef(null);
  const composerRef = useRef(null);
  const inputRef = useRef(null);
  const incidentPhotoInputRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const initializedSessionRef = useRef(false);
  const contextualPromptSentRef = useRef("");
  const lastFailedInputRef = useRef({
    rawValue: "",
    command: DEFAULT_CHAT_COMMAND,
    commandField: null,
  });
  const [messages, setMessages] = useState([
    createLocalMessage({
      sender: "bot",
      text: contextualWelcomeMessage,
    }),
  ]);
  useEffect(() => {
    setMessages((previousMessages) => {
      if (!previousMessages.length) {
        return previousMessages;
      }
      const [firstMessage, ...rest] = previousMessages;
      if (firstMessage.sender !== "bot") {
        return previousMessages;
      }
      return [
        {
          ...firstMessage,
          text: contextualWelcomeMessage,
        },
        ...rest,
      ];
    });
  }, [contextualWelcomeMessage]);

  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessionLocale, setSessionLocale] = useState("");
  const focusComposerInput = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.requestAnimationFrame(() => {
      const inputElement = inputRef.current;
      if (!inputElement) {
        return;
      }
      inputElement.focus({ preventScroll: true });
      const cursorPosition = inputElement.value.length;
      inputElement.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, []);

  useEffect(() => {
    if (initializedSessionRef.current) {
      return;
    }

    initializedSessionRef.current = true;
    if (typeof window === "undefined") {
      return;
    }

    const shouldResume = safeGetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY) === "1";
    if (!shouldResume) {
      safeRemoveLocalStorageItem(SESSION_ID_STORAGE_KEY);
      safeRemoveLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
      safeRemoveLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY);
      setSessionId("");
      setSessionLocale("");
      return;
    }

    const existingSessionId = safeGetLocalStorageItem(SESSION_ID_STORAGE_KEY);
    if (existingSessionId) {
      setSessionId(existingSessionId);
    }

    const existingSessionLocale = safeGetLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
    if (existingSessionLocale) {
      setSessionLocale(existingSessionLocale);
    }

    const persistedMessages = parsePersistedMessages(
      safeGetLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY)
    );
    if (persistedMessages.length > 0) {
      setMessages(persistedMessages);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(SESSION_ID_STORAGE_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionLocale || typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(SESSION_LOCALE_STORAGE_KEY, sessionLocale);
  }, [sessionLocale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY, buildPersistedMessagesPayload(messages));
  }, [messages]);

  const handleThreadScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    shouldAutoScrollRef.current = isNearBottom(container);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const shouldStickToBottom = shouldAutoScrollRef.current || isSending;
    if (!shouldStickToBottom) {
      return;
    }
    container.scrollTo({
      top: container.scrollHeight,
      behavior: messages.length <= 1 ? "auto" : "smooth",
    });
  }, [messages, isSending]);

  useEffect(() => {
    const cardElement = chatCardRef.current;
    const composerElement = composerRef.current;
    if (!cardElement || !composerElement || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const updateComposerHeightVar = () => {
      cardElement.style.setProperty(
        "--assistant-composer-height",
        `${Math.ceil(composerElement.getBoundingClientRect().height)}px`
      );
    };
    updateComposerHeightVar();
    const resizeObserver = new ResizeObserver(() => {
      updateComposerHeightVar();
    });
    resizeObserver.observe(composerElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) {
      return;
    }

    inputElement.style.height = "auto";
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [inputValue]);

  useEffect(() => {
    focusComposerInput();
  }, [focusComposerInput]);

  useEffect(() => {
    if (restartKey !== "1") {
      return;
    }

    safeRemoveLocalStorageItem(SESSION_ID_STORAGE_KEY);
    safeRemoveLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
    safeRemoveLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY);
    safeRemoveLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    contextualPromptSentRef.current = "";
    lastFailedInputRef.current = {
      rawValue: "",
      command: DEFAULT_CHAT_COMMAND,
      commandField: null,
    };
    setSessionId("");
    setSessionLocale("");
    setInputValue("");
    setIsSending(false);
    setServiceError(false);
    setLocationPickerOpen(false);
    setMapPickerInitialCenter(null);
    setComposerLocationMenuOpen(false);
    setIsLocationPickResolving(false);
    setLastSharedLocation(null);
    setMessages([
      createLocalMessage({
        sender: "bot",
        text: contextualWelcomeMessage,
      }),
    ]);
    router.replace(pathname || "/asistente");
  }, [contextualWelcomeMessage, pathname, restartKey, router]);

  const submitMessage = useCallback(async ({
    rawValue,
    command = DEFAULT_CHAT_COMMAND,
    commandField = null,
    appendUserMessage,
    contextEntry = null,
    restoreComposerFocus = false,
  }) => {
    const text = normalizeInput(rawValue);
    if ((!text && command === DEFAULT_CHAT_COMMAND) || isSending) {
      return;
    }

    const clientDebugEnabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem("chatbot_debug") === "1";
    if (clientDebugEnabled) {
      console.info("[chatbot][client][send]", {
        sessionId: sessionId || null,
        locale: sessionLocale || locale || "es",
        command,
        commandField,
        text,
      });
    }

    setServiceError(false);
    if (appendUserMessage && text) {
      setInputValue("");
      if (restoreComposerFocus) {
        focusComposerInput();
      }
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({ sender: "user", text }),
      ]);
    }
    setIsSending(true);

    try {
      const response = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientDebugEnabled ? { "x-chatbot-debug": "1" } : {}),
        },
        body: JSON.stringify({
          text,
          sessionId: sessionId || undefined,
          preferredLocale: sessionLocale || locale || "es",
          command,
          commandField,
          contextEntry,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || uiCopy.networkError);
      }

      const fulfillmentMessages = Array.isArray(data?.fulfillmentMessages)
        ? data.fulfillmentMessages
        : [];
      const suggestedReplies = extractPayloadChips(fulfillmentMessages);
      const actionOptions = normalizeActionOptions(data?.actionOptions);
      const statusSummary = normalizeStatusSummary(data?.statusSummary);
      const incidentDraftPreview = normalizeIncidentDraftPreview(data?.incidentDraftPreview);
      const effectiveActionOptions = statusSummary
        ? dedupeActionOptions(actionOptions).slice(0, 3)
        : actionOptions;
      if (data?.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      if (typeof data?.locale === "string" && data.locale && data.locale !== sessionLocale) {
        setSessionLocale(data.locale);
      }

      if (clientDebugEnabled) {
        console.info("[chatbot][client][response]", {
          requestSessionId: sessionId || null,
          responseSessionId: data?.sessionId || null,
          mode: data?.mode || null,
          action: data?.action || null,
          intent: data?.intent || null,
          nextStep: data?.nextStep || null,
          draft: data?.draft || null,
          needsClarification: Boolean(data?.needsClarification),
        });
      }
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "bot",
          text:
            data?.replyText ||
            uiCopy.fallbackReply,
          intent: data?.intent || null,
          confidence: formatConfidence(data?.confidence),
          action: data?.action || null,
          fulfillmentMessages,
          suggestedReplies,
          actionOptions: effectiveActionOptions,
          nextStep: data?.nextStep || null,
          mode: data?.mode || null,
          draft: data?.draft || null,
          redirectTo: data?.redirectTo || null,
          redirectLabel: data?.redirectLabel || null,
          needsClarification: Boolean(data?.needsClarification),
          statusSummary,
          incidentDraftPreview,
        }),
      ]);
      lastFailedInputRef.current = {
        rawValue: "",
        command: DEFAULT_CHAT_COMMAND,
        commandField: null,
      };
    } catch (error) {
      lastFailedInputRef.current = {
        rawValue: text,
        command,
        commandField,
      };
      setServiceError(true);
    } finally {
      setIsSending(false);
      if (restoreComposerFocus) {
        focusComposerInput();
      }
    }
  }, [
    focusComposerInput,
    isSending,
    locale,
    sessionId,
    sessionLocale,
    uiCopy.fallbackReply,
    uiCopy.networkError,
  ]);

  useEffect(() => {
    const shouldResume = safeGetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    if (shouldResume !== "1" || isSending) {
      return;
    }

    safeRemoveLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    void submitMessage({
      rawValue: "",
      command: "resume_confirmation",
      appendUserMessage: false,
    });
  }, [isSending, submitMessage]);

  useEffect(() => {
    if (!contextAutoPrompt || !contextTriggerKey || isSending) {
      return;
    }
    if (contextualPromptSentRef.current === contextTriggerKey) {
      return;
    }

    contextualPromptSentRef.current = contextTriggerKey;
    void submitMessage({
      rawValue: contextAutoPrompt,
      command: "start_contextual_flow",
      appendUserMessage: false,
      contextEntry: contextEntryPayload,
    });
  }, [contextAutoPrompt, contextEntryPayload, contextTriggerKey, isSending, submitMessage]);

  const handleSendMessage = async (rawValue) => {
    setComposerLocationMenuOpen(false);
    shouldAutoScrollRef.current = true;
    await submitMessage({
      rawValue,
      command: DEFAULT_CHAT_COMMAND,
      appendUserMessage: true,
      restoreComposerFocus: true,
    });
  };

  const handleIncidentPhotoInputChange = useCallback(
    async (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      input.value = "";
      if (!file || isSending) {
        return;
      }

      const photoCopy = uiCopy.incidentPhoto || {};
      if (!sessionId) {
        setMessages((previousMessages) => [
          ...previousMessages,
          createLocalMessage({
            sender: "bot",
            text: photoCopy.needSession || "Todavía no está lista la sesión del chat.",
          }),
        ]);
        return;
      }

      const clientDebugEnabled =
        typeof window !== "undefined" && window.localStorage.getItem("chatbot_debug") === "1";

      setIsSending(true);
      try {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        formData.append("file", file);
        formData.append("preferredLocale", sessionLocale || locale || "es");

        const response = await fetch("/api/chatbot/procedure-photo", {
          method: "POST",
          body: formData,
          ...(clientDebugEnabled ? { headers: { "x-chatbot-debug": "1" } } : {}),
        });
        const rawText = await response.text();
        let data;
        try {
          data = rawText ? JSON.parse(rawText) : {};
        } catch {
          data = null;
        }
        if (data === null || typeof data !== "object") {
          throw new Error(
            photoCopy.uploadInvalidResponse ||
              uiCopy.networkError
          );
        }
        if (!response.ok) {
          const serverMsg =
            typeof data.error === "string" && data.error.trim() ? data.error.trim() : "";
          throw new Error(serverMsg || photoCopy.uploadFailed || uiCopy.networkError);
        }

        const fulfillmentMessages = Array.isArray(data?.fulfillmentMessages)
          ? data.fulfillmentMessages
          : [];
        const suggestedReplies = extractPayloadChips(fulfillmentMessages);
        const actionOptions = normalizeActionOptions(data?.actionOptions);
        const statusSummary = normalizeStatusSummary(data?.statusSummary);
        const incidentDraftPreview = normalizeIncidentDraftPreview(data?.incidentDraftPreview);
        const effectiveActionOptions = statusSummary
          ? dedupeActionOptions(actionOptions).slice(0, 3)
          : actionOptions;
        if (data?.sessionId && data.sessionId !== sessionId) {
          setSessionId(data.sessionId);
        }
        if (typeof data?.locale === "string" && data.locale && data.locale !== sessionLocale) {
          setSessionLocale(data.locale);
        }

        const userLine = buildUserPhotoAttachedLine(file.name, uiCopy);
        const rawPreview = typeof data.photoPreviewUrl === "string" ? data.photoPreviewUrl.trim() : "";
        const previewUrl =
          rawPreview.startsWith("http") || rawPreview.startsWith("/") ? rawPreview : null;

        setMessages((previousMessages) => [
          ...previousMessages,
          createLocalMessage({
            sender: "user",
            type: MESSAGE_TYPE_IMAGE,
            text: userLine,
            attachmentImageUrl: previewUrl,
          }),
          createLocalMessage({
            sender: "bot",
            text: data?.replyText || uiCopy.fallbackReply,
            intent: data?.intent || null,
            confidence: formatConfidence(data?.confidence),
            action: data?.action || null,
            fulfillmentMessages,
            suggestedReplies,
            actionOptions: effectiveActionOptions,
            nextStep: data?.nextStep || null,
            mode: data?.mode || null,
            draft: data?.draft || null,
            redirectTo: data?.redirectTo || null,
            redirectLabel: data?.redirectLabel || null,
            needsClarification: Boolean(data?.needsClarification),
            statusSummary,
            incidentDraftPreview,
          }),
        ]);
        lastFailedInputRef.current = {
          rawValue: "",
          command: DEFAULT_CHAT_COMMAND,
          commandField: null,
        };
      } catch (error) {
        const photoActions = buildPhotoStepActionOptionsFromCopy(photoCopy);
        setMessages((previousMessages) => [
          ...previousMessages,
          createLocalMessage({
            sender: "bot",
            text:
              typeof error?.message === "string" && error.message.trim()
                ? error.message.trim()
                : photoCopy.uploadFailed || uiCopy.networkError,
            actionOptions: photoActions,
            nextStep: { type: "ask_field", field: "photo" },
          }),
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, locale, sessionId, sessionLocale, uiCopy]
  );

  const [isLocationPickerOpen, setLocationPickerOpen] = useState(false);
  const [mapPickerInitialCenter, setMapPickerInitialCenter] = useState(null);
  const [isLocationPickResolving, setIsLocationPickResolving] = useState(false);
  const [isComposerLocationMenuOpen, setComposerLocationMenuOpen] = useState(false);
  const [lastSharedLocation, setLastSharedLocation] = useState(null);
  const canSend = useMemo(() => {
    return Boolean(normalizeInput(inputValue)) && !isSending && !isLocationPickResolving;
  }, [inputValue, isLocationPickResolving, isSending]);

  const resolveLocationSelection = useCallback(
    async ({ source, latitude, longitude, priorReference = null }) => {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      const locationMapCopy = uiCopy.locationMap || {};
      const stablePrior = normalizeContextParam(priorReference, 200);
      const fallbackReference =
        source === LOCATION_SHARE_SOURCE_GEO
          ? normalizeContextParam(locationMapCopy.geoFallbackReference, 120) || "tu zona"
          : normalizeContextParam(locationMapCopy.mapFallbackReference, 120) || "el punto seleccionado";
      const resolvedReference = await resolveLocationReferenceLabel({
        latitude: lat,
        longitude: lng,
        fallbackLabel: fallbackReference,
        locale,
      });
      return {
        source,
        latitude: lat,
        longitude: lng,
        reference: stablePrior || resolvedReference || fallbackReference,
      };
    },
    [locale, uiCopy.locationMap]
  );

  const submitLocationSelection = useCallback(
    async (selection) => {
      const normalizedSelection = normalizeLocationPayload(selection);
      if (!normalizedSelection || isSending) {
        return;
      }
      const userHistoryText = buildLocationConfirmedHistoryMessage({
        reference: normalizedSelection.reference,
        copy: uiCopy,
      });
      shouldAutoScrollRef.current = true;
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "user",
          type: MESSAGE_TYPE_LOCATION,
          text: buildUserLocationSentText(uiCopy),
          location: normalizedSelection,
        }),
      ]);
      setLastSharedLocation(normalizedSelection);
      await submitMessage({
        rawValue: userHistoryText,
        command: "set_geo_location",
        commandField: "location",
        appendUserMessage: false,
        restoreComposerFocus: true,
      });
    },
    [isSending, submitMessage, uiCopy]
  );

  const handleUseCurrentLocation = useCallback(() => {
    if (isSending || typeof window === "undefined") {
      return;
    }
    setComposerLocationMenuOpen(false);
    const locationMapCopy = uiCopy.locationMap || {};
    if (!window.navigator?.geolocation) {
      const unsupportedMessage =
        normalizeContextParam(locationMapCopy.unsupported, MAX_MESSAGE_LENGTH) ||
        "Tu navegador no permite compartir ubicación automática.";
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({ sender: "bot", text: unsupportedMessage }),
      ]);
      return;
    }
    setIsLocationPickResolving(true);

    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const resolved = await resolveLocationSelection({
              source: LOCATION_SHARE_SOURCE_GEO,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            if (resolved) {
              await submitLocationSelection(resolved);
            }
          } finally {
            setIsLocationPickResolving(false);
          }
        })();
      },
      (error) => {
        setIsLocationPickResolving(false);
        const deniedMessage =
          normalizeContextParam(locationMapCopy.permissionDenied, MAX_MESSAGE_LENGTH) ||
          "No pude acceder a tu ubicación. Revisa los permisos del navegador e inténtalo de nuevo.";
        const unavailableMessage =
          normalizeContextParam(locationMapCopy.unavailable, MAX_MESSAGE_LENGTH) ||
          "No fue posible obtener tu ubicación ahora. Puedes escribir una referencia manual.";
        setMessages((previousMessages) => [
          ...previousMessages,
          createLocalMessage({
            sender: "bot",
            text: error?.code === 1 ? deniedMessage : unavailableMessage,
          }),
        ]);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, [isSending, resolveLocationSelection, submitLocationSelection, uiCopy.locationMap]);

  const handleOpenMapPicker = useCallback(() => {
    if (isSending) {
      return;
    }
    setComposerLocationMenuOpen(false);
    setMapPickerInitialCenter(lastSharedLocation || null);
    setLocationPickerOpen(true);
  }, [isSending, lastSharedLocation]);

  const handleCancelLocationPicker = useCallback(() => {
    setLocationPickerOpen(false);
    setMapPickerInitialCenter(null);
    setComposerLocationMenuOpen(false);
  }, []);

  const handleConfirmLocationPicker = useCallback(
    async ({ latitude, longitude }) => {
      setIsLocationPickResolving(true);
      try {
        const resolved = await resolveLocationSelection({
          source: LOCATION_SHARE_SOURCE_MAP,
          latitude,
          longitude,
        });
        if (resolved) {
          await submitLocationSelection(resolved);
        }
      } finally {
        setIsLocationPickResolving(false);
        setLocationPickerOpen(false);
        setMapPickerInitialCenter(null);
        setComposerLocationMenuOpen(false);
      }
    },
    [resolveLocationSelection, submitLocationSelection]
  );
  const handleSearchLocation = useCallback(() => {
    void handleOpenMapPicker();
  }, [handleOpenMapPicker]);
  const handleUsePreviousLocation = useCallback(() => {
    if (!lastSharedLocation || isSending) {
      return;
    }
    setComposerLocationMenuOpen(false);
    void submitLocationSelection(lastSharedLocation);
  }, [isSending, lastSharedLocation, submitLocationSelection]);

  const handleRetry = async () => {
    const lastFailedInput = lastFailedInputRef.current;
    if (
      (!lastFailedInput?.rawValue && lastFailedInput?.command === DEFAULT_CHAT_COMMAND) ||
      isSending
    ) {
      return;
    }

    await submitMessage({
      rawValue: lastFailedInput.rawValue,
      command: lastFailedInput.command || DEFAULT_CHAT_COMMAND,
      commandField: lastFailedInput.commandField || null,
      appendUserMessage: false,
    });
  };

  const handleRedirectClick = (message) => {
    if (message?.nextStep?.type !== "auth_required") {
      return;
    }

    safeSetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY, "1");
  };

  const handleInputChange = (event) => {
    setInputValue(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setComposerLocationMenuOpen(false);
      void handleSendMessage(inputValue);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setComposerLocationMenuOpen(false);
    void handleSendMessage(inputValue);
  };

  const characterCount = inputValue.length;
  const lastBotMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.sender === "bot") {
        return messages[index];
      }
    }
    return null;
  }, [messages]);
  const isLocationActionAvailable = useMemo(() => {
    return isLocationPromptStep(lastBotMessage) || isLocationPickerOpen;
  }, [isLocationPickerOpen, lastBotMessage]);
  const isPhotoActionAvailable = useMemo(() => {
    return isPhotoPromptStep(lastBotMessage);
  }, [lastBotMessage]);
  const latestInteractiveMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.sender !== "bot") {
        continue;
      }
      const hasInteractiveReplies =
        (Array.isArray(message.suggestedReplies) && message.suggestedReplies.length > 0) ||
        (Array.isArray(message.actionOptions) && message.actionOptions.length > 0);
      if (hasInteractiveReplies) {
        return message.id;
      }
    }
    return null;
  }, [messages]);

  const handleQuickReplySelection = useCallback(
    async (option) => {
      if (!option || isSending) {
        return;
      }
      const label = normalizeChipLabel(option.label);
      if (!label) {
        return;
      }
      setComposerLocationMenuOpen(false);
      shouldAutoScrollRef.current = true;
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "user",
          type: MESSAGE_TYPE_QUICK_REPLY,
          text: label,
          quickReply: {
            label,
            command: option.command || DEFAULT_CHAT_COMMAND,
            commandField: option.commandField || null,
          },
        }),
      ]);
      await submitMessage({
        rawValue: label,
        command: option.command || DEFAULT_CHAT_COMMAND,
        commandField: option.commandField || null,
        appendUserMessage: false,
        restoreComposerFocus: true,
      });
    },
    [isSending, submitMessage]
  );

  const appendControlledComposerMessage = useCallback((text) => {
    const safeText = normalizeContextParam(text, MAX_MESSAGE_LENGTH);
    if (!safeText) {
      return;
    }
    setMessages((previousMessages) => [
      ...previousMessages,
      createLocalMessage({ sender: "bot", text: safeText }),
    ]);
  }, []);
  const handleComposerLocationIcon = useCallback(() => {
    if (isSending) {
      return;
    }
    if (!isLocationActionAvailable) {
      appendControlledComposerMessage(
        "Primero contame qué necesitás hacer para asociar la ubicación al trámite correcto."
      );
      return;
    }
    setComposerLocationMenuOpen((previous) => !previous);
  }, [appendControlledComposerMessage, isLocationActionAvailable, isSending]);
  const handleComposerPhotoIcon = useCallback(() => {
    if (isSending) {
      return;
    }
    if (!isPhotoActionAvailable) {
      appendControlledComposerMessage(
        "Primero contame qué necesitás hacer para asociar la foto al trámite correcto."
      );
      return;
    }
    setComposerLocationMenuOpen(false);
    incidentPhotoInputRef.current?.click();
  }, [appendControlledComposerMessage, isPhotoActionAvailable, isSending]);

  const handleCloseAssistant = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  }, [router]);

  return (
    <main className="page page--assistant" lang={locale}>
      <section
        ref={chatCardRef}
        className="assistant-chat-card"
        aria-label={uiCopy.conversationAria.section}
      >
        <ChatHeader copy={uiCopy} onClose={handleCloseAssistant} />

        <div
          ref={scrollContainerRef}
          id="assistant-chat-scroll-container"
          className="assistant-chat-messages"
          aria-label={uiCopy.conversationAria.region}
          aria-describedby="assistant-chat-description"
          role="region"
          onScroll={handleThreadScroll}
        >
          <p id="assistant-chat-description" className="assistant-chat-composer__sr-only">
            {uiCopy.conversationAria.description}
          </p>
          <p className="assistant-chat-composer__sr-only" role="status" aria-live="polite">
            {isSending ? uiCopy.typingStatus : serviceError ? uiCopy.networkError : ""}
          </p>
          <ol
            className="assistant-thread"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={uiCopy.conversationAria.log}
          >
            {messages.map((message) => (
              <ChatMessageBubble
                key={message.id}
                message={message}
                onRedirectClick={handleRedirectClick}
                copy={uiCopy}
                onQuickReplySelect={handleQuickReplySelection}
                isInteractive={message.id === latestInteractiveMessageId}
                disableInteractions={isSending}
              />
            ))}
            {isSending ? <TypingIndicator copy={uiCopy} /> : null}

            {serviceError ? (
              <ChatErrorMessage onRetry={handleRetry} disabled={isSending} copy={uiCopy} />
            ) : null}
          </ol>
        </div>

        <LocationPickerModal
          isOpen={isLocationPickerOpen}
          initialCenter={mapPickerInitialCenter ?? DEFAULT_LOCATION_MAP_CENTER}
          onConfirm={handleConfirmLocationPicker}
          onCancel={handleCancelLocationPicker}
          copy={uiCopy}
          disabled={isSending || isLocationPickResolving}
        />

        <input
          ref={incidentPhotoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          className="assistant-chat-composer__sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(photoEvent) => void handleIncidentPhotoInputChange(photoEvent)}
        />

        <ChatComposer
          composerRef={composerRef}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          isSending={isSending || isLocationPickResolving}
          canSend={canSend}
          onKeyDown={handleInputKeyDown}
          characterCount={characterCount}
          inputRef={inputRef}
          copy={uiCopy}
          onLocationClick={handleComposerLocationIcon}
          onPhotoClick={handleComposerPhotoIcon}
          showLocationMenu={isComposerLocationMenuOpen}
          onUseCurrentLocation={handleUseCurrentLocation}
          onOpenMapPicker={handleOpenMapPicker}
          onSearchLocation={handleSearchLocation}
          onUsePreviousLocation={handleUsePreviousLocation}
          canUsePreviousLocation={Boolean(lastSharedLocation)}
        />
      </section>
    </main>
  );
}

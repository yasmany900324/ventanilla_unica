import { randomUUID } from "crypto";
import { normalizeLocale } from "./i18n";

const MAX_MESSAGE_LENGTH = 500;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const ALLOWED_COMMANDS = new Set([
  "none",
  "start_contextual_flow",
  "start_contextual_entry",
  "confirm",
  "cancel",
  "edit_field",
  "set_geo_location",
  "set_photo_pending",
  "skip_photo",
  "resume_confirmation",
]);
const ALLOWED_EDIT_FIELDS = new Set(["location", "description", "risk", "photo"]);
const LEGACY_COMMAND_ALIASES = {
  confirm_incident: { command: "confirm" },
  cancel_incident: { command: "cancel" },
  edit_incident_location: { command: "edit_field", commandField: "location" },
  edit_incident_description: { command: "edit_field", commandField: "description" },
  edit_incident_category: { command: "edit_field", commandField: "description" },
  resume_incident_confirmation: { command: "resume_confirmation" },
};

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeSessionId(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (SESSION_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }

  return randomUUID();
}

function normalizeEditField(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (ALLOWED_EDIT_FIELDS.has(normalized)) {
    return normalized;
  }

  return null;
}

function normalizeChatCommand(rawCommand, rawField) {
  const normalizedRaw = typeof rawCommand === "string" ? rawCommand.trim().toLowerCase() : "";
  const legacyAlias = LEGACY_COMMAND_ALIASES[normalizedRaw] || null;
  const command = legacyAlias?.command || normalizedRaw || "none";
  if (!ALLOWED_COMMANDS.has(command)) {
    return {
      command: "none",
      commandField: null,
    };
  }

  const commandField =
    legacyAlias?.commandField || normalizeEditField(rawField) || (command === "edit_field" ? null : null);
  return {
    command,
    commandField,
  };
}

function normalizeContextEntry(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const kind = typeof value.kind === "string" ? value.kind.trim().toLowerCase() : "";
  if (kind !== "tramite" && kind !== "incidencia") {
    return null;
  }

  const title = sanitizeText(value.title).slice(0, 120);
  if (!title) {
    return null;
  }

  const description = sanitizeText(value.description).slice(0, 180);
  const category = sanitizeText(value.category).toLowerCase().slice(0, 40);
  return {
    kind,
    title,
    description,
    category,
  };
}

export function validateChatMessagePayload(payload) {
  const text = sanitizeText(payload?.text);
  const sessionId = normalizeSessionId(payload?.sessionId);
  const preferredLocale = normalizeLocale(payload?.preferredLocale);
  const { command, commandField } = normalizeChatCommand(payload?.command, payload?.commandField);
  const contextEntry = normalizeContextEntry(payload?.contextEntry);

  if (!text && command === "none") {
    return {
      ok: false,
      error: "El mensaje no puede estar vacio.",
    };
  }

  if (command === "edit_field" && !commandField) {
    return {
      ok: false,
      error: "El comando edit_field requiere indicar el campo a editar.",
    };
  }

  return {
    ok: true,
    value: {
      text,
      sessionId,
      preferredLocale,
      command,
      commandField,
      contextEntry,
    },
  };
}

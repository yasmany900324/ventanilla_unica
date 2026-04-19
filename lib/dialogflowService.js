import { randomUUID } from "crypto";
import { SessionsClient } from "@google-cloud/dialogflow";
import { getDefaultLocale, normalizeLocale } from "./i18n";

const MAX_MESSAGE_LENGTH = 500;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const ALLOWED_CHAT_COMMANDS = new Set([
  "none",
  "start_contextual_flow",
  "start_contextual_entry",
  "confirm_incident",
  "cancel_incident",
  "resume_incident_confirmation",
  "edit_incident_category",
  "edit_incident_description",
  "edit_incident_location",
]);

function normalizePrivateKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\\n/g, "\n").trim();
}

function getDialogflowConfig() {
  const projectId = process.env.DIALOGFLOW_PROJECT_ID?.trim();
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const languageCode = getDefaultLocale();

  const hasCredentials = Boolean(projectId && clientEmail && privateKey);
  return {
    projectId,
    clientEmail,
    privateKey,
    languageCode,
    isConfigured: hasCredentials,
  };
}

function sanitizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeChatCommand(value) {
  if (typeof value !== "string") {
    return "none";
  }

  const normalized = value.trim().toLowerCase();
  if (ALLOWED_CHAT_COMMANDS.has(normalized)) {
    return normalized;
  }

  return "none";
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

function normalizeSessionId(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (SESSION_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }

  return randomUUID();
}

function readFirstReplyText(queryResult) {
  if (queryResult?.fulfillmentText?.trim()) {
    return queryResult.fulfillmentText.trim();
  }

  const textMessage = queryResult?.fulfillmentMessages?.find((message) =>
    Array.isArray(message?.text?.text) && message.text.text.length > 0
  );
  if (textMessage?.text?.text?.[0]) {
    return textMessage.text.text[0];
  }

  return "";
}

function normalizeParameterValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) {
    return value.stringValue;
  }
  if (Object.prototype.hasOwnProperty.call(value, "numberValue")) {
    return value.numberValue;
  }
  if (Object.prototype.hasOwnProperty.call(value, "boolValue")) {
    return value.boolValue;
  }
  if (Object.prototype.hasOwnProperty.call(value, "nullValue")) {
    return null;
  }
  if (value.structValue?.fields) {
    return normalizeParameters(value.structValue.fields);
  }
  if (value.listValue?.values) {
    return value.listValue.values.map((item) => normalizeParameterValue(item));
  }

  return value;
}

function normalizeParameters(fields) {
  if (!fields || typeof fields !== "object") {
    return {};
  }

  return Object.entries(fields).reduce((accumulator, [key, value]) => {
    accumulator[key] = normalizeParameterValue(value);
    return accumulator;
  }, {});
}

function normalizeFulfillmentMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => {
      if (Array.isArray(message?.text?.text)) {
        return {
          type: "text",
          text: message.text.text.filter(Boolean),
        };
      }

      if (message?.payload) {
        const normalizedPayload = normalizeParameterValue(message.payload);
        return {
          type: "payload",
          payload: normalizedPayload && typeof normalizedPayload === "object" ? normalizedPayload : {},
        };
      }

      return null;
    })
    .filter(Boolean);
}

export function validateDialogflowMessagePayload(payload) {
  const text = sanitizeText(payload?.text);
  const sessionId = normalizeSessionId(payload?.sessionId);
  const preferredLocale = normalizeLocale(payload?.preferredLocale);
  const command = normalizeChatCommand(payload?.command);
  const contextEntry = normalizeContextEntry(payload?.contextEntry);

  if (!text && command === "none") {
    return {
      ok: false,
      error: "El mensaje no puede estar vacio.",
    };
  }

  return {
    ok: true,
    value: {
      text,
      sessionId,
      preferredLocale,
      command,
      contextEntry,
    },
  };
}

export function isDialogflowConfigured() {
  return getDialogflowConfig().isConfigured;
}

export async function detectDialogflowIntent({ text, sessionId, languageCode }) {
  const config = getDialogflowConfig();
  if (!config.isConfigured) {
    throw new Error("Dialogflow is not configured.");
  }

  const effectiveLanguageCode = normalizeLocale(languageCode) || config.languageCode;

  const client = new SessionsClient({
    credentials: {
      client_email: config.clientEmail,
      private_key: config.privateKey,
    },
  });
  const sessionPath = client.projectAgentSessionPath
    ? client.projectAgentSessionPath(config.projectId, sessionId)
    : client.sessionPath(config.projectId, sessionId);

  const request = {
    session: sessionPath,
    queryInput: {
      text: {
        text,
        languageCode: effectiveLanguageCode,
      },
    },
  };

  const [result] = await client.detectIntent(request);
  const queryResult = result?.queryResult ?? {};

  return {
    sessionId,
    languageCode: effectiveLanguageCode,
    replyText: readFirstReplyText(queryResult),
    intent: queryResult.intent?.displayName || null,
    confidence:
      typeof queryResult.intentDetectionConfidence === "number"
        ? queryResult.intentDetectionConfidence
        : null,
    fulfillmentMessages: normalizeFulfillmentMessages(queryResult.fulfillmentMessages),
    action: queryResult.action || null,
    parameters: normalizeParameters(queryResult.parameters?.fields),
  };
}

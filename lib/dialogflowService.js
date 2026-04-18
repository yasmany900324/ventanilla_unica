import { randomUUID } from "crypto";
import { SessionsClient } from "@google-cloud/dialogflow";

const DEFAULT_LANGUAGE_CODE = "es";
const MAX_MESSAGE_LENGTH = 500;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;

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
  const languageCode =
    process.env.DIALOGFLOW_LANGUAGE_CODE?.trim() || DEFAULT_LANGUAGE_CODE;

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

  if (!text) {
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
    },
  };
}

export function isDialogflowConfigured() {
  return getDialogflowConfig().isConfigured;
}

export async function detectDialogflowIntent({ text, sessionId }) {
  const config = getDialogflowConfig();
  if (!config.isConfigured) {
    throw new Error("Dialogflow is not configured.");
  }

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
        languageCode: config.languageCode,
      },
    },
  };

  const [result] = await client.detectIntent(request);
  const queryResult = result?.queryResult ?? {};

  return {
    sessionId,
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

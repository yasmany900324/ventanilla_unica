import { ensureDatabase, hasDatabase } from "./db";

const EVENT_MAX_LENGTH = 80;
const VALUE_MAX_LENGTH = 220;
const DETAIL_MAX_LENGTH = 500;
const STEP_MAX_LENGTH = 80;
let schemaReadyPromise = null;
const eventBuffer = [];
const BUFFER_LIMIT = 500;

export const CHATBOT_TELEMETRY_EVENTS = {
  TURN_RECEIVED: "turn_received",
  FLOW_ACTIVATED: "flow_activated",
  ENTITIES_ACCEPTED: "entities_accepted",
  ENTITIES_REJECTED: "entities_rejected",
  LOW_CONFIDENCE_REPROMPT: "low_confidence_reprompt",
  LLM_FALLBACK_USED: "llm_fallback_used",
  INTENT_DETECTED: "intent_detected",
  MODE_RESOLVED: "mode_resolved",
  ASK_FIELD: "ask_field",
  CONFIRMATION_READY: "confirmation_ready",
  CONFIRMATION_RESUMED: "confirmation_resumed",
  EDIT_REQUESTED: "edit_requested",
  CANCELLED: "cancelled",
  AUTH_REQUIRED: "auth_required",
  INCIDENT_CREATED: "incident_created",
  FALLBACK_CLARIFICATION: "fallback_clarification",
  REDIRECT_OFFERED: "redirect_offered",
  SERVICE_ERROR: "service_error",
};

export const CHATBOT_FUNNEL_STEPS = {
  ENTERED_INCIDENT_FLOW: "entered_incident_flow",
  ASKED_FIELD: "asked_field",
  READY_FOR_CONFIRMATION: "ready_for_confirmation",
  AUTH_REQUIRED: "auth_required",
  CONFIRMED: "confirmed",
  INCIDENT_CREATED: "incident_created",
  CANCELLED: "cancelled",
};

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") {
    return "";
  }

  return sessionId.trim().slice(0, VALUE_MAX_LENGTH);
}

function normalizeUserId(userId) {
  if (typeof userId !== "string") {
    return null;
  }

  const normalized = userId.trim().slice(0, VALUE_MAX_LENGTH);
  return normalized || null;
}

function normalizeSimpleText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeNullableText(value, maxLength) {
  const normalized = normalizeSimpleText(value, maxLength);
  return normalized || null;
}

function normalizeLocale(locale) {
  const normalized = normalizeSimpleText(locale, 10).toLowerCase();
  return normalized || null;
}

function normalizeNumber(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return value;
}

function normalizeBoolean(value) {
  return value === true;
}

async function ensureTelemetrySchema() {
  if (!hasDatabase()) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const sql = ensureDatabase();
      await sql`
        CREATE TABLE IF NOT EXISTS chatbot_telemetry_events (
          id BIGSERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          user_id TEXT,
          event_name TEXT NOT NULL,
          funnel_step TEXT,
          locale TEXT,
          mode TEXT,
          command TEXT,
          intent TEXT,
          action TEXT,
          field_name TEXT,
          outcome TEXT,
          confidence DOUBLE PRECISION,
          turn_index INTEGER,
          has_redirect BOOLEAN NOT NULL DEFAULT FALSE,
          has_auth BOOLEAN NOT NULL DEFAULT FALSE,
          details TEXT,
          incident_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chatbot_telemetry_events_created_at_idx
        ON chatbot_telemetry_events (created_at DESC);
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chatbot_telemetry_events_event_name_idx
        ON chatbot_telemetry_events (event_name, created_at DESC);
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chatbot_telemetry_events_session_id_idx
        ON chatbot_telemetry_events (session_id, created_at DESC);
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS chatbot_telemetry_events_funnel_step_idx
        ON chatbot_telemetry_events (funnel_step, created_at DESC);
      `;
      return true;
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
  return true;
}

function normalizeEventPayload(payload) {
  return {
    sessionId: normalizeSessionId(payload?.sessionId),
    userId: normalizeUserId(payload?.userId),
    eventName: normalizeSimpleText(payload?.eventName, EVENT_MAX_LENGTH),
    funnelStep: normalizeNullableText(payload?.funnelStep, STEP_MAX_LENGTH),
    locale: normalizeLocale(payload?.locale),
    mode: normalizeNullableText(payload?.mode, VALUE_MAX_LENGTH),
    command: normalizeNullableText(payload?.command, VALUE_MAX_LENGTH),
    intent: normalizeNullableText(payload?.intent, VALUE_MAX_LENGTH),
    action: normalizeNullableText(payload?.action, VALUE_MAX_LENGTH),
    fieldName: normalizeNullableText(payload?.fieldName, VALUE_MAX_LENGTH),
    outcome: normalizeNullableText(payload?.outcome, VALUE_MAX_LENGTH),
    confidence: normalizeNumber(payload?.confidence),
    turnIndex:
      Number.isInteger(payload?.turnIndex) && payload.turnIndex >= 0
        ? payload.turnIndex
        : null,
    hasRedirect: normalizeBoolean(payload?.hasRedirect),
    hasAuth: normalizeBoolean(payload?.hasAuth),
    details: normalizeNullableText(payload?.details, DETAIL_MAX_LENGTH),
    incidentId: normalizeNullableText(payload?.incidentId, VALUE_MAX_LENGTH),
  };
}

function writeToBuffer(eventPayload) {
  eventBuffer.push({
    ...eventPayload,
    createdAt: new Date().toISOString(),
  });
  if (eventBuffer.length > BUFFER_LIMIT) {
    eventBuffer.shift();
  }
}

export async function trackChatbotEvent(payload) {
  const normalizedEvent = normalizeEventPayload(payload);
  if (!normalizedEvent.sessionId || !normalizedEvent.eventName) {
    return false;
  }

  writeToBuffer(normalizedEvent);
  if (!hasDatabase()) {
    return true;
  }

  try {
    await ensureTelemetrySchema();
    const sql = ensureDatabase();
    await sql`
      INSERT INTO chatbot_telemetry_events (
        session_id,
        user_id,
        event_name,
        funnel_step,
        locale,
        mode,
        command,
        intent,
        action,
        field_name,
        outcome,
        confidence,
        turn_index,
        has_redirect,
        has_auth,
        details,
        incident_id
      )
      VALUES (
        ${normalizedEvent.sessionId},
        ${normalizedEvent.userId},
        ${normalizedEvent.eventName},
        ${normalizedEvent.funnelStep},
        ${normalizedEvent.locale},
        ${normalizedEvent.mode},
        ${normalizedEvent.command},
        ${normalizedEvent.intent},
        ${normalizedEvent.action},
        ${normalizedEvent.fieldName},
        ${normalizedEvent.outcome},
        ${normalizedEvent.confidence},
        ${normalizedEvent.turnIndex},
        ${normalizedEvent.hasRedirect},
        ${normalizedEvent.hasAuth},
        ${normalizedEvent.details},
        ${normalizedEvent.incidentId}
      );
    `;
  } catch (error) {
    console.warn("[chatbot] No se pudo persistir evento de telemetria.", {
      eventName: normalizedEvent.eventName,
      sessionId: normalizedEvent.sessionId,
      message: error?.message,
    });
  }

  return true;
}

export async function getChatbotFunnelMetrics({ windowDays = 7 } = {}) {
  const normalizedWindowDays =
    Number.isInteger(windowDays) && windowDays > 0 ? Math.min(windowDays, 90) : 7;
  const startDate = new Date(Date.now() - normalizedWindowDays * 24 * 60 * 60 * 1000);
  const sinceIso = startDate.toISOString();

  if (!hasDatabase()) {
    const eventsInWindow = eventBuffer.filter(
      (event) => event.createdAt && event.createdAt >= sinceIso
    );
    return buildFunnelSummary(eventsInWindow);
  }

  await ensureTelemetrySchema();
  const sql = ensureDatabase();
  const rows = await sql`
    SELECT
      session_id,
      event_name,
      funnel_step,
      mode,
      created_at
    FROM chatbot_telemetry_events
    WHERE created_at >= ${sinceIso}
    ORDER BY created_at DESC;
  `;

  const normalizedRows = rows.map((row) => ({
    sessionId: row.session_id,
    eventName: row.event_name,
    funnelStep: row.funnel_step,
    mode: row.mode,
    createdAt: row.created_at,
  }));
  return buildFunnelSummary(normalizedRows);
}

function buildFunnelSummary(events) {
  const sessionsByStep = {
    enteredIncidentFlow: new Set(),
    askedField: new Set(),
    readyForConfirmation: new Set(),
    authRequired: new Set(),
    confirmed: new Set(),
    incidentCreated: new Set(),
    cancelled: new Set(),
  };
  const eventCounts = {};

  events.forEach((event) => {
    const eventName = normalizeSimpleText(event?.eventName, EVENT_MAX_LENGTH);
    if (eventName) {
      eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;
    }

    const step = normalizeSimpleText(event?.funnelStep, STEP_MAX_LENGTH);
    const sessionId = normalizeSessionId(event?.sessionId);
    if (!sessionId || !step) {
      return;
    }

    if (step === CHATBOT_FUNNEL_STEPS.ENTERED_INCIDENT_FLOW) {
      sessionsByStep.enteredIncidentFlow.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.ASKED_FIELD) {
      sessionsByStep.askedField.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.READY_FOR_CONFIRMATION) {
      sessionsByStep.readyForConfirmation.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.AUTH_REQUIRED) {
      sessionsByStep.authRequired.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.CONFIRMED) {
      sessionsByStep.confirmed.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.INCIDENT_CREATED) {
      sessionsByStep.incidentCreated.add(sessionId);
    } else if (step === CHATBOT_FUNNEL_STEPS.CANCELLED) {
      sessionsByStep.cancelled.add(sessionId);
    }
  });

  const entered = sessionsByStep.enteredIncidentFlow.size;
  const created = sessionsByStep.incidentCreated.size;
  const conversionRate = entered > 0 ? Number((created / entered).toFixed(4)) : 0;

  return {
    totals: {
      events: events.length,
      uniqueSessions: new Set(
        events.map((event) => normalizeSessionId(event?.sessionId)).filter(Boolean)
      ).size,
    },
    funnel: {
      enteredIncidentFlow: entered,
      askedField: sessionsByStep.askedField.size,
      readyForConfirmation: sessionsByStep.readyForConfirmation.size,
      authRequired: sessionsByStep.authRequired.size,
      confirmed: sessionsByStep.confirmed.size,
      incidentCreated: created,
      cancelled: sessionsByStep.cancelled.size,
      incidentCreationConversion: conversionRate,
    },
    eventCounts,
  };
}

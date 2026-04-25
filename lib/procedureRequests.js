import { randomUUID } from "crypto";
import { ensureAuthSchema } from "./auth";
import { ensureDatabase } from "./db";

export const PROCEDURE_REQUEST_STATUSES = {
  DRAFT: "DRAFT",
  PENDING_CONFIRMATION: "PENDING_CONFIRMATION",
  PENDING_CAMUNDA_SYNC: "PENDING_CAMUNDA_SYNC",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING_BACKOFFICE_ACTION: "PENDING_BACKOFFICE_ACTION",
  WAITING_CITIZEN_INFO: "WAITING_CITIZEN_INFO",
  ERROR_CAMUNDA_SYNC: "ERROR_CAMUNDA_SYNC",
  RESOLVED: "RESOLVED",
  REJECTED: "REJECTED",
  CLOSED: "CLOSED",
  ARCHIVED: "ARCHIVED",
};

export const PROCEDURE_REQUEST_EVENT_TYPES = {
  PROCEDURE_CREATED: "PROCEDURE_CREATED",
  CAMUNDA_SYNC_STARTED: "CAMUNDA_SYNC_STARTED",
  CAMUNDA_SYNC_FAILED: "CAMUNDA_SYNC_FAILED",
  CAMUNDA_INSTANCE_CREATED: "CAMUNDA_INSTANCE_CREATED",
  BACKOFFICE_TASK_COMPLETED: "BACKOFFICE_TASK_COMPLETED",
  STATUS_CHANGED: "STATUS_CHANGED",
  PROCEDURE_CLOSED: "PROCEDURE_CLOSED",
};

const DEFAULT_STATUS = PROCEDURE_REQUEST_STATUSES.DRAFT;
const ALLOWED_STATUSES = new Set(Object.values(PROCEDURE_REQUEST_STATUSES));
const ALLOWED_EVENT_TYPES = new Set(Object.values(PROCEDURE_REQUEST_EVENT_TYPES));
const ALLOWED_CHANNELS = new Set(["WEB", "WHATSAPP"]);
const DEFAULT_MAX_SYNC_RETRIES = 3;
const DEFAULT_CLAIM_TTL_MINUTES = 15;
const DEFAULT_SLA_HOURS = 72;
const DEFAULT_WAITING_CITIZEN_INFO_TIMEOUT_HOURS = 48;
const TERMINAL_STATUSES = new Set([
  PROCEDURE_REQUEST_STATUSES.RESOLVED,
  PROCEDURE_REQUEST_STATUSES.REJECTED,
  PROCEDURE_REQUEST_STATUSES.CLOSED,
  PROCEDURE_REQUEST_STATUSES.ARCHIVED,
]);

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function mapProcedureRequestRow(row) {
  let collectedData = {};
  if (row?.collected_data_json && typeof row.collected_data_json === "object") {
    collectedData = row.collected_data_json;
  } else if (typeof row?.collected_data_json === "string") {
    try {
      collectedData = JSON.parse(row.collected_data_json);
    } catch (_error) {
      collectedData = {};
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    whatsappWaId: row.whatsapp_wa_id || null,
    whatsappPhone: row.whatsapp_phone || row.whatsapp_wa_id || null,
    requestCode: row.request_code,
    procedureTypeId: row.procedure_type_id || null,
    procedureCode: row.procedure_code,
    procedureName: row.procedure_name,
    procedureCategory: row.procedure_category,
    status: row.status,
    channel: row.channel || "WEB",
    camundaError: row.camunda_error_summary || null,
    camundaMetadata: row.camunda_metadata_json || {},
    summary: row.summary,
    collectedData,
    camundaProcessInstanceKey: row.camunda_process_instance_key || null,
    camundaProcessDefinitionId: row.camunda_process_definition_id || null,
    camundaProcessVersion: row.camunda_process_version || null,
    camundaTaskDefinitionKey:
      row.current_task_definition_key || row.camunda_task_definition_key || null,
    currentTaskDefinitionKey:
      row.current_task_definition_key || row.camunda_task_definition_key || null,
    taskAssigneeId: row.task_assignee_id || null,
    taskClaimedAt: row.task_claimed_at || null,
    taskClaimExpiresAt: row.task_claim_expires_at || null,
    syncRetryCount: Number.isInteger(row.sync_retry_count) ? row.sync_retry_count : 0,
    syncMaxRetryCount: Number.isInteger(row.sync_max_retry_count)
      ? row.sync_max_retry_count
      : DEFAULT_MAX_SYNC_RETRIES,
    syncLastRetryAt: row.sync_last_retry_at || null,
    syncNextRetryAt: row.sync_next_retry_at || null,
    autoSyncRetryEnabled: row.auto_sync_retry_enabled !== false,
    slaDeadline: row.sla_deadline || null,
    isEscalated: row.is_escalated === true,
    escalatedAt: row.escalated_at || null,
    waitingCitizenInfoStartedAt: row.waiting_citizen_info_started_at || null,
    waitingCitizenInfoDeadline: row.waiting_citizen_info_deadline || null,
    closedAt: row.closed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLookupIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function extractLookupTokens(identifier) {
  const normalized = normalizeLookupIdentifier(identifier);
  if (!normalized) {
    return {
      idToken: "",
      requestCodeToken: "",
      shortCodeToken: "",
    };
  }

  const withoutPrefix = normalized.replace(/^(TRA|PROC|SOL)[-:#]?/u, "");
  const cleanedShort = withoutPrefix.replace(/[^A-Z0-9]/gu, "");

  return {
    idToken: withoutPrefix.toLowerCase(),
    requestCodeToken: normalized.replace(/[:#]/gu, "-"),
    shortCodeToken: cleanedShort.slice(0, 8),
  };
}

export async function ensureProcedureRequestSchema() {
  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES citizens(id) ON DELETE CASCADE,
      channel TEXT NOT NULL DEFAULT 'WEB',
      whatsapp_phone TEXT,
      request_code TEXT NOT NULL UNIQUE,
      procedure_type_id TEXT REFERENCES chatbot_procedure_catalog(id) ON DELETE SET NULL,
      procedure_code TEXT NOT NULL,
      procedure_name TEXT NOT NULL,
      procedure_category TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      summary TEXT,
      collected_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      camunda_process_instance_key TEXT,
      camunda_process_definition_id TEXT,
      camunda_process_version INTEGER,
      camunda_task_definition_key TEXT,
      current_task_definition_key TEXT,
      camunda_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      camunda_error_summary TEXT,
      task_assignee_id TEXT REFERENCES citizens(id) ON DELETE SET NULL,
      task_claimed_at TIMESTAMPTZ,
      task_claim_expires_at TIMESTAMPTZ,
      sync_retry_count INTEGER NOT NULL DEFAULT 0,
      sync_max_retry_count INTEGER NOT NULL DEFAULT 3,
      sync_last_retry_at TIMESTAMPTZ,
      sync_next_retry_at TIMESTAMPTZ,
      auto_sync_retry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sla_deadline TIMESTAMPTZ,
      is_escalated BOOLEAN NOT NULL DEFAULT FALSE,
      escalated_at TIMESTAMPTZ,
      waiting_citizen_info_started_at TIMESTAMPTZ,
      waiting_citizen_info_deadline TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS procedure_type_id TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_process_instance_key TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_task_definition_key TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_process_definition_id TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_process_version INTEGER;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS procedure_category TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS status TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET status = 'DRAFT'
    WHERE status IS NULL OR status = '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN status SET DEFAULT 'DRAFT';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN status SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS summary TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS collected_data_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET collected_data_json = '{}'::jsonb
    WHERE collected_data_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN collected_data_json SET DEFAULT '{}'::jsonb;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN collected_data_json SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET updated_at = created_at
    WHERE updated_at IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN updated_at SET DEFAULT NOW();
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN updated_at SET NOT NULL;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_user_updated_idx
    ON chatbot_procedure_requests (user_id, updated_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_code_idx
    ON chatbot_procedure_requests (request_code);
  `;

  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS whatsapp_wa_id TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS channel TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET channel = CASE
      WHEN whatsapp_wa_id IS NOT NULL AND TRIM(whatsapp_wa_id) <> '' THEN 'WHATSAPP'
      ELSE 'WEB'
    END
    WHERE channel IS NULL OR TRIM(channel) = '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN channel SET DEFAULT 'WEB';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN channel SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET whatsapp_phone = COALESCE(NULLIF(TRIM(whatsapp_phone), ''), NULLIF(TRIM(whatsapp_wa_id), ''))
    WHERE whatsapp_phone IS NULL OR TRIM(whatsapp_phone) = '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS current_task_definition_key TEXT;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET current_task_definition_key = camunda_task_definition_key
    WHERE current_task_definition_key IS NULL
      AND camunda_task_definition_key IS NOT NULL
      AND TRIM(camunda_task_definition_key) <> '';
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_metadata_json JSONB;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET camunda_metadata_json = '{}'::jsonb
    WHERE camunda_metadata_json IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN camunda_metadata_json SET DEFAULT '{}'::jsonb;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN camunda_metadata_json SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS camunda_error_summary TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS task_assignee_id TEXT;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS task_claimed_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS task_claim_expires_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS sync_retry_count INTEGER;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET sync_retry_count = 0
    WHERE sync_retry_count IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN sync_retry_count SET DEFAULT 0;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN sync_retry_count SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS sync_max_retry_count INTEGER;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET sync_max_retry_count = ${DEFAULT_MAX_SYNC_RETRIES}
    WHERE sync_max_retry_count IS NULL OR sync_max_retry_count < 1;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN sync_max_retry_count SET DEFAULT ${DEFAULT_MAX_SYNC_RETRIES};
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN sync_max_retry_count SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS sync_last_retry_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS sync_next_retry_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS auto_sync_retry_enabled BOOLEAN;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET auto_sync_retry_enabled = TRUE
    WHERE auto_sync_retry_enabled IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN auto_sync_retry_enabled SET DEFAULT TRUE;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN auto_sync_retry_enabled SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET sla_deadline = COALESCE(created_at, NOW()) + (${DEFAULT_SLA_HOURS}::int * INTERVAL '1 hour')
    WHERE sla_deadline IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN;
  `;
  await sql`
    UPDATE chatbot_procedure_requests
    SET is_escalated = FALSE
    WHERE is_escalated IS NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN is_escalated SET DEFAULT FALSE;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN is_escalated SET NOT NULL;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS waiting_citizen_info_started_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS waiting_citizen_info_deadline TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE chatbot_procedure_requests
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
  `;

  await sql`
    ALTER TABLE chatbot_procedure_requests
    ALTER COLUMN user_id DROP NOT NULL;
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_whatsapp_updated_idx
    ON chatbot_procedure_requests (whatsapp_wa_id, updated_at DESC)
    WHERE whatsapp_wa_id IS NOT NULL;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_status_updated_idx
    ON chatbot_procedure_requests (status, updated_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_channel_status_updated_idx
    ON chatbot_procedure_requests (channel, status, updated_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_sync_retry_idx
    ON chatbot_procedure_requests (sync_next_retry_at ASC)
    WHERE auto_sync_retry_enabled = TRUE;
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_sla_deadline_idx
    ON chatbot_procedure_requests (sla_deadline ASC)
    WHERE status NOT IN ('CLOSED', 'RESOLVED', 'REJECTED', 'ARCHIVED');
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_request_events (
      id TEXT PRIMARY KEY,
      procedure_request_id TEXT NOT NULL REFERENCES chatbot_procedure_requests(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      previous_status TEXT,
      new_status TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_request_events_request_created_idx
    ON chatbot_procedure_request_events (procedure_request_id, created_at DESC);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_request_events_type_created_idx
    ON chatbot_procedure_request_events (type, created_at DESC);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_processed_operations (
      id TEXT PRIMARY KEY,
      procedure_request_id TEXT NOT NULL REFERENCES chatbot_procedure_requests(id) ON DELETE CASCADE,
      operation_type TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chatbot_procedure_processed_ops_unique_idx
    ON chatbot_procedure_processed_operations (procedure_request_id, operation_type, operation_key);
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chatbot_procedure_processed_ops_created_idx
    ON chatbot_procedure_processed_operations (created_at DESC);
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chatbot_procedure_metrics_daily (
      metric_date DATE NOT NULL,
      metric_key TEXT NOT NULL,
      value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, metric_key)
    );
  `;
}

export async function createProcedureRequest({
  userId = null,
  whatsappWaId = null,
  channel = "WEB",
  procedureTypeId = null,
  procedureCode,
  procedureName,
  procedureCategory = "",
  summary = "",
  collectedData = {},
  status = PROCEDURE_REQUEST_STATUSES.PENDING_CAMUNDA_SYNC,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const id = randomUUID();
  const requestCode = `TRA-${id.slice(0, 8).toUpperCase()}`;

  const waDigits =
    typeof whatsappWaId === "string" ? whatsappWaId.replace(/\D/g, "").slice(0, 32) || null : null;
  const normalizedChannel = normalizeText(channel, 20).toUpperCase();
  if (!ALLOWED_CHANNELS.has(normalizedChannel)) {
    throw new Error("createProcedureRequest: channel inválido. Use WEB o WHATSAPP.");
  }
  const hasPortalUser = typeof userId === "string" && userId.trim();
  if (!hasPortalUser && !waDigits) {
    throw new Error("createProcedureRequest: se requiere userId (portal) o whatsappWaId (WhatsApp).");
  }
  if (hasPortalUser && waDigits) {
    throw new Error(
      "createProcedureRequest: no mezclar userId de portal con whatsappWaId en el mismo registro."
    );
  }

  const [row] = await sql`
    INSERT INTO chatbot_procedure_requests (
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      updated_at
    )
    VALUES (
      ${id},
      ${hasPortalUser ? userId.trim() : null},
      ${normalizedChannel},
      ${waDigits},
      ${waDigits},
      ${requestCode},
      ${normalizeText(procedureTypeId, 80) || null},
      ${normalizeText(procedureCode, 120).toLowerCase()},
      ${normalizeText(procedureName, 160)},
      ${normalizeText(procedureCategory, 80)},
      ${normalizeProcedureStatus(status || DEFAULT_STATUS)},
      ${normalizeText(summary, 500)},
      ${collectedData && typeof collectedData === "object" ? collectedData : {}},
      ${null},
      ${null},
      ${null},
      ${null},
      ${null},
      ${{}},
      ${null},
      ${null},
      ${null},
      ${null},
      ${0},
      ${DEFAULT_MAX_SYNC_RETRIES},
      ${null},
      ${null},
      ${true},
      ${new Date(Date.now() + DEFAULT_SLA_HOURS * 60 * 60 * 1000)},
      ${false},
      ${null},
      ${null},
      ${null},
      ${null},
      NOW()
    )
    RETURNING
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at;
  `;
  const created = mapProcedureRequestRow(row);
  await addProcedureRequestEvent({
    procedureRequestId: created.id,
    type: PROCEDURE_REQUEST_EVENT_TYPES.PROCEDURE_CREATED,
    previousStatus: null,
    newStatus: created.status,
    metadata: {
      channel: created.channel,
      procedureTypeId: created.procedureTypeId,
      procedureCode: created.procedureCode,
    },
    actorId: hasPortalUser ? userId.trim() : null,
  });
  return created;
}

export async function updateProcedureRequestCamundaData({
  procedureRequestId,
  camundaProcessInstanceKey = undefined,
  camundaProcessDefinitionId = undefined,
  camundaProcessVersion = undefined,
  camundaTaskDefinitionKey = undefined,
  taskAssigneeId = undefined,
  taskClaimedAt = undefined,
  taskClaimExpiresAt = undefined,
  syncRetryCount = undefined,
  syncMaxRetryCount = undefined,
  syncLastRetryAt = undefined,
  syncNextRetryAt = undefined,
  autoSyncRetryEnabled = undefined,
  slaDeadline = undefined,
  isEscalated = undefined,
  escalatedAt = undefined,
  waitingCitizenInfoStartedAt = undefined,
  waitingCitizenInfoDeadline = undefined,
  camundaMetadata = null,
  camundaError = null,
  clearCamundaError = false,
  status = null,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedId = normalizeText(procedureRequestId, 80);
  if (!normalizedId) {
    return null;
  }
  const [row] = await sql`
    UPDATE chatbot_procedure_requests
    SET
      camunda_process_instance_key = CASE
        WHEN ${camundaProcessInstanceKey === undefined} THEN camunda_process_instance_key
        ELSE ${normalizeText(camundaProcessInstanceKey, 120) || null}
      END,
      camunda_task_definition_key = CASE
        WHEN ${camundaTaskDefinitionKey === undefined} THEN camunda_task_definition_key
        ELSE ${normalizeText(camundaTaskDefinitionKey, 160) || null}
      END,
      camunda_process_definition_id = CASE
        WHEN ${camundaProcessDefinitionId === undefined} THEN camunda_process_definition_id
        ELSE ${normalizeText(camundaProcessDefinitionId, 180) || null}
      END,
      camunda_process_version = CASE
        WHEN ${camundaProcessVersion === undefined} THEN camunda_process_version
        WHEN ${Number.isInteger(camundaProcessVersion) && camundaProcessVersion > 0}
          THEN ${camundaProcessVersion}
        ELSE NULL
      END,
      current_task_definition_key = CASE
        WHEN ${camundaTaskDefinitionKey === undefined} THEN current_task_definition_key
        ELSE ${normalizeText(camundaTaskDefinitionKey, 160) || null}
      END,
      task_assignee_id = CASE
        WHEN ${taskAssigneeId === undefined} THEN task_assignee_id
        ELSE ${normalizeText(taskAssigneeId, 80) || null}
      END,
      task_claimed_at = CASE
        WHEN ${taskClaimedAt === undefined} THEN task_claimed_at
        WHEN ${taskClaimedAt === null} THEN NULL
        ELSE ${taskClaimedAt}
      END,
      task_claim_expires_at = CASE
        WHEN ${taskClaimExpiresAt === undefined} THEN task_claim_expires_at
        WHEN ${taskClaimExpiresAt === null} THEN NULL
        ELSE ${taskClaimExpiresAt}
      END,
      sync_retry_count = CASE
        WHEN ${syncRetryCount === undefined} THEN sync_retry_count
        WHEN ${Number.isInteger(syncRetryCount) && syncRetryCount >= 0} THEN ${syncRetryCount}
        ELSE sync_retry_count
      END,
      sync_max_retry_count = CASE
        WHEN ${syncMaxRetryCount === undefined} THEN sync_max_retry_count
        WHEN ${Number.isInteger(syncMaxRetryCount) && syncMaxRetryCount > 0} THEN ${syncMaxRetryCount}
        ELSE sync_max_retry_count
      END,
      sync_last_retry_at = CASE
        WHEN ${syncLastRetryAt === undefined} THEN sync_last_retry_at
        WHEN ${syncLastRetryAt === null} THEN NULL
        ELSE ${syncLastRetryAt}
      END,
      sync_next_retry_at = CASE
        WHEN ${syncNextRetryAt === undefined} THEN sync_next_retry_at
        WHEN ${syncNextRetryAt === null} THEN NULL
        ELSE ${syncNextRetryAt}
      END,
      auto_sync_retry_enabled = CASE
        WHEN ${autoSyncRetryEnabled === undefined} THEN auto_sync_retry_enabled
        ELSE ${autoSyncRetryEnabled === true}
      END,
      sla_deadline = CASE
        WHEN ${slaDeadline === undefined} THEN sla_deadline
        WHEN ${slaDeadline === null} THEN NULL
        ELSE ${slaDeadline}
      END,
      is_escalated = CASE
        WHEN ${isEscalated === undefined} THEN is_escalated
        ELSE ${isEscalated === true}
      END,
      escalated_at = CASE
        WHEN ${escalatedAt === undefined} THEN escalated_at
        WHEN ${escalatedAt === null} THEN NULL
        ELSE ${escalatedAt}
      END,
      waiting_citizen_info_started_at = CASE
        WHEN ${waitingCitizenInfoStartedAt === undefined} THEN waiting_citizen_info_started_at
        WHEN ${waitingCitizenInfoStartedAt === null} THEN NULL
        ELSE ${waitingCitizenInfoStartedAt}
      END,
      waiting_citizen_info_deadline = CASE
        WHEN ${waitingCitizenInfoDeadline === undefined} THEN waiting_citizen_info_deadline
        WHEN ${waitingCitizenInfoDeadline === null} THEN NULL
        ELSE ${waitingCitizenInfoDeadline}
      END,
      camunda_metadata_json = CASE
        WHEN ${camundaMetadata && typeof camundaMetadata === "object" ? camundaMetadata : null}::jsonb IS NULL
          THEN camunda_metadata_json
        ELSE ${camundaMetadata && typeof camundaMetadata === "object" ? camundaMetadata : null}::jsonb
      END,
      camunda_error_summary = CASE
        WHEN ${clearCamundaError} = TRUE THEN NULL
        WHEN ${normalizeText(camundaError, 500) || null} IS NOT NULL THEN ${normalizeText(camundaError, 500) || null}
        ELSE camunda_error_summary
      END,
      status = COALESCE(${normalizeProcedureStatus(status)}, status),
      closed_at = CASE
        WHEN COALESCE(${normalizeProcedureStatus(status)}, status) IN ('CLOSED', 'RESOLVED')
          THEN COALESCE(closed_at, NOW())
        ELSE closed_at
      END,
      updated_at = NOW()
    WHERE id = ${normalizedId}
    RETURNING
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at;
  `;
  return row ? mapProcedureRequestRow(row) : null;
}

export async function getProcedureRequestById(procedureRequestId) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedId = normalizeText(procedureRequestId, 80);
  if (!normalizedId) {
    return null;
  }
  const [row] = await sql`
    SELECT
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at
    FROM chatbot_procedure_requests
    WHERE id = ${normalizedId}
    LIMIT 1;
  `;
  return row ? mapProcedureRequestRow(row) : null;
}

export async function findProcedureRequestByIdentifier({ userId, whatsappWaId, identifier }) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const { idToken, requestCodeToken, shortCodeToken } = extractLookupTokens(identifier);
  if (!idToken && !requestCodeToken && !shortCodeToken) {
    return null;
  }

  const waDigits =
    typeof whatsappWaId === "string" ? whatsappWaId.replace(/\D/g, "").slice(0, 32) || null : null;
  const hasPortalUser = typeof userId === "string" && userId.trim();
  if (!hasPortalUser && !waDigits) {
    return null;
  }

  if (requestCodeToken) {
    const [byCode] =
      waDigits && !hasPortalUser
        ? await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE whatsapp_wa_id = ${waDigits}
              AND UPPER(request_code) = ${requestCodeToken}
            LIMIT 1;
          `
        : await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE user_id = ${userId.trim()}
              AND UPPER(request_code) = ${requestCodeToken}
            LIMIT 1;
          `;
    if (byCode) {
      return mapProcedureRequestRow(byCode);
    }
  }

  if (idToken) {
    const [byId] =
      waDigits && !hasPortalUser
        ? await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE whatsapp_wa_id = ${waDigits}
              AND id = ${idToken}
            LIMIT 1;
          `
        : await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE user_id = ${userId.trim()}
              AND id = ${idToken}
            LIMIT 1;
          `;
    if (byId) {
      return mapProcedureRequestRow(byId);
    }
  }

  if (shortCodeToken) {
    const [byShort] =
      waDigits && !hasPortalUser
        ? await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE whatsapp_wa_id = ${waDigits}
              AND UPPER(REPLACE(request_code, '-', '')) LIKE ('%' || ${shortCodeToken}::text || '%')
            ORDER BY updated_at DESC
            LIMIT 1;
          `
        : await sql`
            SELECT
              id,
              user_id,
              channel,
              whatsapp_phone,
              whatsapp_wa_id,
              request_code,
              procedure_type_id,
              procedure_code,
              procedure_name,
              procedure_category,
              status,
              summary,
              collected_data_json,
              camunda_process_instance_key,
              camunda_process_definition_id,
              camunda_process_version,
              camunda_task_definition_key,
              current_task_definition_key,
              camunda_metadata_json,
              camunda_error_summary,
              task_assignee_id,
              task_claimed_at,
              task_claim_expires_at,
              sync_retry_count,
              sync_max_retry_count,
              sync_last_retry_at,
              sync_next_retry_at,
              auto_sync_retry_enabled,
              sla_deadline,
              is_escalated,
              escalated_at,
              waiting_citizen_info_started_at,
              waiting_citizen_info_deadline,
              closed_at,
              created_at,
              updated_at
            FROM chatbot_procedure_requests
            WHERE user_id = ${userId.trim()}
              AND UPPER(REPLACE(request_code, '-', '')) LIKE ('%' || ${shortCodeToken}::text || '%')
            ORDER BY updated_at DESC
            LIMIT 1;
          `;
    if (byShort) {
      return mapProcedureRequestRow(byShort);
    }
  }

  return null;
}

export function normalizeProcedureStatus(value) {
  const normalized = normalizeText(value, 80).toUpperCase();
  return ALLOWED_STATUSES.has(normalized) ? normalized : null;
}

export function canTransitionProcedureStatus(previousStatus, nextStatus) {
  const prev = normalizeProcedureStatus(previousStatus);
  const next = normalizeProcedureStatus(nextStatus);
  if (!next) {
    return false;
  }
  if (!prev || prev === next) {
    return true;
  }
  if (prev === PROCEDURE_REQUEST_STATUSES.CLOSED && next === PROCEDURE_REQUEST_STATUSES.ARCHIVED) {
    return true;
  }
  if (TERMINAL_STATUSES.has(prev) && prev !== next) {
    return false;
  }
  if (
    prev === PROCEDURE_REQUEST_STATUSES.PENDING_BACKOFFICE_ACTION &&
    next === PROCEDURE_REQUEST_STATUSES.PENDING_CAMUNDA_SYNC
  ) {
    return false;
  }
  return true;
}

export async function addProcedureRequestEvent({
  procedureRequestId,
  type,
  previousStatus = null,
  newStatus = null,
  metadata = {},
  actorId = null,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedRequestId = normalizeText(procedureRequestId, 80);
  const normalizedType = normalizeText(type, 80);
  if (!normalizedRequestId || !ALLOWED_EVENT_TYPES.has(normalizedType)) {
    return null;
  }
  const [row] = await sql`
    INSERT INTO chatbot_procedure_request_events (
      id,
      procedure_request_id,
      type,
      previous_status,
      new_status,
      metadata_json,
      actor_id
    )
    VALUES (
      ${randomUUID()},
      ${normalizedRequestId},
      ${normalizedType},
      ${normalizeProcedureStatus(previousStatus)},
      ${normalizeProcedureStatus(newStatus)},
      ${metadata && typeof metadata === "object" ? metadata : {}},
      ${normalizeText(actorId, 80) || null}
    )
    RETURNING
      id,
      procedure_request_id,
      type,
      previous_status,
      new_status,
      metadata_json,
      actor_id,
      created_at;
  `;
  return row
    ? {
        id: row.id,
        procedureRequestId: row.procedure_request_id,
        type: row.type,
        previousStatus: row.previous_status || null,
        newStatus: row.new_status || null,
        metadata: row.metadata_json || {},
        actorId: row.actor_id || null,
        createdAt: row.created_at || null,
      }
    : null;
}

export async function transitionProcedureRequestStatus({
  procedureRequestId,
  newStatus,
  actorId = null,
  metadata = {},
  eventType = PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
}) {
  const normalizedId = normalizeText(procedureRequestId, 80);
  const normalizedStatus = normalizeProcedureStatus(newStatus);
  if (!normalizedId || !normalizedStatus) {
    return null;
  }
  const current = await getProcedureRequestById(normalizedId);
  if (!current) {
    return null;
  }
  if (!canTransitionProcedureStatus(current.status, normalizedStatus)) {
    await addProcedureRequestEvent({
      procedureRequestId: normalizedId,
      type: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
      previousStatus: current.status,
      newStatus: current.status,
      metadata: {
        discardedTransition: true,
        attemptedStatus: normalizedStatus,
        reason: "out_of_order_or_regressive_transition",
        ...(metadata && typeof metadata === "object" ? metadata : {}),
      },
      actorId: actorId || "system",
    });
    return current;
  }
  const waitingInfoStart =
    normalizedStatus === PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO
      ? new Date()
      : current.waitingCitizenInfoStartedAt
        ? undefined
        : null;
  const waitingInfoDeadline =
    normalizedStatus === PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO
      ? new Date(Date.now() + DEFAULT_WAITING_CITIZEN_INFO_TIMEOUT_HOURS * 60 * 60 * 1000)
      : null;
  const updated = await updateProcedureRequestCamundaData({
    procedureRequestId: normalizedId,
    status: normalizedStatus,
    waitingCitizenInfoStartedAt:
      normalizedStatus === PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO
        ? waitingInfoStart
        : null,
    waitingCitizenInfoDeadline:
      normalizedStatus === PROCEDURE_REQUEST_STATUSES.WAITING_CITIZEN_INFO
        ? waitingInfoDeadline
        : null,
  });
  if (!updated) {
    return null;
  }
  await addProcedureRequestEvent({
    procedureRequestId: normalizedId,
    type: ALLOWED_EVENT_TYPES.has(eventType) ? eventType : PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
    previousStatus: current.status,
    newStatus: updated.status,
    metadata,
    actorId: actorId || "system",
  });
  return updated;
}

export async function listProcedureRequestEvents(procedureRequestId, { limit = 100 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedId = normalizeText(procedureRequestId, 80);
  if (!normalizedId) {
    return [];
  }
  const rows = await sql`
    SELECT
      id,
      procedure_request_id,
      type,
      previous_status,
      new_status,
      metadata_json,
      actor_id,
      created_at
    FROM chatbot_procedure_request_events
    WHERE procedure_request_id = ${normalizedId}
    ORDER BY created_at DESC
    LIMIT ${Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100};
  `;
  return rows.map((row) => ({
    id: row.id,
    procedureRequestId: row.procedure_request_id,
    type: row.type,
    previousStatus: row.previous_status || null,
    newStatus: row.new_status || null,
    metadata: row.metadata_json || {},
    actorId: row.actor_id || null,
    createdAt: row.created_at || null,
  }));
}

export async function listProcedureRequestsForAdmin({ limit = 100 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    SELECT
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at
    FROM chatbot_procedure_requests
    ORDER BY created_at DESC
    LIMIT ${Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100};
  `;
  return rows.map((row) => mapProcedureRequestRow(row));
}

export async function claimProcedureTask({
  procedureRequestId,
  actorId,
  expectedTaskDefinitionKey = null,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedId = normalizeText(procedureRequestId, 80);
  const normalizedActor = normalizeText(actorId, 80);
  const expectedKey = normalizeText(expectedTaskDefinitionKey, 160) || null;
  if (!normalizedId || !normalizedActor) {
    return { ok: false, reason: "invalid_input" };
  }
  const [row] = await sql`
    UPDATE chatbot_procedure_requests
    SET
      task_assignee_id = ${normalizedActor},
      task_claimed_at = NOW(),
      task_claim_expires_at = NOW() + (${DEFAULT_CLAIM_TTL_MINUTES}::int * INTERVAL '1 minute'),
      updated_at = NOW()
    WHERE id = ${normalizedId}
      AND (
        task_assignee_id IS NULL
        OR task_assignee_id = ${normalizedActor}
        OR task_claim_expires_at <= NOW()
      )
      AND (
        ${expectedKey}::text IS NULL
        OR current_task_definition_key = ${expectedKey}
      )
    RETURNING
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at;
  `;
  if (!row) {
    return { ok: false, reason: "already_claimed_or_task_changed" };
  }
  return { ok: true, procedureRequest: mapProcedureRequestRow(row) };
}

export async function releaseProcedureTaskClaim(procedureRequestId) {
  return updateProcedureRequestCamundaData({
    procedureRequestId,
    taskAssigneeId: null,
    taskClaimedAt: null,
    taskClaimExpiresAt: null,
  });
}

export async function releaseExpiredProcedureTaskClaims({ limit = 200 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    UPDATE chatbot_procedure_requests
    SET
      task_assignee_id = NULL,
      task_claimed_at = NULL,
      task_claim_expires_at = NULL,
      updated_at = NOW()
    WHERE task_assignee_id IS NOT NULL
      AND task_claim_expires_at IS NOT NULL
      AND task_claim_expires_at <= NOW()
    RETURNING id;
  `;
  return rows.slice(0, Number.isInteger(limit) && limit > 0 ? limit : 200).map((row) => row.id);
}

export async function listProcedureRequestsPendingAutoRetry({ limit = 50 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    SELECT
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at
    FROM chatbot_procedure_requests
    WHERE auto_sync_retry_enabled = TRUE
      AND status = 'ERROR_CAMUNDA_SYNC'
      AND camunda_process_instance_key IS NULL
      AND sync_retry_count < sync_max_retry_count
      AND (sync_next_retry_at IS NULL OR sync_next_retry_at <= NOW())
    ORDER BY created_at ASC
    LIMIT ${Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50};
  `;
  return rows.map((row) => mapProcedureRequestRow(row));
}

export async function listProcedureRequestsForCamundaReconciliation({ limit = 100 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    SELECT
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at
    FROM chatbot_procedure_requests
    WHERE camunda_process_instance_key IS NOT NULL
      AND status IN (
        'IN_PROGRESS',
        'PENDING_BACKOFFICE_ACTION',
        'WAITING_CITIZEN_INFO'
      )
    ORDER BY updated_at ASC
    LIMIT ${Number.isInteger(limit) && limit > 0 ? Math.min(limit, 300) : 100};
  `;
  return rows.map((row) => mapProcedureRequestRow(row));
}

export async function findLatestWaitingCitizenProcedureRequest({ userId = null, whatsappWaId = null } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedUserId = normalizeText(userId, 80);
  const waDigits =
    typeof whatsappWaId === "string" ? whatsappWaId.replace(/\D/g, "").slice(0, 32) || null : null;
  if (!normalizedUserId && !waDigits) {
    return null;
  }
  const baseSelectSql = sql`
    SELECT
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      task_claim_expires_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      sla_deadline,
      is_escalated,
      escalated_at,
      waiting_citizen_info_started_at,
      waiting_citizen_info_deadline,
      closed_at,
      created_at,
      updated_at
    FROM chatbot_procedure_requests
  `;
  const [row] =
    waDigits && !normalizedUserId
      ? await sql`
          ${baseSelectSql}
          WHERE whatsapp_wa_id = ${waDigits}
            AND status = 'WAITING_CITIZEN_INFO'
          ORDER BY updated_at DESC
          LIMIT 1;
        `
      : await sql`
          ${baseSelectSql}
          WHERE user_id = ${normalizedUserId}
            AND status = 'WAITING_CITIZEN_INFO'
          ORDER BY updated_at DESC
          LIMIT 1;
        `;
  return row ? mapProcedureRequestRow(row) : null;
}

export async function markOperationAsProcessed({
  procedureRequestId,
  operationType,
  operationKey,
  metadata = {},
  actorId = null,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedRequestId = normalizeText(procedureRequestId, 80);
  const normalizedType = normalizeText(operationType, 120).toUpperCase();
  const normalizedKey = normalizeText(operationKey, 240);
  if (!normalizedRequestId || !normalizedType || !normalizedKey) {
    return { ok: false, reason: "invalid_operation_key" };
  }
  const rows = await sql`
    INSERT INTO chatbot_procedure_processed_operations (
      id,
      procedure_request_id,
      operation_type,
      operation_key,
      metadata_json,
      actor_id
    )
    VALUES (
      ${randomUUID()},
      ${normalizedRequestId},
      ${normalizedType},
      ${normalizedKey},
      ${metadata && typeof metadata === "object" ? metadata : {}},
      ${normalizeText(actorId || "system", 80)}
    )
    ON CONFLICT (procedure_request_id, operation_type, operation_key)
    DO NOTHING
    RETURNING id;
  `;
  return { ok: rows.length > 0, duplicate: rows.length === 0 };
}

export async function hasProcessedOperation({
  procedureRequestId,
  operationType,
  operationKey,
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedRequestId = normalizeText(procedureRequestId, 80);
  const normalizedType = normalizeText(operationType, 120).toUpperCase();
  const normalizedKey = normalizeText(operationKey, 240);
  if (!normalizedRequestId || !normalizedType || !normalizedKey) {
    return false;
  }
  const [row] = await sql`
    SELECT id
    FROM chatbot_procedure_processed_operations
    WHERE procedure_request_id = ${normalizedRequestId}
      AND operation_type = ${normalizedType}
      AND operation_key = ${normalizedKey}
    LIMIT 1;
  `;
  return Boolean(row?.id);
}

export async function incrementProcedureMetric(metricKey, incrementBy = 1) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedMetricKey = normalizeText(metricKey, 120).toLowerCase();
  if (!normalizedMetricKey) {
    return;
  }
  const value = Number.isInteger(incrementBy) ? incrementBy : 1;
  await sql`
    INSERT INTO chatbot_procedure_metrics_daily (
      metric_date,
      metric_key,
      value,
      updated_at
    )
    VALUES (
      CURRENT_DATE,
      ${normalizedMetricKey},
      ${value},
      NOW()
    )
    ON CONFLICT (metric_date, metric_key)
    DO UPDATE SET
      value = chatbot_procedure_metrics_daily.value + EXCLUDED.value,
      updated_at = NOW();
  `;
}

export async function getProcedureMetricsSummary({ days = 7 } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const safeDays = Number.isInteger(days) && days > 0 ? Math.min(days, 90) : 7;
  const rows = await sql`
    SELECT
      metric_date,
      metric_key,
      value
    FROM chatbot_procedure_metrics_daily
    WHERE metric_date >= CURRENT_DATE - (${safeDays}::int - 1)
    ORDER BY metric_date ASC, metric_key ASC;
  `;
  return rows.map((row) => ({
    date: row.metric_date,
    key: row.metric_key,
    value: Number(row.value || 0),
  }));
}

export async function markOverdueProceduresAsEscalated({ actorId = "system" } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    UPDATE chatbot_procedure_requests
    SET
      is_escalated = TRUE,
      escalated_at = COALESCE(escalated_at, NOW()),
      updated_at = NOW()
    WHERE is_escalated = FALSE
      AND sla_deadline IS NOT NULL
      AND sla_deadline <= NOW()
      AND status NOT IN ('CLOSED', 'RESOLVED', 'REJECTED', 'ARCHIVED')
    RETURNING id, status;
  `;
  for (const row of rows) {
    await addProcedureRequestEvent({
      procedureRequestId: row.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
      previousStatus: row.status,
      newStatus: row.status,
      metadata: {
        escalated: true,
        reason: "sla_deadline_exceeded",
      },
      actorId: actorId || "system",
    });
  }
  return rows.length;
}

export async function handleWaitingCitizenInfoTimeouts({ actorId = "system" } = {}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const rows = await sql`
    SELECT id, status
    FROM chatbot_procedure_requests
    WHERE status = 'WAITING_CITIZEN_INFO'
      AND waiting_citizen_info_deadline IS NOT NULL
      AND waiting_citizen_info_deadline <= NOW();
  `;
  let updated = 0;
  for (const row of rows) {
    const policy = String(process.env.WAITING_CITIZEN_INFO_TIMEOUT_POLICY || "ESCALATE")
      .trim()
      .toUpperCase();
    if (policy === "CLOSE") {
      await transitionProcedureRequestStatus({
        procedureRequestId: row.id,
        newStatus: PROCEDURE_REQUEST_STATUSES.CLOSED,
        actorId: actorId || "system",
        eventType: PROCEDURE_REQUEST_EVENT_TYPES.PROCEDURE_CLOSED,
        metadata: {
          reason: "waiting_citizen_info_timeout",
        },
      });
    } else {
      await updateProcedureRequestCamundaData({
        procedureRequestId: row.id,
        isEscalated: true,
        escalatedAt: new Date(),
      });
      await transitionProcedureRequestStatus({
        procedureRequestId: row.id,
        newStatus: PROCEDURE_REQUEST_STATUSES.PENDING_BACKOFFICE_ACTION,
        actorId: actorId || "system",
        eventType: PROCEDURE_REQUEST_EVENT_TYPES.STATUS_CHANGED,
        metadata: {
          reason: "waiting_citizen_info_timeout_escalated",
        },
      });
    }
    updated += 1;
  }
  return updated;
}

export async function updateProcedureRequestCollectedData({
  procedureRequestId,
  collectedData = {},
}) {
  const sql = ensureDatabase();
  await ensureProcedureRequestSchema();
  const normalizedId = normalizeText(procedureRequestId, 80);
  if (!normalizedId) {
    return null;
  }
  const safeCollectedData = collectedData && typeof collectedData === "object" ? collectedData : {};
  const [row] = await sql`
    UPDATE chatbot_procedure_requests
    SET
      collected_data_json = ${safeCollectedData},
      updated_at = NOW()
    WHERE id = ${normalizedId}
    RETURNING
      id,
      user_id,
      channel,
      whatsapp_phone,
      whatsapp_wa_id,
      request_code,
      procedure_type_id,
      procedure_code,
      procedure_name,
      procedure_category,
      status,
      summary,
      collected_data_json,
      camunda_process_instance_key,
      camunda_process_definition_id,
      camunda_process_version,
      camunda_task_definition_key,
      current_task_definition_key,
      camunda_metadata_json,
      camunda_error_summary,
      task_assignee_id,
      task_claimed_at,
      sync_retry_count,
      sync_max_retry_count,
      sync_last_retry_at,
      sync_next_retry_at,
      auto_sync_retry_enabled,
      closed_at,
      created_at,
      updated_at;
  `;
  return row ? mapProcedureRequestRow(row) : null;
}

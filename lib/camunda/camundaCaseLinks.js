import { randomUUID } from "crypto";
import { ensureDatabase, hasDatabase } from "../db";

/**
 * Vínculo entre un caso local (incidencia o trámite) y una instancia Camunda.
 * La creación local va primero; este registro refleja el estado del “sidecar” de orquestación.
 */
export async function ensureCamundaCaseLinkSchema() {
  const sql = ensureDatabase();

  await sql`
    CREATE TABLE IF NOT EXISTS camunda_case_links (
      id TEXT PRIMARY KEY,
      local_case_id TEXT NOT NULL,
      local_case_type TEXT NOT NULL,
      camunda_process_definition_id TEXT,
      camunda_process_instance_key TEXT,
      camunda_state TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      raw_response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS camunda_case_links_local_case_unique
    ON camunda_case_links (local_case_id, local_case_type);
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS camunda_case_links_instance_key_idx
    ON camunda_case_links (camunda_process_instance_key)
    WHERE camunda_process_instance_key IS NOT NULL;
  `;
}

/**
 * @param {object} params
 * @param {string} params.localCaseId
 * @param {'incident'|'tramite'} params.localCaseType
 * @param {string} params.camundaProcessDefinitionId
 * @param {'started'|'camunda_sync_failed'} params.camundaState
 * @param {string|null} [params.camundaProcessInstanceKey]
 * @param {Record<string, unknown>} [params.rawResponseSummary]
 * @param {string|null} [params.lastErrorSummary]
 */
export async function upsertCamundaCaseLink({
  localCaseId,
  localCaseType,
  camundaProcessDefinitionId,
  camundaState,
  camundaProcessInstanceKey = null,
  rawResponseSummary = {},
  lastErrorSummary = null,
}) {
  if (!hasDatabase()) {
    return;
  }
  const sql = ensureDatabase();
  await ensureCamundaCaseLinkSchema();

  const id = randomUUID();
  const startedAt = camundaState === "started" ? new Date() : null;
  const safeRaw =
    rawResponseSummary && typeof rawResponseSummary === "object" ? rawResponseSummary : {};

  await sql`
    INSERT INTO camunda_case_links (
      id,
      local_case_id,
      local_case_type,
      camunda_process_definition_id,
      camunda_process_instance_key,
      camunda_state,
      started_at,
      raw_response_json,
      last_error_summary,
      updated_at
    )
    VALUES (
      ${id},
      ${localCaseId},
      ${localCaseType},
      ${camundaProcessDefinitionId},
      ${camundaProcessInstanceKey},
      ${camundaState},
      ${startedAt},
      ${safeRaw},
      ${lastErrorSummary},
      NOW()
    )
    ON CONFLICT (local_case_id, local_case_type)
    DO UPDATE SET
      camunda_process_definition_id = EXCLUDED.camunda_process_definition_id,
      camunda_process_instance_key = EXCLUDED.camunda_process_instance_key,
      camunda_state = EXCLUDED.camunda_state,
      started_at = COALESCE(EXCLUDED.started_at, camunda_case_links.started_at),
      raw_response_json = EXCLUDED.raw_response_json,
      last_error_summary = EXCLUDED.last_error_summary,
      updated_at = NOW();
  `;
}

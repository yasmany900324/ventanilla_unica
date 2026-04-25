BEGIN;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS channel TEXT;

UPDATE public.chatbot_procedure_requests
SET channel = CASE
  WHEN whatsapp_wa_id IS NOT NULL AND TRIM(whatsapp_wa_id) <> '' THEN 'WHATSAPP'
  ELSE 'WEB'
END
WHERE channel IS NULL OR TRIM(channel) = '';

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN channel SET DEFAULT 'WEB';

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

UPDATE public.chatbot_procedure_requests
SET whatsapp_phone = COALESCE(NULLIF(TRIM(whatsapp_phone), ''), NULLIF(TRIM(whatsapp_wa_id), ''))
WHERE whatsapp_phone IS NULL OR TRIM(whatsapp_phone) = '';

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS current_task_definition_key TEXT;

UPDATE public.chatbot_procedure_requests
SET current_task_definition_key = camunda_task_definition_key
WHERE current_task_definition_key IS NULL
  AND camunda_task_definition_key IS NOT NULL
  AND TRIM(camunda_task_definition_key) <> '';

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_metadata_json JSONB;

UPDATE public.chatbot_procedure_requests
SET camunda_metadata_json = '{}'::jsonb
WHERE camunda_metadata_json IS NULL;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN camunda_metadata_json SET DEFAULT '{}'::jsonb;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN camunda_metadata_json SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_error_summary TEXT;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_process_definition_id TEXT;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS camunda_process_version INTEGER;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS task_assignee_id TEXT REFERENCES public.citizens(id) ON DELETE SET NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS task_claimed_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS task_claim_expires_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS sync_retry_count INTEGER;

UPDATE public.chatbot_procedure_requests
SET sync_retry_count = 0
WHERE sync_retry_count IS NULL;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN sync_retry_count SET DEFAULT 0;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN sync_retry_count SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS sync_max_retry_count INTEGER;

UPDATE public.chatbot_procedure_requests
SET sync_max_retry_count = 3
WHERE sync_max_retry_count IS NULL OR sync_max_retry_count < 1;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN sync_max_retry_count SET DEFAULT 3;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN sync_max_retry_count SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS sync_last_retry_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS sync_next_retry_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS auto_sync_retry_enabled BOOLEAN;

UPDATE public.chatbot_procedure_requests
SET auto_sync_retry_enabled = TRUE
WHERE auto_sync_retry_enabled IS NULL;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN auto_sync_retry_enabled SET DEFAULT TRUE;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN auto_sync_retry_enabled SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMPTZ;

UPDATE public.chatbot_procedure_requests
SET sla_deadline = COALESCE(created_at, NOW()) + INTERVAL '72 hours'
WHERE sla_deadline IS NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS is_escalated BOOLEAN;

UPDATE public.chatbot_procedure_requests
SET is_escalated = FALSE
WHERE is_escalated IS NULL;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN is_escalated SET DEFAULT FALSE;

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN is_escalated SET NOT NULL;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS waiting_citizen_info_started_at TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS waiting_citizen_info_deadline TIMESTAMPTZ;

ALTER TABLE public.chatbot_procedure_requests
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE public.chatbot_procedure_requests
SET status = 'DRAFT'
WHERE status IS NULL OR TRIM(status) = '';

ALTER TABLE public.chatbot_procedure_requests
  ALTER COLUMN status SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_status_updated_idx
  ON public.chatbot_procedure_requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_channel_status_updated_idx
  ON public.chatbot_procedure_requests (channel, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_sync_retry_idx
  ON public.chatbot_procedure_requests (sync_next_retry_at ASC)
  WHERE auto_sync_retry_enabled = TRUE;

CREATE INDEX IF NOT EXISTS chatbot_procedure_requests_sla_deadline_idx
  ON public.chatbot_procedure_requests (sla_deadline ASC)
  WHERE status NOT IN ('CLOSED', 'RESOLVED', 'REJECTED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS public.chatbot_procedure_request_events (
  id TEXT PRIMARY KEY,
  procedure_request_id TEXT NOT NULL REFERENCES public.chatbot_procedure_requests(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chatbot_procedure_request_events_request_created_idx
  ON public.chatbot_procedure_request_events (procedure_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chatbot_procedure_request_events_type_created_idx
  ON public.chatbot_procedure_request_events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chatbot_procedure_processed_operations (
  id TEXT PRIMARY KEY,
  procedure_request_id TEXT NOT NULL REFERENCES public.chatbot_procedure_requests(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS chatbot_procedure_processed_ops_unique_idx
  ON public.chatbot_procedure_processed_operations (procedure_request_id, operation_type, operation_key);

CREATE INDEX IF NOT EXISTS chatbot_procedure_processed_ops_created_idx
  ON public.chatbot_procedure_processed_operations (created_at DESC);

CREATE TABLE IF NOT EXISTS public.chatbot_procedure_metrics_daily (
  metric_date DATE NOT NULL,
  metric_key TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (metric_date, metric_key)
);

COMMIT;

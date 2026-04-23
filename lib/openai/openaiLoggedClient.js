/**
 * Wrapper homogéneo para llamadas OpenAI con logs JSON en Vercel Runtime.
 *
 * Ejemplo de línea esperada (verbose):
 * {"scope":"openai","event":"openai_request_start","context":"web.chat.intent.classification","model":"gpt-4.1-mini","correlationId":"…","startedAt":"…","payload":{...}}
 */

import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { isOpenAiVerboseLogsEnabled } from "./openaiVerboseLogs";
import { getOpenAiCorrelationId } from "./correlationContext";

/** @param {unknown} source */
function pickOpenAiRequestId(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const o = /** @type {Record<string, unknown>} */ (source);
  const fromObj =
    (typeof o._request_id === "string" && o._request_id) ||
    (typeof o.request_id === "string" && o.request_id) ||
    (typeof o.requestID === "string" && o.requestID) ||
    null;
  if (fromObj) {
    return fromObj;
  }
  const headers = o.headers;
  if (headers && typeof headers.get === "function") {
    const h = headers.get("x-request-id") || headers.get("X-Request-Id");
    if (typeof h === "string" && h.trim()) {
      return h.trim();
    }
  }
  return null;
}

/**
 * @param {unknown} completion
 */
function summarizeChatCompletionResponse(completion) {
  if (!completion || typeof completion !== "object") {
    return {};
  }
  const c = /** @type {Record<string, unknown>} */ (completion);
  const choices = Array.isArray(c.choices) ? c.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] : null;
  const msg =
    first && typeof first === "object" && first.message && typeof first.message === "object"
      ? /** @type {Record<string, unknown>} */ (first.message)
      : null;
  const content = msg && typeof msg.content === "string" ? msg.content : "";
  return {
    id: typeof c.id === "string" ? c.id : null,
    model: typeof c.model === "string" ? c.model : null,
    choicesCount: choices.length,
    firstFinishReason:
      first && typeof first === "object" && typeof /** @type {Record<string, unknown>} */ (first).finish_reason === "string"
        ? /** @type {Record<string, unknown>} */ (first).finish_reason
        : null,
    firstMessageContentPreview: content ? content.slice(0, 500) : null,
  };
}

/**
 * @param {unknown} result
 */
function summarizeTranscriptionResponse(result) {
  if (result == null) {
    return {};
  }
  if (typeof result === "string") {
    return {
      type: "string",
      preview: result.slice(0, 400),
      charLength: result.length,
    };
  }
  if (typeof result === "object") {
    const r = /** @type {Record<string, unknown>} */ (result);
    const text = typeof r.text === "string" ? r.text : "";
    return {
      type: "object",
      textPreview: text.slice(0, 400),
      textCharLength: text.length,
      language: typeof r.language === "string" ? r.language : null,
      duration: typeof r.duration === "number" ? r.duration : null,
      segmentCount: Array.isArray(r.segments) ? r.segments.length : 0,
    };
  }
  return { type: typeof result };
}

/**
 * @param {unknown} error
 */
function summarizeOpenAiError(error) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const e = /** @type {Record<string, unknown>} */ (error);
  return {
    name: typeof e.name === "string" ? e.name : null,
    message: typeof e.message === "string" ? e.message.slice(0, 2000) : String(error),
    status: typeof e.status === "number" ? e.status : null,
    code: typeof e.code === "string" ? e.code : null,
    type: typeof e.type === "string" ? e.type : null,
    request_id: pickOpenAiRequestId(error) || pickOpenAiRequestId(e.response) || null,
  };
}

function emitJsonLog(record) {
  try {
    const line = JSON.stringify(sanitizeForLogs(record));
    if (record.event === "openai_request_error") {
      console.error(line);
    } else {
      console.log(line);
    }
  } catch (_err) {
    console.error(
      JSON.stringify({
        scope: "openai",
        event: "openai_log_emit_failed",
        message: "sanitize/serialize failed for log record",
      })
    );
  }
}

/**
 * @param {object} params
 * @param {string} params.context
 * @param {string} params.model
 * @param {unknown} params.payloadForLog — ya sanitizado o serializable
 * @param {() => Promise<unknown>} params.invoke
 * @param {(result: unknown) => unknown} [params.summarizeResponse]
 * @param {string|null} [params.correlationId]
 */
export async function runOpenAiLoggedCall({
  context,
  model,
  payloadForLog,
  invoke,
  summarizeResponse,
  correlationId: correlationIdOverride,
}) {
  const verbose = isOpenAiVerboseLogsEnabled();
  const correlationId = correlationIdOverride ?? getOpenAiCorrelationId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  if (verbose) {
    emitJsonLog({
      scope: "openai",
      event: "openai_request_start",
      context,
      model,
      correlationId,
      startedAt,
      payload: sanitizeForLogs(payloadForLog),
    });
  }

  try {
    const result = await invoke();
    const durationMs = Date.now() - t0;
    const requestId = pickOpenAiRequestId(result) || null;
    const responseSummary = summarizeResponse ? summarizeResponse(result) : { note: "no_summary" };

    if (verbose) {
      emitJsonLog({
        scope: "openai",
        event: "openai_request_success",
        context,
        model,
        correlationId,
        durationMs,
        openaiRequestId: requestId,
        response: sanitizeForLogs(responseSummary),
      });
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - t0;
    const errSummary = summarizeOpenAiError(error);
    const requestId = errSummary.request_id || null;

    emitJsonLog({
      scope: "openai",
      event: "openai_request_error",
      context,
      model,
      correlationId,
      durationMs,
      openaiRequestId: requestId,
      error: sanitizeForLogs(errSummary),
      ...(verbose ? { payload: sanitizeForLogs(payloadForLog) } : {}),
    });

    throw error;
  }
}

/**
 * @param {import("openai").OpenAI} client
 * @param {object} opts
 * @param {string} opts.context
 * @param {import("openai").OpenAI.Chat.ChatCompletionCreateParams} opts.params
 * @param {import("openai").Core.RequestOptions} [opts.requestOptions]
 * @param {string|null} [opts.correlationId]
 */
export function createChatCompletionWithLogs(client, opts) {
  const { context, params, requestOptions, correlationId } = opts;
  const model = typeof params.model === "string" ? params.model : "unknown";
  return runOpenAiLoggedCall({
    context,
    model,
    payloadForLog: params,
    correlationId: correlationId ?? null,
    summarizeResponse: (completion) => summarizeChatCompletionResponse(completion),
    invoke: () => client.chat.completions.create(params, requestOptions),
  });
}

/**
 * @param {import("openai").OpenAI} client
 * @param {object} opts
 * @param {string} opts.context
 * @param {unknown} opts.params — argumento real de transcriptions.create (incluye file)
 * @param {unknown} opts.payloadForLog — resumen seguro para logs (sin binario)
 * @param {import("openai").Core.RequestOptions} [opts.requestOptions]
 * @param {string|null} [opts.correlationId]
 */
export function createTranscriptionWithLogs(client, opts) {
  const { context, params, payloadForLog, requestOptions, correlationId } = opts;
  const p = params && typeof params === "object" ? /** @type {Record<string, unknown>} */ (params) : {};
  const model = typeof p.model === "string" ? p.model : "unknown";
  return runOpenAiLoggedCall({
    context,
    model,
    payloadForLog,
    correlationId: correlationId ?? null,
    summarizeResponse: (result) => summarizeTranscriptionResponse(result),
    invoke: () => client.audio.transcriptions.create(params, requestOptions),
  });
}

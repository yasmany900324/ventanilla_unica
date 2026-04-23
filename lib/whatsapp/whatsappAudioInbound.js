import { CHATBOT_TELEMETRY_EVENTS, trackChatbotEvent } from "../chatbotTelemetry";
import { transcribeAudio } from "../speechToText/transcribeAudio";
import { isSpeechToTextConfigured } from "../speechToText/resolveSpeechToTextProvider";
import { downloadWhatsAppMediaBytesWithRetries } from "./whatsappMediaClient";
import { normalizeTranscriptionText } from "./normalizeTranscriptionText";

const DEFAULT_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const DEFAULT_DOWNLOAD_MS = 25_000;
const DEFAULT_STT_MS = 55_000;

function parsePositiveInt(value, fallback) {
  const n = typeof value === "string" ? parseInt(value.trim(), 10) : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function maskWaId(waId) {
  if (typeof waId !== "string" || waId.length < 5) {
    return "***";
  }
  return `…${waId.slice(-4)}`;
}

function baseMime(mimeType) {
  if (typeof mimeType !== "string") {
    return "";
  }
  return mimeType.split(";")[0].trim().toLowerCase();
}

/**
 * Validación MIME conservadora: solo tipos de audio habituales en WhatsApp.
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isWhatsAppAudioMimeAccepted(mimeType) {
  const base = baseMime(mimeType);
  if (!base) {
    return true;
  }
  if (base === "application/octet-stream") {
    return true;
  }
  if (base.startsWith("audio/")) {
    return true;
  }
  return false;
}

function withTimeout(ms, label) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  const done = () => clearTimeout(id);
  return { signal: controller.signal, done, label };
}

/**
 * Descarga audio de WhatsApp, valida y transcribe (todo en memoria).
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.waId
 * @param {string} params.messageId
 * @param {string} params.mediaId
 * @param {string} [params.mimeTypeHint]
 * @param {string|null} [params.timestamp]
 * @returns {Promise<
 *   | { ok: true, text: string, normalizedText: string, providerId?: string|null, confidence?: number|null, language?: string|null }
 *   | { ok: false, reason: 'stt_disabled'|'mime_rejected'|'download'|'transcription'|'empty_transcript', error?: string }
 * >}
 */
export async function processWhatsAppInboundAudioToText(params) {
  const { sessionId, waId, messageId, mediaId, mimeTypeHint, timestamp } = params;
  const logBase = {
    channel: "whatsapp",
    waId: maskWaId(waId),
    messageId,
    mediaIdPrefix: typeof mediaId === "string" ? `${mediaId.slice(0, 6)}…` : "",
  };

  const maxBytes = parsePositiveInt(
    process.env.WHATSAPP_AUDIO_MAX_BYTES,
    DEFAULT_MAX_AUDIO_BYTES
  );
  const downloadMs = parsePositiveInt(
    process.env.WHATSAPP_AUDIO_DOWNLOAD_TIMEOUT_MS,
    DEFAULT_DOWNLOAD_MS
  );
  const sttMs = parsePositiveInt(process.env.WHATSAPP_STT_TIMEOUT_MS, DEFAULT_STT_MS);

  console.info("[whatsapp] audio pipeline: received", {
    ...logBase,
    hasTimestamp: Boolean(timestamp),
  });

  if (!isSpeechToTextConfigured()) {
    console.warn("[whatsapp] audio pipeline: STT not configured", logBase);
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "stt_not_configured",
      details: "speech_to_text",
    });
    return { ok: false, reason: "stt_disabled", error: "stt_not_configured" };
  }

  const resolvedMime =
    typeof mimeTypeHint === "string" && mimeTypeHint.trim()
      ? mimeTypeHint.trim().split(";")[0].toLowerCase()
      : "application/octet-stream";

  if (!isWhatsAppAudioMimeAccepted(resolvedMime)) {
    console.warn("[whatsapp] audio pipeline: mime rejected", { ...logBase, mimeType: resolvedMime });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "mime_rejected",
      details: resolvedMime.slice(0, 80),
    });
    return { ok: false, reason: "mime_rejected", error: "mime_rejected" };
  }

  const dl = withTimeout(downloadMs, "download");
  /** @type {{ ok: true, bytes: Buffer, mimeType: string } | { ok: false, error: string } | undefined} */
  let download;
  try {
    console.info("[whatsapp] audio pipeline: downloading", logBase);
    download = await downloadWhatsAppMediaBytesWithRetries(mediaId, {
      signal: dl.signal,
      maxBytes: maxBytes,
    });
  } catch (error) {
    dl.done();
    const err = error?.name === "AbortError" ? "download_timeout" : "download_failed";
    console.error("[whatsapp] audio pipeline: download exception", { ...logBase, err });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: err,
      details: String(error?.message || err).slice(0, 200),
    });
    return { ok: false, reason: "download", error: err };
  } finally {
    dl.done();
  }

  if (!download || !download.ok) {
    console.error("[whatsapp] audio pipeline: download failed", {
      ...logBase,
      error: download?.error,
      discardReason: "download_failed",
    });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "download_failed",
      details: download.error,
    });
    return { ok: false, reason: "download", error: download.error };
  }

  const effectiveMime =
    baseMime(download.mimeType) && baseMime(download.mimeType) !== "application/octet-stream"
      ? baseMime(download.mimeType)
      : resolvedMime;

  if (!isWhatsAppAudioMimeAccepted(effectiveMime)) {
    console.warn("[whatsapp] audio pipeline: mime rejected after download", {
      ...logBase,
      mimeType: effectiveMime,
    });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "mime_rejected_post_download",
      details: effectiveMime.slice(0, 80),
    });
    return { ok: false, reason: "mime_rejected", error: "mime_rejected" };
  }

  console.info("[whatsapp] audio pipeline: download ok", {
    ...logBase,
    byteLength: download.bytes.length,
    mimeType: effectiveMime,
  });

  if (!download.bytes.length) {
    console.error("[whatsapp] audio pipeline: empty file after download", {
      ...logBase,
      discardReason: "zero_byte_body",
    });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "empty_download_body",
      details: "zero_bytes",
    });
    return { ok: false, reason: "download", error: "empty_download_body" };
  }

  const sttWatch = withTimeout(sttMs, "stt");
  let stt;
  try {
    console.info("[whatsapp] audio pipeline: transcribing start", logBase);
    stt = await transcribeAudio({
      bytes: download.bytes,
      mimeType: effectiveMime,
      signal: sttWatch.signal,
      openAiLogContext: "whatsapp.audio.transcription",
    });
  } catch (error) {
    sttWatch.done();
    const err = error?.name === "AbortError" ? "stt_timeout" : "stt_exception";
    console.error("[whatsapp] audio pipeline: transcribe exception", { ...logBase, err });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: err,
      details: String(error?.message || err).slice(0, 200),
    });
    return { ok: false, reason: "transcription", error: err };
  } finally {
    sttWatch.done();
  }

  console.info("[whatsapp] audio pipeline: transcribing end", {
    ...logBase,
    sttOk: stt?.ok === true,
    providerId: stt && "providerId" in stt ? stt.providerId : null,
  });

  if (!stt.ok) {
    console.error("[whatsapp] audio pipeline: STT provider returned error", {
      ...logBase,
      error: stt.error,
      providerId: stt.providerId ?? null,
      discardReason: "stt_provider_failed",
    });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "stt_failed",
      details: stt.error,
    });
    return { ok: false, reason: "transcription", error: stt.error };
  }

  const rawText = typeof stt.text === "string" ? stt.text : "";
  const normalizedText = normalizeTranscriptionText(rawText);
  if (!normalizedText) {
    console.warn("[whatsapp] audio pipeline: empty transcript after normalize", {
      ...logBase,
      rawTextLength: rawText.length,
      rawTextPreview: rawText.slice(0, 160),
      normalizedLength: normalizedText.length,
      discardReason: "empty_or_whitespace_only",
    });
    await trackChatbotEvent({
      sessionId,
      locale: "es",
      userId: null,
      eventName: CHATBOT_TELEMETRY_EVENTS.SERVICE_ERROR,
      command: "whatsapp_audio",
      mode: "channel",
      outcome: "empty_transcript",
      details: "after_normalize",
    });
    return { ok: false, reason: "empty_transcript", error: "empty_transcript" };
  }

  const preview = normalizedText.slice(0, 80);
  console.info("[whatsapp] audio pipeline: transcript ready", {
    ...logBase,
    charCount: normalizedText.length,
    textPreview: preview,
    confidence: stt.confidence ?? null,
    language: stt.language ?? null,
  });

  await trackChatbotEvent({
    sessionId,
    locale: "es",
    userId: null,
    eventName: CHATBOT_TELEMETRY_EVENTS.TURN_RECEIVED,
    command: "whatsapp_audio",
    mode: "channel",
    outcome: "transcribed_ok",
    confidence: typeof stt.confidence === "number" ? stt.confidence : null,
    details: `chars=${normalizedText.length} prov=${stt.providerId || ""}`.slice(0, 500),
  });

  return {
    ok: true,
    text: stt.text,
    normalizedText,
    providerId: stt.providerId,
    confidence: stt.confidence ?? null,
    language: stt.language ?? null,
  };
}

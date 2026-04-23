import { transcribeWithOpenAIWhisper } from "./openaiWhisperProvider";

/**
 * @typedef {(input: {
 *   bytes: Buffer,
 *   mimeType: string,
 *   signal?: AbortSignal
 * }) => Promise<{ ok: true, text: string, confidence?: number|null, language?: string|null } | { ok: false, error: string }>} SpeechToTextTranscriber
 */

/**
 * @typedef {"provider_disabled"|"unknown_stt_provider"|"missing_api_key"} SpeechToTextConfigFailureReason
 */

/**
 * @returns {{ ok: true, rawProvider: string } | { ok: false, reason: SpeechToTextConfigFailureReason, rawProvider: string }}
 */
function evaluateSpeechToTextConfig() {
  const rawProvider = (process.env.STT_PROVIDER || "").trim();
  const explicit = rawProvider.toLowerCase();
  if (explicit === "none" || explicit === "off" || explicit === "disabled") {
    return { ok: false, reason: "provider_disabled", rawProvider };
  }

  // `whisper-1` / `whisper_1` are model names people often put in STT_PROVIDER by mistake (model belongs in STT_MODEL).
  const wantsOpenAi =
    explicit === "" ||
    explicit === "openai" ||
    explicit === "openai_whisper" ||
    explicit === "whisper" ||
    explicit === "whisper-1" ||
    explicit === "whisper_1";

  if (!wantsOpenAi) {
    return { ok: false, reason: "unknown_stt_provider", rawProvider };
  }

  const hasKey =
    Boolean((process.env.STT_API_KEY || "").trim()) ||
    Boolean((process.env.OPENAI_API_KEY || "").trim());
  if (!hasKey) {
    return { ok: false, reason: "missing_api_key", rawProvider };
  }

  return { ok: true, rawProvider };
}

/**
 * Safe booleans for logs (no secrets). Use when STT fails or is skipped.
 * @returns {{
 *   ok: boolean,
 *   reason?: SpeechToTextConfigFailureReason,
 *   sttProviderRaw: string,
 *   hasSttApiKey: boolean,
 *   hasOpenAiApiKey: boolean
 * }}
 */
export function getSpeechToTextConfigDiagnostics() {
  const evaluated = evaluateSpeechToTextConfig();
  const hasSttApiKey = Boolean((process.env.STT_API_KEY || "").trim());
  const hasOpenAiApiKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
  const sttProviderRaw =
    evaluated.rawProvider === "" ? "(unset)" : evaluated.rawProvider;
  if (evaluated.ok) {
    return { ok: true, sttProviderRaw, hasSttApiKey, hasOpenAiApiKey };
  }
  return {
    ok: false,
    reason: evaluated.reason,
    sttProviderRaw,
    hasSttApiKey,
    hasOpenAiApiKey,
  };
}

/**
 * @returns {{ id: string, transcribe: SpeechToTextTranscriber } | null}
 */
export function resolveSpeechToTextProvider() {
  const evaluated = evaluateSpeechToTextConfig();
  if (!evaluated.ok) {
    return null;
  }

  return {
    id: "openai_whisper",
    transcribe: transcribeWithOpenAIWhisper,
  };
}

export function isSpeechToTextConfigured() {
  return evaluateSpeechToTextConfig().ok;
}

import { transcribeWithOpenAIWhisper } from "./openaiWhisperProvider";

/**
 * @typedef {(input: {
 *   bytes: Buffer,
 *   mimeType: string,
 *   signal?: AbortSignal
 * }) => Promise<{ ok: true, text: string, confidence?: number|null, language?: string|null } | { ok: false, error: string }>} SpeechToTextTranscriber
 */

/**
 * @returns {{ id: string, transcribe: SpeechToTextTranscriber } | null}
 */
export function resolveSpeechToTextProvider() {
  const explicit = (process.env.STT_PROVIDER || "").trim().toLowerCase();
  if (explicit === "none" || explicit === "off" || explicit === "disabled") {
    return null;
  }

  const wantsOpenAi =
    explicit === "" ||
    explicit === "openai" ||
    explicit === "openai_whisper" ||
    explicit === "whisper";

  if (!wantsOpenAi) {
    return null;
  }

  const hasKey =
    Boolean((process.env.STT_API_KEY || "").trim()) ||
    Boolean((process.env.OPENAI_API_KEY || "").trim());
  if (!hasKey) {
    return null;
  }

  return {
    id: "openai_whisper",
    transcribe: transcribeWithOpenAIWhisper,
  };
}

export function isSpeechToTextConfigured() {
  return resolveSpeechToTextProvider() !== null;
}

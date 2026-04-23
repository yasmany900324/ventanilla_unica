import { resolveSpeechToTextProvider } from "./resolveSpeechToTextProvider";

/**
 * Punto único de entrada STT (proveedor intercambiable vía STT_PROVIDER).
 * @param {object} input
 * @param {Buffer} input.bytes — audio en memoria (sin persistencia en disco)
 * @param {string} input.mimeType
 * @param {AbortSignal} [input.signal]
 * @param {string} [input.openAiLogContext] — contexto para logs OpenAI (p. ej. whatsapp.audio.transcription)
 * @returns {Promise<{ ok: true, text: string, confidence?: number|null, language?: string|null, providerId: string } | { ok: false, error: string, providerId?: string|null }>}
 */
export async function transcribeAudio(input) {
  const provider = resolveSpeechToTextProvider();
  if (!provider) {
    return { ok: false, error: "stt_not_configured", providerId: null };
  }

  const out = await provider.transcribe({
    bytes: input.bytes,
    mimeType: input.mimeType,
    signal: input.signal,
    openAiLogContext: input.openAiLogContext,
  });

  if (!out.ok) {
    return { ok: false, error: out.error, providerId: provider.id };
  }

  return {
    ok: true,
    text: out.text,
    confidence: out.confidence ?? null,
    language: out.language ?? null,
    providerId: provider.id,
  };
}

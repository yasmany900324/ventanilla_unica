import OpenAI, { toFile } from "openai";

const DEFAULT_MODEL = "whisper-1";

function extensionForMime(mimeType) {
  const m = typeof mimeType === "string" ? mimeType.toLowerCase().split(";")[0].trim() : "";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return ".mp3";
  if (m.includes("mp4") || m.includes("m4a")) return ".m4a";
  if (m.includes("aac")) return ".aac";
  if (m.includes("webm")) return ".webm";
  if (m.includes("amr")) return ".amr";
  if (m.includes("opus")) return ".opus";
  return ".audio";
}

/**
 * @param {object} input
 * @param {Buffer} input.bytes
 * @param {string} input.mimeType
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ ok: true, text: string, confidence?: number|null, language?: string|null } | { ok: false, error: string }>}
 */
export async function transcribeWithOpenAIWhisper(input) {
  const apiKey =
    (process.env.STT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "missing_stt_api_key" };
  }

  const model = (process.env.STT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const bytes = input.bytes;
  const mimeType =
    typeof input.mimeType === "string" && input.mimeType.trim()
      ? input.mimeType.trim().split(";")[0].toLowerCase()
      : "application/octet-stream";

  try {
    const client = new OpenAI({ apiKey });
    const filename = `whatsapp-voice${extensionForMime(mimeType)}`;
    const file = await toFile(bytes, filename, { type: mimeType });

    const createOpts =
      input.signal && typeof input.signal === "object"
        ? { signal: input.signal }
        : undefined;

    let result;
    try {
      result = await client.audio.transcriptions.create(
        {
          file,
          model,
          response_format: "verbose_json",
        },
        createOpts
      );
    } catch {
      result = await client.audio.transcriptions.create({ file, model }, createOpts);
    }

    const text =
      typeof result?.text === "string"
        ? result.text
        : typeof result === "string"
          ? result
          : "";

    const language =
      typeof result?.language === "string" && result.language.trim()
        ? result.language.trim()
        : null;

    let confidence = null;
    const segs = result?.segments;
    if (Array.isArray(segs) && segs.length > 0) {
      const scores = segs
        .map((s) => (typeof s?.avg_logprob === "number" ? s.avg_logprob : null))
        .filter((v) => v !== null);
      if (scores.length > 0) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const approx = Math.max(0, Math.min(1, 1 + avg));
        confidence = Number(approx.toFixed(3));
      }
    }

    return { ok: true, text, confidence, language };
  } catch (error) {
    const name = error?.name === "AbortError" ? "aborted" : error?.message || "stt_request_failed";
    return { ok: false, error: String(name).slice(0, 120) };
  }
}

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
  if (m.includes("opus")) return ".ogg";
  if (m === "application/octet-stream" || !m) return ".ogg";
  return ".ogg";
}

/**
 * MIME enviado a OpenAI: opus en OGG es lo habitual en WhatsApp.
 * @param {string} mimeType
 */
function whisperUploadMime(mimeType) {
  const base =
    typeof mimeType === "string" && mimeType.trim()
      ? mimeType.trim().split(";")[0].toLowerCase()
      : "application/octet-stream";
  if (base === "application/octet-stream" || !base.startsWith("audio/")) {
    return "audio/ogg";
  }
  return base;
}

/**
 * @param {unknown} result — respuesta del SDK o JSON parseado
 * @returns {string}
 */
export function extractWhisperTranscriptionText(result) {
  if (result == null) {
    return "";
  }
  if (typeof result === "string") {
    const s = result.trim();
    if (s.startsWith("{") && s.includes('"text"')) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed.text === "string") {
          return parsed.text;
        }
      } catch {
        return s;
      }
    }
    return s;
  }
  if (typeof result === "object") {
    if (typeof result.text === "string" && result.text.trim()) {
      return result.text;
    }
    const segs = result.segments;
    if (Array.isArray(segs) && segs.length > 0) {
      const joined = segs
        .map((s) => (typeof s?.text === "string" ? s.text.trim() : ""))
        .filter(Boolean)
        .join(" ")
        .trim();
      if (joined) {
        return joined;
      }
    }
  }
  return "";
}

function sttDebugEnabled() {
  return process.env.WHATSAPP_AUDIO_STT_DEBUG === "1" || process.env.WHATSAPP_AUDIO_STT_DEBUG === "true";
}

function safeLogTranscript(label, text) {
  if (!sttDebugEnabled()) {
    return;
  }
  const t = typeof text === "string" ? text : "";
  console.info(`[whatsapp] audio STT debug ${label}`, {
    charLength: t.length,
    preview: t.slice(0, 220),
  });
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
  const rawMime =
    typeof input.mimeType === "string" && input.mimeType.trim()
      ? input.mimeType.trim().split(";")[0].toLowerCase()
      : "application/octet-stream";
  const uploadMime = whisperUploadMime(rawMime);
  const filename = `whatsapp-voice${extensionForMime(rawMime)}`;

  if (!bytes?.length) {
    console.warn("[whatsapp] audio STT: empty buffer, skipping OpenAI call");
    return { ok: false, error: "empty_audio_buffer" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const file = await toFile(bytes, filename, { type: uploadMime });

    const createOpts =
      input.signal && typeof input.signal === "object"
        ? { signal: input.signal }
        : undefined;

    console.info("[whatsapp] audio STT: openai request", {
      model,
      filename,
      uploadMime,
      rawMimeHint: rawMime,
      byteLength: bytes.length,
    });

    let result;
    try {
      result = await client.audio.transcriptions.create(
        {
          file,
          model,
          response_format: "json",
        },
        createOpts
      );
    } catch (firstError) {
      console.warn("[whatsapp] audio STT: json format failed, retrying default", {
        message: firstError?.message?.slice?.(0, 160),
        status: firstError?.status,
      });
      result = await client.audio.transcriptions.create({ file, model }, createOpts);
    }

    const text = extractWhisperTranscriptionText(result).trim();
    safeLogTranscript("raw_extracted", text);

    const language =
      result && typeof result === "object" && typeof result.language === "string"
        ? result.language.trim()
        : null;

    let confidence = null;
    const segs = result && typeof result === "object" ? result.segments : null;
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

    const durationSec =
      result && typeof result === "object" && typeof result.duration === "number"
        ? result.duration
        : null;

    console.info("[whatsapp] audio STT: openai response", {
      model,
      textCharLength: text.length,
      language,
      durationSec,
      hasSegments: Array.isArray(segs) && segs.length > 0,
    });

    return { ok: true, text, confidence, language };
  } catch (error) {
    const name = error?.name === "AbortError" ? "aborted" : error?.message || "stt_request_failed";
    console.error("[whatsapp] audio STT: openai error", {
      message: String(name).slice(0, 200),
      status: error?.status,
    });
    return { ok: false, error: String(name).slice(0, 120) };
  }
}

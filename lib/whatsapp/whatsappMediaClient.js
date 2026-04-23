const GRAPH_VERSION = "v21.0";

/**
 * Resolves a WhatsApp media id to a temporary download URL (Graph API).
 * @param {string} mediaId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, url: string, mimeType?: string } | { ok: false, error: string }>}
 */
export async function getWhatsAppMediaDownloadUrl(mediaId, options = {}) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { ok: false, error: "missing_token" };
  }
  const id = typeof mediaId === "string" ? mediaId.trim() : "";
  if (!id) {
    return { ok: false, error: "missing_media_id" };
  }

  const metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: options.signal,
  });
  let metaJson = null;
  try {
    metaJson = await metaRes.json();
  } catch {
    metaJson = null;
  }
  if (!metaRes.ok) {
    return {
      ok: false,
      error: `meta_http_${metaRes.status}`,
    };
  }
  const url = typeof metaJson?.url === "string" ? metaJson.url.trim() : "";
  if (!url) {
    return { ok: false, error: "missing_url_in_meta_response" };
  }
  const mimeType =
    typeof metaJson?.mime_type === "string" ? metaJson.mime_type.trim().toLowerCase() : undefined;
  return { ok: true, url, mimeType };
}

/**
 * Downloads binary media for a WhatsApp Cloud API attachment id.
 * @param {string} mediaId
 * @param {{ signal?: AbortSignal, maxBytes?: number }} [options]
 * @returns {Promise<{ ok: true, bytes: Buffer, mimeType: string } | { ok: false, error: string }>}
 */
export async function downloadWhatsAppMediaBytes(mediaId, options = {}) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { ok: false, error: "missing_token" };
  }

  const resolved = await getWhatsAppMediaDownloadUrl(mediaId, { signal: options.signal });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const fileRes = await fetch(resolved.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: options.signal,
  });
  if (!fileRes.ok) {
    return { ok: false, error: `download_http_${fileRes.status}` };
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  if (
    typeof options.maxBytes === "number" &&
    Number.isFinite(options.maxBytes) &&
    options.maxBytes > 0 &&
    arrayBuffer.byteLength > options.maxBytes
  ) {
    return { ok: false, error: "media_too_large" };
  }
  const bytes = Buffer.from(arrayBuffer);
  const headerType = typeof fileRes.headers.get === "function" ? fileRes.headers.get("content-type") : null;
  const mimeType =
    (resolved.mimeType && resolved.mimeType.trim()) ||
    (typeof headerType === "string" && headerType.split(";")[0].trim().toLowerCase()) ||
    "application/octet-stream";

  return { ok: true, bytes, mimeType };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {string} error
 * @returns {boolean}
 */
function isRetriableWhatsAppMediaError(error) {
  if (typeof error !== "string" || !error) {
    return false;
  }
  if (error === "missing_token" || error === "missing_media_id" || error === "media_too_large") {
    return false;
  }
  if (error === "missing_url_in_meta_response" || error === "download_threw") {
    return true;
  }
  const match = error.match(/_(\d{3})\b/);
  if (match) {
    const code = parseInt(match[1], 10);
    if (code === 429) {
      return true;
    }
    if (code >= 500 && code <= 599) {
      return true;
    }
  }
  return false;
}

/**
 * Descarga con hasta 2 reintentos (3 intentos) y backoff 200 ms / 500 ms.
 * @param {string} mediaId
 * @param {{ signal?: AbortSignal, maxBytes?: number }} [options]
 * @returns {Promise<{ ok: true, bytes: Buffer, mimeType: string } | { ok: false, error: string }>}
 */
export async function downloadWhatsAppMediaBytesWithRetries(mediaId, options = {}) {
  const delays = [0, 200, 500];
  /** @type {{ ok: true, bytes: Buffer, mimeType: string } | { ok: false, error: string }} */
  let last = { ok: false, error: "unknown" };
  const idPrefix =
    typeof mediaId === "string" && mediaId.length > 6 ? `${mediaId.slice(0, 8)}…` : "***";
  const { signal } = options;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (signal?.aborted) {
      console.warn("[whatsapp] media download aborted", { attempt: attempt + 1, mediaIdPrefix: idPrefix });
      return { ok: false, error: "aborted" };
    }
    if (delays[attempt] > 0) {
      await sleep(delays[attempt]);
    }
    console.info("[whatsapp] media download attempt", {
      attempt: attempt + 1,
      maxAttempts: 3,
      mediaIdPrefix: idPrefix,
    });
    try {
      last = await downloadWhatsAppMediaBytes(mediaId, {
        maxBytes: options.maxBytes,
        signal,
      });
    } catch (error) {
      last = { ok: false, error: "download_threw" };
      console.warn("[whatsapp] media download threw", {
        attempt: attempt + 1,
        mediaIdPrefix: idPrefix,
        kind: error?.name === "AbortError" ? "abort" : "error",
      });
    }
    if (last.ok) {
      return last;
    }
    const willRetry = isRetriableWhatsAppMediaError(last.error) && attempt < 2;
    console.warn("[whatsapp] media download attempt failed", {
      attempt: attempt + 1,
      error: last.error,
      willRetry,
    });
    if (!willRetry) {
      break;
    }
  }
  return last;
}

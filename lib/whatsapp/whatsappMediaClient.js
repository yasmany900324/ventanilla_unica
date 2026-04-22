const GRAPH_VERSION = "v21.0";

/**
 * Resolves a WhatsApp media id to a temporary download URL (Graph API).
 * @param {string} mediaId
 * @returns {Promise<{ ok: true, url: string, mimeType?: string } | { ok: false, error: string }>}
 */
export async function getWhatsAppMediaDownloadUrl(mediaId) {
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
 * @returns {Promise<{ ok: true, bytes: Buffer, mimeType: string } | { ok: false, error: string }>}
 */
export async function downloadWhatsAppMediaBytes(mediaId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { ok: false, error: "missing_token" };
  }

  const resolved = await getWhatsAppMediaDownloadUrl(mediaId);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const fileRes = await fetch(resolved.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!fileRes.ok) {
    return { ok: false, error: `download_http_${fileRes.status}` };
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const headerType = typeof fileRes.headers.get === "function" ? fileRes.headers.get("content-type") : null;
  const mimeType =
    (resolved.mimeType && resolved.mimeType.trim()) ||
    (typeof headerType === "string" && headerType.split(";")[0].trim().toLowerCase()) ||
    "application/octet-stream";

  return { ok: true, bytes, mimeType };
}

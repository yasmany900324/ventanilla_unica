import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifies `X-Hub-Signature-256` for WhatsApp / Meta webhooks (HMAC-SHA256 of raw body).
 * @param {string} rawBody — exact bytes Meta signed (use `await request.text()` before JSON parse)
 * @param {string|null|undefined} signatureHeader — header value, e.g. `sha256=abc...`
 * @param {string} appSecret — Meta app secret
 */
export function verifyMetaAppSecretSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || typeof appSecret !== "string" || !appSecret.trim()) {
    return false;
  }
  if (!signatureHeader || typeof signatureHeader !== "string" || !rawBody) {
    return false;
  }
  const expectedHex = createHmac("sha256", appSecret.trim())
    .update(rawBody, "utf8")
    .digest("hex");
  const expected = `sha256=${expectedHex}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader.trim(), "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

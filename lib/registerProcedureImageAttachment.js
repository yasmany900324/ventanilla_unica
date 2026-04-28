import path from "path";
import { getIncidentAttachmentStorage } from "./attachments/getIncidentAttachmentStorage";

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function sanitizePublicUrl(value) {
  const normalized = normalizeText(value, 2048);
  if (!normalized || !looksLikeHttpUrl(normalized)) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    const sensitiveKeys = [
      "token",
      "access_token",
      "signature",
      "sig",
      "x-amz-signature",
      "x-amz-security-token",
      "x-goog-signature",
      "x-goog-credential",
    ];
    const hasSensitiveQuery = sensitiveKeys.some((key) => parsed.searchParams.has(key));
    return hasSensitiveQuery ? "" : parsed.toString();
  } catch {
    return "";
  }
}

function normalizeAttachmentSize(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const asInt = Math.trunc(value);
  if (asInt <= 0) {
    return null;
  }
  return Math.min(asInt, 50 * 1024 * 1024);
}

/**
 * Sube una imagen y devuelve contrato único para collectedData + imagen canónica.
 */
export async function registerProcedureImageAttachment({
  sourceChannel,
  sessionId,
  bytes,
  mimeType,
  originalName,
}) {
  const safeChannel = normalizeText(sourceChannel, 40).toLowerCase() || "unknown";
  const safeContentType = normalizeText(mimeType, 120).toLowerCase();
  const safeOriginalName = normalizeText(originalName, 240) || "imagen";

  const storage = getIncidentAttachmentStorage();
  const uploadResult = await storage.uploadDraftAttachment({
    sessionId,
    bytes,
    mimeType: safeContentType,
  });
  if (!uploadResult.ok) {
    return { ok: false, error: uploadResult.error };
  }

  const sanitizedPublicUrl = sanitizePublicUrl(uploadResult.publicUrl);
  const sizeBytes = normalizeAttachmentSize(uploadResult.sizeBytes);
  const storageKey = normalizeText(uploadResult.storageKey, 512);
  const storedFilename = normalizeText(path.basename(storageKey), 240);
  const attachmentData = {
    photoStatus: "provided",
    photoAttachmentStorageProvider: normalizeText(uploadResult.storageProvider, 40),
    photoAttachmentStorageKey: storageKey,
    photoAttachmentPublicUrl: sanitizedPublicUrl,
    photoAttachmentOriginalName: safeOriginalName,
    photoAttachmentStoredFilename: storedFilename,
    photoAttachmentContentType: safeContentType,
    // Alias temporal mientras el código consume ambos nombres.
    photoAttachmentMimeType: safeContentType,
    photoAttachmentSizeBytes: sizeBytes,
    photoAttachmentUploadedAt: new Date().toISOString(),
    photoAttachmentChannel: safeChannel,
  };

  const canonicalImage = sanitizedPublicUrl
    ? Object.fromEntries(
        Object.entries({
          url: sanitizedPublicUrl,
          filename: safeOriginalName,
          mimeType: safeContentType || null,
          size: sizeBytes,
        }).filter(([, value]) => value != null && value !== "")
      )
    : Object.fromEntries(
        Object.entries({
          filename: safeOriginalName,
          mimeType: safeContentType || null,
          size: sizeBytes,
        }).filter(([, value]) => value != null && value !== "")
      );

  return {
    ok: true,
    storage,
    uploadResult,
    attachmentData,
    canonicalImage,
  };
}

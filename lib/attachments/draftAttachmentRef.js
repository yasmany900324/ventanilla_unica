import {
  ATTACHMENT_PROVIDER_LOCAL_FS,
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
} from "./incidentAttachmentTypes";

function inferLegacyProviderFromStorageKey(storageKey) {
  if (typeof storageKey !== "string" || !storageKey.trim()) {
    return ATTACHMENT_PROVIDER_VERCEL_BLOB;
  }
  const trimmed = storageKey.trim();
  if (/^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i.test(trimmed)) {
    return ATTACHMENT_PROVIDER_LOCAL_FS;
  }
  if (trimmed.includes("/")) {
    return ATTACHMENT_PROVIDER_VERCEL_BLOB;
  }
  return ATTACHMENT_PROVIDER_VERCEL_BLOB;
}

function normalizeSizeBytes(value) {
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.min(n, 50 * 1024 * 1024);
}

/**
 * Referencia mínima para operar sobre un borrador ya subido (eliminar, leer, promover).
 * @param {Record<string, unknown>} collectedData
 */
export function extractDraftAttachmentRefFromCollectedData(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  if (collectedData.photoStatus !== "provided") {
    return null;
  }
  const storageKey =
    (typeof collectedData.photoAttachmentStorageKey === "string" &&
      collectedData.photoAttachmentStorageKey.trim()) ||
    (typeof collectedData.photoAttachmentStoredFilename === "string" &&
      collectedData.photoAttachmentStoredFilename.trim()) ||
    "";
  if (!storageKey) {
    return null;
  }
  const explicit =
    typeof collectedData.photoAttachmentStorageProvider === "string"
      ? collectedData.photoAttachmentStorageProvider.trim().toLowerCase()
      : "";
  const storageProvider = explicit || inferLegacyProviderFromStorageKey(storageKey);
  const publicUrl =
    typeof collectedData.photoAttachmentPublicUrl === "string" && collectedData.photoAttachmentPublicUrl.trim()
      ? collectedData.photoAttachmentPublicUrl.trim().slice(0, 2048)
      : null;
  const mimeType =
    typeof collectedData.photoAttachmentMimeType === "string" && collectedData.photoAttachmentMimeType.trim()
      ? collectedData.photoAttachmentMimeType.trim().slice(0, 80)
      : "application/octet-stream";
  return {
    storageProvider,
    storageKey,
    publicUrl,
    mimeType,
    sizeBytes: normalizeSizeBytes(collectedData.photoAttachmentSizeBytes),
  };
}

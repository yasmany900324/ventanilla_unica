function normalizeText(value, maxLength = 2048) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function looksLikeHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function sanitizePublicPreviewUrl(value) {
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

function buildPhotoPreviewUrlWithFallback(procedureRequestId, collectedData, endpointPrefix) {
  if (!procedureRequestId || !collectedData || typeof collectedData !== "object") {
    return "";
  }
  const catalogPhoto = collectedData.photo && typeof collectedData.photo === "object" ? collectedData.photo : null;
  const catalogUrl = catalogPhoto && typeof catalogPhoto.url === "string" ? catalogPhoto.url.trim() : "";
  const publicUrl = catalogUrl || sanitizePublicPreviewUrl(collectedData.photoAttachmentPublicUrl);
  if (publicUrl) {
    return publicUrl;
  }
  const hasStoredReference = Boolean(
    (typeof collectedData.photoAttachmentStorageKey === "string" &&
      collectedData.photoAttachmentStorageKey.trim()) ||
      (typeof collectedData.photoAttachmentStoredFilename === "string" &&
        collectedData.photoAttachmentStoredFilename.trim())
  );
  if (String(collectedData.photoStatus || "").trim().toLowerCase() !== "provided" || !hasStoredReference) {
    return "";
  }
  return `${endpointPrefix}/${encodeURIComponent(procedureRequestId)}/photo`;
}

export function buildProcedurePhotoPreviewUrl(procedureRequestId, collectedData) {
  return buildPhotoPreviewUrlWithFallback(
    procedureRequestId,
    collectedData,
    "/api/funcionario/procedures/requests"
  );
}

export function buildCitizenProcedurePhotoPreviewUrl(procedureRequestId, collectedData) {
  return buildPhotoPreviewUrlWithFallback(
    procedureRequestId,
    collectedData,
    "/api/ciudadano/procedures/requests"
  );
}

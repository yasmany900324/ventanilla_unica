const IMAGE_FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
]);

const IMAGE_MIME_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/x-ms-bmp", "bmp"],
  ["image/svg+xml", "svg"],
  ["image/avif", "avif"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);

export const IMAGE_ALLOWED_EXTENSIONS = Array.from(IMAGE_FILE_EXTENSIONS);
export const IMAGE_ACCEPT_MIME_TYPES = Array.from(IMAGE_MIME_TO_EXTENSION.keys());

function normalizeMimeType(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.split(";")[0].trim().toLowerCase();
}

function extractExtension(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const lower = text.toLowerCase();
  const cleanWithoutQuery = lower.split(/[?#]/)[0];
  const fileName = cleanWithoutQuery.split("/").pop() || cleanWithoutQuery;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) {
    return "";
  }
  return fileName.slice(dotIndex + 1);
}

function looksLikeUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function looksLikeRelativeUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  const text = value.trim();
  return (
    text.startsWith("/") ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.startsWith("blob:")
  );
}

function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\/[^;]+;base64,/i.test(value.trim());
}

function hasAllowedImageExtension(value) {
  return IMAGE_FILE_EXTENSIONS.has(extractExtension(value));
}

function displayNameFromText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (isDataImageUrl(text)) {
    return "data:image";
  }
  const withoutQuery = text.split(/[?#]/)[0];
  const fileName = withoutQuery.split("/").pop() || withoutQuery;
  return fileName || text;
}

function pickObjectStringReference(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  const keys = [
    "url",
    "publicUrl",
    "photoUrl",
    "imageUrl",
    "attachmentUrl",
    "path",
    "storageKey",
    "key",
    "filename",
    "fileName",
    "name",
    "originalName",
    "photo",
    "image",
  ];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

export function getImageMimeFromExtensionOrDefault(value, fallback = "application/octet-stream") {
  const ext = extractExtension(value);
  for (const [mime, mappedExt] of IMAGE_MIME_TO_EXTENSION.entries()) {
    if (mappedExt === ext) {
      return mime;
    }
  }
  return fallback;
}

export function normalizeImageReference(value) {
  if (!value) {
    return { isValid: false, url: null, displayName: "", mimeType: "" };
  }

  const mimeFromObject = normalizeMimeType(
    typeof value === "object" && value ? value.mimeType || value.contentType : ""
  );
  const raw = typeof value === "string" ? value.trim() : pickObjectStringReference(value);
  const displayName = displayNameFromText(raw);

  if (mimeFromObject.startsWith("image/")) {
    return {
      isValid: true,
      url: looksLikeUrl(raw) || looksLikeRelativeUrl(raw) || isDataImageUrl(raw) ? raw : null,
      displayName,
      mimeType: mimeFromObject,
    };
  }

  if (!raw) {
    return { isValid: false, url: null, displayName: "", mimeType: "" };
  }

  if (isDataImageUrl(raw)) {
    return { isValid: true, url: raw, displayName, mimeType: "image/*" };
  }

  if (looksLikeUrl(raw) || looksLikeRelativeUrl(raw)) {
    if (hasAllowedImageExtension(raw)) {
      return { isValid: true, url: raw, displayName, mimeType: getImageMimeFromExtensionOrDefault(raw, "") };
    }
    return { isValid: false, url: raw, displayName, mimeType: "" };
  }

  if (hasAllowedImageExtension(raw)) {
    return { isValid: true, url: null, displayName, mimeType: getImageMimeFromExtensionOrDefault(raw, "") };
  }

  return { isValid: false, url: null, displayName, mimeType: "" };
}

export function isValidImageReference(value) {
  return normalizeImageReference(value).isValid;
}

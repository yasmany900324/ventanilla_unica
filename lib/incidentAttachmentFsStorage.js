import path from "path";

const ALLOWED_IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".avif",
  ".heic",
  ".heif",
]);

/**
 * Raíz usada en AWS Lambda / Vercel (filesystem de función): solo `/tmp` es escribible.
 * No usar `process.cwd()/data` ahí: suele resolverse a `/var/task/data` y falla con ENOENT.
 */
const TMP_ATTACHMENTS_ROOT = "/tmp/ventanilla-unica-attachments";

const CHATBOT_SUBDIR = "chatbot-procedure-photos";
const INCIDENT_SUBDIR = "procedure-attachments";

/**
 * Detecta runtimes serverless típicos donde el bundle bajo `/var/task` no admite escritura persistente.
 */
export function isServerlessFilesystem() {
  return Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.VERCEL === "1" ||
      process.env.VERCEL_ENV ||
      process.env.INCIDENT_ATTACHMENTS_USE_TMP === "1"
  );
}

/**
 * Modo efectivo para documentación / diagnóstico: `explicit` | `tmp` | `cwd_data`
 */
export function getIncidentAttachmentStorageMode() {
  const explicit =
    typeof process.env.INCIDENT_ATTACHMENT_ROOT === "string"
      ? process.env.INCIDENT_ATTACHMENT_ROOT.trim()
      : "";
  if (explicit) {
    return "explicit";
  }
  if (isServerlessFilesystem()) {
    return "tmp";
  }
  return "cwd_data";
}

/**
 * Raíz absoluta para adjuntos (borrador chat + archivos finales de incidencia).
 *
 * Prioridad:
 * 1. `INCIDENT_ATTACHMENT_ROOT` — volumen o ruta persistente (recomendado en producción real).
 * 2. Si el runtime parece serverless — `TMP_ATTACHMENTS_ROOT` (ephemeral en Lambda; válido para que no rompa).
 * 3. Desarrollo local — `{cwd}/data`.
 */
export function getIncidentAttachmentStorageRootResolved() {
  const explicit =
    typeof process.env.INCIDENT_ATTACHMENT_ROOT === "string"
      ? process.env.INCIDENT_ATTACHMENT_ROOT.trim()
      : "";
  if (explicit) {
    return path.resolve(explicit);
  }
  if (isServerlessFilesystem()) {
    return TMP_ATTACHMENTS_ROOT;
  }
  return path.join(process.cwd(), "data");
}

export function getChatbotDraftPhotoDirectory() {
  return path.join(getIncidentAttachmentStorageRootResolved(), CHATBOT_SUBDIR);
}

export function getIncidentFinalAttachmentsDirectory() {
  return path.join(getIncidentAttachmentStorageRootResolved(), INCIDENT_SUBDIR);
}

export function isSafeStoredPhotoBasename(name) {
  if (typeof name !== "string") {
    return false;
  }
  return /^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i.test(name);
}

/**
 * Resuelve la ruta absoluta del adjunto final cuando el proveedor es filesystem local
 * y la clave es el archivo `{incidentId}{ext}` bajo el directorio de adjuntos finales.
 */
export function resolveIncidentAttachmentAbsolutePath(incidentId, storageKey) {
  if (typeof incidentId !== "string" || typeof storageKey !== "string") {
    return null;
  }
  const ext = path.extname(storageKey).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    return null;
  }
  const base = path.basename(storageKey);
  if (base !== `${incidentId}${ext}`) {
    return null;
  }
  return path.join(getIncidentFinalAttachmentsDirectory(), base);
}

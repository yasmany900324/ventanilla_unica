import { createLocalFsIncidentAttachmentStorage } from "./localFsIncidentAttachmentStorage";
import { createVercelBlobIncidentAttachmentStorage } from "./vercelBlobIncidentAttachmentStorage";
import {
  ATTACHMENT_PROVIDER_LOCAL_FS,
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
} from "./incidentAttachmentTypes";

function normalizeProviderId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

/**
 * Proveedor activo para **nuevas** subidas (borrador en chat), según `ATTACHMENT_STORAGE_PROVIDER`.
 * Defecto: `vercel_blob`.
 */
export function getIncidentAttachmentStorage() {
  const p = normalizeProviderId(process.env.ATTACHMENT_STORAGE_PROVIDER) || ATTACHMENT_PROVIDER_VERCEL_BLOB;
  if (p === ATTACHMENT_PROVIDER_LOCAL_FS) {
    return createLocalFsIncidentAttachmentStorage();
  }
  return createVercelBlobIncidentAttachmentStorage();
}

/**
 * Proveedor usado para leer o promover un adjunto ya existente (sesión o fila de BD).
 * No usar solo `getIncidentAttachmentStorage()` al leer incidencias antiguas si cambiaste el env.
 *
 * @param {string|null|undefined} providerId
 */
export function getIncidentAttachmentStorageByProvider(providerId) {
  const p = normalizeProviderId(providerId) || ATTACHMENT_PROVIDER_LOCAL_FS;
  if (p === ATTACHMENT_PROVIDER_LOCAL_FS) {
    return createLocalFsIncidentAttachmentStorage();
  }
  if (p === ATTACHMENT_PROVIDER_VERCEL_BLOB) {
    return createVercelBlobIncidentAttachmentStorage();
  }
  console.warn("[attachments] Proveedor desconocido; se usa local_fs.", { providerId });
  return createLocalFsIncidentAttachmentStorage();
}

export { ATTACHMENT_PROVIDER_LOCAL_FS, ATTACHMENT_PROVIDER_VERCEL_BLOB };

/**
 * Contrato de almacenamiento de adjuntos de incidencias (borrador en chat + archivo final).
 *
 * Implementaciones de referencia:
 * - `vercel_blob` → `vercelBlobIncidentAttachmentStorage.js`
 * - `local_fs` → `localFsIncidentAttachmentStorage.js`
 *
 * Para agregar otro proveedor (S3, MinIO, Supabase Storage):
 * 1. Crear `lib/attachments/<nombre>IncidentAttachmentStorage.js` con una factory
 *    `create...IncidentAttachmentStorage()` que devuelva el mismo API que las demás:
 *    `uploadDraftAttachment`, `promoteDraftToIncident`, `deleteDraftAttachment`,
 *    `readDraftAttachmentBytes`, `readFinalIncidentBytes`.
 * 2. Registrar el id en `getIncidentAttachmentStorage.js` (`getIncidentAttachmentStorageByProvider`).
 * 3. Documentar variables en `docs/ATTACHMENT_STORAGE.md` y `.env.example`.
 *
 * Variables de entorno típicas:
 * - `ATTACHMENT_STORAGE_PROVIDER` — `vercel_blob` (defecto) | `local_fs`
 * - Vercel Blob: `BLOB_READ_WRITE_TOKEN` (en Vercel suele inyectarse al habilitar Blob)
 *
 * Objeto `draft` (borrador): `{ storageProvider, storageKey, publicUrl, mimeType, sizeBytes }`.
 */

export const ATTACHMENT_PROVIDER_VERCEL_BLOB = "vercel_blob";
export const ATTACHMENT_PROVIDER_LOCAL_FS = "local_fs";

export const INCIDENT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** MIME permitidos para la foto de incidencia (chat + ticket). */
export const INCIDENT_PHOTO_ALLOWED_MIME_TO_EXT = new Map([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

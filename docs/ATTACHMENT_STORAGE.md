# Adjuntos de incidencias (almacenamiento)

Los archivos de foto del flujo de incidencias (borrador en el chat + adjunto final del ticket) pasan por una **capa de proveedores** en `lib/attachments/`. La lógica de negocio (`lib/incidents.js`, `lib/chatbotIncidentPhotoUpload.js`, `lib/assistant/processAssistantTurn.js`) no importa `@vercel/blob` ni SDKs de terceros.

## Proveedores soportados

| Valor `ATTACHMENT_STORAGE_PROVIDER` | Uso |
|-------------------------------------|-----|
| `vercel_blob` (defecto) | Producción en Vercel / cualquier entorno con `BLOB_READ_WRITE_TOKEN`. |
| `local_fs` | Desarrollo local o servidor con disco persistente bajo `INCIDENT_ATTACHMENT_ROOT` o `data/`. |

## Variables de entorno

- `ATTACHMENT_STORAGE_PROVIDER` — `vercel_blob` \| `local_fs`
- `BLOB_READ_WRITE_TOKEN` — token de lectura/escritura del store de Vercel Blob (en Vercel se configura al crear el Blob Store).
- `ATTACHMENT_VERCEL_BLOB_ACCESS` — `public` (defecto) \| `private`. Debe coincidir con el tipo de **Blob Store** al crearlo en Vercel (público vs privado). Si el store es **privado** y no definís esta variable, `put` fallará con un error sobre “private store”.
- `VERCEL_BLOB_ACCESS` — alias opcional de `ATTACHMENT_VERCEL_BLOB_ACCESS`.

Con `private`, no se persiste URL pública en `attachment_url`: las imágenes se sirven vía `/api/incidents/.../attachment` y el preview de borrador vía `/api/chatbot/incident-photo/file` (siempre con sesión / token del servidor).
- `INCIDENT_ATTACHMENT_ROOT` — (solo `local_fs`) directorio persistente para borradores y finales.
- `INCIDENT_ATTACHMENTS_USE_TMP` — (solo `local_fs` / diagnóstico) fuerza raíz bajo `/tmp` en runtimes serverless.

## Añadir un proveedor nuevo (p. ej. S3 compatible)

1. Crear `lib/attachments/miProveedorIncidentAttachmentStorage.js` que exporte `createMiProveedorIncidentAttachmentStorage()`.
2. El objeto devuelto debe implementar el mismo contrato que `createVercelBlobIncidentAttachmentStorage()` / `createLocalFsIncidentAttachmentStorage()`:
   - `providerId` (string constante)
   - `uploadDraftAttachment({ sessionId, bytes, mimeType })` → `{ ok, storageProvider, storageKey, publicUrl, sizeBytes }` o `{ ok: false, error }`
   - `promoteDraftToIncident({ draft, incidentId })` → éxito con `storageProvider`, `storageKey`, `publicUrl`, `sizeBytes`, y **`rollbackPromotion`** async opcional para revertir si falla el `INSERT` en BD
   - `deleteDraftAttachment(draft)`
   - `readDraftAttachmentBytes(draft)` → `{ buffer, mimeType }` o `null`
   - `readFinalIncidentBytes({ incidentId, storageKey, publicUrl, mimeType })` → `{ buffer, mimeType }` o `null` (`incidentId` solo lo usa `local_fs` para validar ruta)
3. Registrar el id en `getIncidentAttachmentStorageByProvider()` en `lib/attachments/getIncidentAttachmentStorage.js`.
4. Persistir `attachment_storage_provider` en filas nuevas (ya contemplado en `ensureSchema` / `createIncident`).
5. Documentar variables en `.env.example` y en este archivo.

## Base de datos

Columnas relevantes en `incidents`:

- `attachment_storage_provider` — p. ej. `vercel_blob`, `local_fs`
- `attachment_storage_key` — clave en el proveedor (pathname en Blob, o `{id}.jpg` en local)
- `attachment_url` — URL pública opcional (p. ej. CDN de Vercel Blob); si existe, el detalle del caso puede usarla directamente en `<img>`
- `attachment_size_bytes`, `attachment_mime_type`, `attachment_original_name`, `attachment_uploaded_at`

Las filas antiguas sin `attachment_storage_provider` se interpretan como `local_fs`, salvo que `attachment_storage_key` contenga `/` (convención de pathname remoto), en cuyo caso se asume `vercel_blob`.

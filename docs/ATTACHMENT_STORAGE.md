# Adjuntos del chat (almacenamiento)

Los archivos de foto del flujo de chat (borrador del tramite y adjunto en datos recolectados) pasan por una **capa de proveedores** en `lib/attachments/`. La lógica de negocio (`lib/chatbotProcedurePhotoUpload.js`, `lib/assistant/processAssistantTurn.js`) no importa `@vercel/blob` ni SDKs de terceros.

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

Con `private`, no se persiste URL pública en el borrador: el preview se sirve vía `/api/chatbot/procedure-photo/file` (siempre con sesión / token del servidor).
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
4. Persistir metadatos de adjunto en `collectedData` del tramite.
5. Documentar variables en `.env.example` y en este archivo.

## Base de datos

Los metadatos del adjunto se guardan dentro de `collected_data_json` del tramite, usando claves como:

- `photoAttachmentStorageProvider`
- `photoAttachmentStorageKey`
- `photoAttachmentPublicUrl`
- `photoAttachmentSizeBytes`
- `photoAttachmentMimeType`
- `photoAttachmentOriginalName`
- `photoAttachmentUploadedAt`

import { randomUUID } from "crypto";
import path from "path";
import { copy, del, get, put } from "@vercel/blob";
import {
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
  INCIDENT_ATTACHMENT_MAX_BYTES,
  INCIDENT_PHOTO_ALLOWED_MIME_TO_EXT,
} from "./incidentAttachmentTypes";
import { webReadableStreamToBuffer } from "./streamToBuffer";

function sanitizePathSegment(value) {
  if (typeof value !== "string") {
    return "session";
  }
  const cleaned = value.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 80);
  return cleaned || "session";
}

export function createVercelBlobIncidentAttachmentStorage() {
  return {
    providerId: ATTACHMENT_PROVIDER_VERCEL_BLOB,

    /**
     * @param {{ sessionId: string, bytes: Buffer, mimeType: string }} params
     */
    async uploadDraftAttachment({ sessionId, bytes, mimeType }) {
      const normalizedMime = String(mimeType || "").toLowerCase().trim();
      const ext = INCIDENT_PHOTO_ALLOWED_MIME_TO_EXT.get(normalizedMime);
      if (!ext) {
        return { ok: false, error: "Tipo de archivo no permitido. Usá JPG, PNG, WebP o GIF." };
      }
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return { ok: false, error: "No se recibió ningún archivo." };
      }
      if (bytes.length > INCIDENT_ATTACHMENT_MAX_BYTES) {
        return { ok: false, error: "La imagen supera el tamaño máximo permitido (5 MB)." };
      }
      const pathname = `incident-attachments/draft/${sanitizePathSegment(sessionId)}/${randomUUID()}.${ext}`;
      try {
        const out = await put(pathname, bytes, {
          access: "public",
          addRandomSuffix: false,
          contentType: normalizedMime,
        });
        return {
          ok: true,
          storageProvider: ATTACHMENT_PROVIDER_VERCEL_BLOB,
          storageKey: out.pathname,
          publicUrl: out.url,
          sizeBytes: typeof out.size === "number" ? out.size : bytes.length,
        };
      } catch (error) {
        console.error("[vercelBlobAttachment] put falló", { pathname, message: error?.message });
        return {
          ok: false,
          error:
            "No se pudo subir la imagen al almacenamiento. Verificá la configuración del servicio o probá más tarde.",
        };
      }
    },

    /** @param {{ draft: { storageKey: string, publicUrl: string|null, mimeType: string, sizeBytes: number }, incidentId: string }} params */
    async promoteDraftToIncident({ draft, incidentId }) {
      const ext = path.extname(draft.storageKey) || ".jpg";
      const toPathname = `incident-attachments/final/${incidentId}${ext}`;
      const from = draft.publicUrl || draft.storageKey;
      let copiedUrl = "";
      try {
        const out = await copy(from, toPathname, {
          access: "public",
          addRandomSuffix: false,
          contentType: draft.mimeType || "application/octet-stream",
        });
        copiedUrl = out.url;
        await del(from);
        return {
          ok: true,
          storageProvider: ATTACHMENT_PROVIDER_VERCEL_BLOB,
          storageKey: out.pathname,
          publicUrl: out.url,
          sizeBytes: draft.sizeBytes || 0,
          rollbackPromotion: async () => {
            if (!copiedUrl) {
              return;
            }
            try {
              await del(copiedUrl);
            } catch {
              // ignore
            }
          },
        };
      } catch (error) {
        console.warn("[vercelBlobAttachment] promote falló", { incidentId, message: error?.message });
        return { ok: false, reason: "promote_failed" };
      }
    },

    /** @param {{ storageKey: string, publicUrl: string|null }} draft */
    async deleteDraftAttachment(draft) {
      const target = draft.publicUrl || draft.storageKey;
      if (!target) {
        return;
      }
      try {
        await del(target);
      } catch {
        // ignore
      }
    },

    /** @param {{ storageKey: string, publicUrl: string|null, mimeType: string }} draft */
    async readDraftAttachmentBytes(draft) {
      try {
        const res = await get(draft.publicUrl || draft.storageKey, { access: "public" });
        if (!res || res.statusCode !== 200 || !res.stream) {
          return null;
        }
        const buffer = await webReadableStreamToBuffer(res.stream);
        const mimeType = res.blob?.contentType || draft.mimeType || "application/octet-stream";
        return { buffer, mimeType };
      } catch {
        return null;
      }
    },

    /**
     * @param {{ storageKey: string, publicUrl?: string|null, mimeType?: string|null }} params
     */
    async readFinalIncidentBytes({ storageKey, publicUrl, mimeType }) {
      try {
        const res = await get(publicUrl || storageKey, { access: "public" });
        if (!res || res.statusCode !== 200 || !res.stream) {
          return null;
        }
        const buffer = await webReadableStreamToBuffer(res.stream);
        const resolvedMime =
          (typeof mimeType === "string" && mimeType.trim()) ||
          res.blob?.contentType ||
          "application/octet-stream";
        return { buffer, mimeType: resolvedMime };
      } catch {
        return null;
      }
    },
  };
}

import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  getChatbotDraftPhotoDirectory,
  getIncidentFinalAttachmentsDirectory,
  isSafeStoredPhotoBasename,
  resolveIncidentAttachmentAbsolutePath,
} from "../incidentAttachmentFsStorage";
import {
  ATTACHMENT_PROVIDER_LOCAL_FS,
  INCIDENT_ATTACHMENT_MAX_BYTES,
  INCIDENT_PHOTO_ALLOWED_MIME_TO_EXT,
} from "./incidentAttachmentTypes";

const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function createLocalFsIncidentAttachmentStorage() {
  return {
    providerId: ATTACHMENT_PROVIDER_LOCAL_FS,

    /**
     * @param {{ sessionId: string, bytes: Buffer, mimeType: string, originalName?: string }} params
     */
    async uploadDraftAttachment({ sessionId, bytes, mimeType }) {
      const ext = INCIDENT_PHOTO_ALLOWED_MIME_TO_EXT.get(String(mimeType || "").toLowerCase().trim());
      if (!ext) {
        return { ok: false, error: "Tipo de archivo no permitido. Usá JPG, PNG, WebP o GIF." };
      }
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return { ok: false, error: "No se recibió ningún archivo." };
      }
      if (bytes.length > INCIDENT_ATTACHMENT_MAX_BYTES) {
        return { ok: false, error: "La imagen supera el tamaño máximo permitido (5 MB)." };
      }
      const storageKey = `${randomUUID()}.${ext}`;
      const dir = getChatbotDraftPhotoDirectory();
      const fullPath = path.join(dir, storageKey);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(fullPath, bytes);
      } catch (error) {
        console.error("[localFsAttachment] Escritura de borrador falló", { dir, message: error?.message });
        return {
          ok: false,
          error:
            "No se pudo guardar la imagen en el servidor. Si el problema continúa, contactá al soporte o probá más tarde.",
        };
      }
      return {
        ok: true,
        storageProvider: ATTACHMENT_PROVIDER_LOCAL_FS,
        storageKey,
        publicUrl: null,
        sizeBytes: bytes.length,
      };
    },

    /** @param {{ draft: { storageKey: string, mimeType: string, sizeBytes: number }, incidentId: string }} params */
    async promoteDraftToIncident({ draft, incidentId }) {
      const chatDraftBasename = path.basename(draft.storageKey);
      if (!isSafeStoredPhotoBasename(chatDraftBasename)) {
        return { ok: false, reason: "invalid_basename" };
      }
      const extRaw = path.extname(chatDraftBasename);
      const ext = extRaw ? extRaw.toLowerCase() : "";
      if (!ALLOWED_IMAGE_EXT.has(ext)) {
        return { ok: false, reason: "bad_ext" };
      }
      const chatDir = getChatbotDraftPhotoDirectory();
      const src = path.join(chatDir, chatDraftBasename);
      const destBasename = `${incidentId}${ext}`;
      const incidentDir = getIncidentFinalAttachmentsDirectory();
      const dest = path.join(incidentDir, destBasename);
      await mkdir(incidentDir, { recursive: true });
      try {
        await rename(src, dest);
      } catch (error) {
        console.warn("[localFsAttachment] Falló el traslado del borrador al ticket.", {
          incidentId,
          chatDraftBasename,
          message: error?.message,
        });
        return { ok: false, reason: "rename_failed" };
      }
      return {
        ok: true,
        storageProvider: ATTACHMENT_PROVIDER_LOCAL_FS,
        storageKey: destBasename,
        publicUrl: null,
        sizeBytes: draft.sizeBytes || 0,
        rollbackPromotion: async () => {
          try {
            await rename(dest, src);
          } catch {
            // ignore
          }
        },
      };
    },

    /** @param {{ storageKey: string, publicUrl?: string|null }} draft */
    async deleteDraftAttachment(draft) {
      const name = path.basename(draft.storageKey);
      if (!isSafeStoredPhotoBasename(name)) {
        return;
      }
      const fullPath = path.join(getChatbotDraftPhotoDirectory(), name);
      try {
        await unlink(fullPath);
      } catch {
        // ignore
      }
    },

    /** @param {{ storageKey: string, mimeType: string }} draft */
    async readDraftAttachmentBytes(draft) {
      const name = path.basename(draft.storageKey);
      if (!isSafeStoredPhotoBasename(name)) {
        return null;
      }
      const fullPath = path.join(getChatbotDraftPhotoDirectory(), name);
      try {
        const buffer = await readFile(fullPath);
        const mimeType = draft.mimeType || "application/octet-stream";
        return { buffer, mimeType };
      } catch {
        return null;
      }
    },

    /**
     * @param {{ incidentId: string, storageKey: string, publicUrl?: string|null, mimeType?: string|null }} params
     */
    async readFinalIncidentBytes({ incidentId, storageKey, mimeType }) {
      const absolutePath = resolveIncidentAttachmentAbsolutePath(incidentId, storageKey);
      if (!absolutePath) {
        return null;
      }
      try {
        const buffer = await readFile(absolutePath);
        const resolvedMime =
          (typeof mimeType === "string" && mimeType.trim()) || "application/octet-stream";
        return { buffer, mimeType: resolvedMime };
      } catch {
        return null;
      }
    },
  };
}

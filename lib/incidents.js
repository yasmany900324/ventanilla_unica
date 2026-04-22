import { randomUUID } from "crypto";
import { ensureAuthSchema } from "./auth";
import { ensureDatabase } from "./db";
import {
  ATTACHMENT_PROVIDER_LOCAL_FS,
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
  getIncidentAttachmentStorageByProvider,
} from "./attachments/getIncidentAttachmentStorage";

const STATUS_FLOW = ["recibido", "en revision", "en proceso", "resuelto"];

export { STATUS_FLOW };

/** @deprecated Importar desde `incidentAttachmentFsStorage`. */
export { resolveIncidentAttachmentAbsolutePath } from "./incidentAttachmentFsStorage";

function mapIncidentRow(row) {
  const attachmentStorageKey = row.attachment_storage_key || null;
  const attachmentStorageProvider =
    row.attachment_storage_provider ||
    (attachmentStorageKey && String(attachmentStorageKey).includes("/")
      ? ATTACHMENT_PROVIDER_VERCEL_BLOB
      : ATTACHMENT_PROVIDER_LOCAL_FS);
  const attachmentUrl = row.attachment_url || null;
  const hasAttachment = Boolean(attachmentStorageKey);
  const attachmentImageUrl =
    typeof attachmentUrl === "string" && attachmentUrl.startsWith("http")
      ? attachmentUrl
      : hasAttachment
        ? `/api/incidents/${row.id}/attachment`
        : null;
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    description: row.description,
    location: row.location,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachmentStorageProvider,
    attachmentStorageKey,
    attachmentUrl: typeof attachmentUrl === "string" && attachmentUrl.startsWith("http") ? attachmentUrl : null,
    attachmentOriginalName: row.attachment_original_name || null,
    attachmentMimeType: row.attachment_mime_type || null,
    attachmentSizeBytes:
      typeof row.attachment_size_bytes === "number" && Number.isFinite(row.attachment_size_bytes)
        ? row.attachment_size_bytes
        : null,
    attachmentUploadedAt: row.attachment_uploaded_at || null,
    hasAttachment,
    attachmentImageUrl,
  };
}

function normalizeStatusLookupIdentifier(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function extractIncidentLookupTokens(identifier) {
  const normalized = normalizeStatusLookupIdentifier(identifier);
  if (!normalized) {
    return {
      idToken: "",
      shortToken: "",
    };
  }

  const withoutPrefix = normalized.replace(/^INC[-:#]?/u, "");
  const idToken = withoutPrefix.toLowerCase();
  const shortToken = withoutPrefix
    .replace(/[^A-F0-9]/gu, "")
    .slice(0, 8)
    .toLowerCase();

  return {
    idToken,
    shortToken,
  };
}

const ATTACHMENT_SELECT_FIELDS = `
  id,
  user_id,
  category,
  description,
  location,
  status,
  created_at,
  updated_at,
  attachment_storage_provider,
  attachment_storage_key,
  attachment_url,
  attachment_original_name,
  attachment_mime_type,
  attachment_size_bytes,
  attachment_uploaded_at
`;

/**
 * Normaliza el payload de adjunto desde el borrador del chat (nuevo + legado solo `storedFilename`).
 * @param {unknown} input
 * @returns {null|{
 *   storageProvider: string,
 *   storageKey: string,
 *   publicUrl: string|null,
 *   mimeType: string|null,
 *   sizeBytes: number,
 *   originalName: string|null,
 *   uploadedAt: Date|null
 * }}
 */
function normalizeAttachmentFromChatDraft(input) {
  if (!input || typeof input !== "object") {
    return null;
  }
  const obj = input;
  const storageKeyRaw =
    (typeof obj.storageKey === "string" && obj.storageKey.trim()) ||
    (typeof obj.storedFilename === "string" && obj.storedFilename.trim()) ||
    "";
  if (!storageKeyRaw) {
    return null;
  }
  const explicit =
    typeof obj.storageProvider === "string" && obj.storageProvider.trim()
      ? obj.storageProvider.trim().toLowerCase()
      : "";
  const storageProvider =
    explicit ||
    (/^[a-f0-9-]{36}\.[a-z0-9]{2,5}$/i.test(storageKeyRaw)
      ? ATTACHMENT_PROVIDER_LOCAL_FS
      : ATTACHMENT_PROVIDER_VERCEL_BLOB);
  const publicUrl =
    typeof obj.publicUrl === "string" && obj.publicUrl.trim().startsWith("http")
      ? obj.publicUrl.trim().slice(0, 2048)
      : null;
  const mimeType =
    typeof obj.mimeType === "string" && obj.mimeType.trim() ? obj.mimeType.trim().slice(0, 80) : null;
  const sizeBytes =
    typeof obj.sizeBytes === "number" && Number.isFinite(obj.sizeBytes) && obj.sizeBytes >= 0
      ? Math.min(obj.sizeBytes, 50 * 1024 * 1024)
      : 0;
  const originalName =
    typeof obj.originalName === "string" && obj.originalName.trim()
      ? obj.originalName.trim().slice(0, 200)
      : null;
  const rawUploaded = obj.uploadedAt;
  const parsed =
    typeof rawUploaded === "string" && rawUploaded.trim()
      ? new Date(rawUploaded.trim())
      : rawUploaded instanceof Date
        ? rawUploaded
        : new Date();
  const uploadedAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return {
    storageProvider,
    storageKey: storageKeyRaw,
    publicUrl,
    mimeType,
    sizeBytes,
    originalName,
    uploadedAt,
  };
}

export async function ensureSchema() {
  const sql = ensureDatabase();
  await ensureAuthSchema();

  await sql`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recibido',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `;

  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS user_id TEXT;
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS incidents_user_id_created_at_idx
    ON incidents (user_id, created_at DESC);
  `;

  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'incidents_user_id_fkey'
      ) THEN
        ALTER TABLE incidents
        ADD CONSTRAINT incidents_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES citizens(id)
        ON DELETE CASCADE;
      END IF;
    END $$;
  `;

  await sql`
    UPDATE incidents
    SET updated_at = created_at
    WHERE updated_at IS NULL;
  `;

  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_storage_key TEXT;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_original_name TEXT;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_mime_type TEXT;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_uploaded_at TIMESTAMPTZ;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_storage_provider TEXT;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_url TEXT;
  `;
  await sql`
    ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS attachment_size_bytes INTEGER;
  `;
}

export async function listIncidents(userId) {
  const sql = ensureDatabase();
  await ensureSchema();
  const rows = await sql`
    SELECT ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)}
    FROM incidents
    WHERE user_id = ${userId}
    ORDER BY created_at DESC;
  `;

  return rows.map((row) => mapIncidentRow(row));
}

export async function listIncidentsPaginated(
  userId,
  { page = 1, pageSize = 10 } = {}
) {
  const sql = ensureDatabase();
  await ensureSchema();

  const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
  const normalizedPageSize =
    Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 10;
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const [countRow] = await sql`
    SELECT COUNT(*)::int AS total
    FROM incidents
    WHERE user_id = ${userId};
  `;

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
  const currentPage = Math.min(normalizedPage, totalPages);
  const currentOffset = (currentPage - 1) * normalizedPageSize;

  const rows = await sql`
    SELECT ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)}
    FROM incidents
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${normalizedPageSize}
    OFFSET ${currentOffset};
  `;

  return {
    incidents: rows.map((row) => mapIncidentRow(row)),
    pagination: {
      page: currentPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
    },
  };
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.category
 * @param {string} params.description
 * @param {string} params.location
 * @param {null|{
 *   storageProvider?: string,
 *   storageKey?: string,
 *   storedFilename?: string,
 *   publicUrl?: string|null,
 *   originalName?: string,
 *   mimeType?: string,
 *   sizeBytes?: number,
 *   uploadedAt?: string|null
 * }} params.attachmentFromChatDraft
 */
export async function createIncident({
  userId,
  category,
  description,
  location,
  attachmentFromChatDraft = null,
} = {}) {
  const sql = ensureDatabase();
  const id = randomUUID();
  await ensureSchema();

  let attachmentStorageProvider = null;
  let attachmentStorageKey = null;
  let attachmentUrl = null;
  let attachmentOriginalName = null;
  let attachmentMimeType = null;
  let attachmentSizeBytes = null;
  let attachmentUploadedAt = null;
  let promoted = null;

  const draft = normalizeAttachmentFromChatDraft(attachmentFromChatDraft);
  if (draft) {
    const storage = getIncidentAttachmentStorageByProvider(draft.storageProvider);
    promoted = await storage.promoteDraftToIncident({
      draft: {
        storageProvider: draft.storageProvider,
        storageKey: draft.storageKey,
        publicUrl: draft.publicUrl,
        mimeType: draft.mimeType || "application/octet-stream",
        sizeBytes: draft.sizeBytes,
      },
      incidentId: id,
    });
    if (promoted.ok) {
      attachmentStorageProvider = promoted.storageProvider;
      attachmentStorageKey = promoted.storageKey;
      attachmentUrl =
        typeof promoted.publicUrl === "string" && promoted.publicUrl.startsWith("http")
          ? promoted.publicUrl
          : null;
      attachmentOriginalName = draft.originalName;
      attachmentMimeType = draft.mimeType;
      attachmentSizeBytes = promoted.sizeBytes || draft.sizeBytes || null;
      attachmentUploadedAt = draft.uploadedAt;
    } else {
      console.warn("[incidents] Incidencia sin adjunto: no se pudo promover el borrador.", {
        reason: promoted.reason,
        draft,
      });
    }
  }

  try {
    const [row] = await sql`
      INSERT INTO incidents (
        id,
        user_id,
        category,
        description,
        location,
        status,
        updated_at,
        attachment_storage_provider,
        attachment_storage_key,
        attachment_url,
        attachment_original_name,
        attachment_mime_type,
        attachment_size_bytes,
        attachment_uploaded_at
      )
      VALUES (
        ${id},
        ${userId},
        ${category},
        ${description},
        ${location},
        'recibido',
        NOW(),
        ${attachmentStorageProvider},
        ${attachmentStorageKey},
        ${attachmentUrl},
        ${attachmentOriginalName},
        ${attachmentMimeType},
        ${attachmentSizeBytes},
        ${attachmentUploadedAt}
      )
      RETURNING ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)};
    `;
    return mapIncidentRow(row);
  } catch (error) {
    if (promoted?.ok && typeof promoted.rollbackPromotion === "function") {
      await promoted.rollbackPromotion();
    }
    throw error;
  }
}

export async function advanceIncidentStatus(id, userId) {
  const sql = ensureDatabase();
  await ensureSchema();
  const [current] = await sql`
    SELECT ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)}
    FROM incidents
    WHERE id = ${id}
      AND user_id = ${userId}
    LIMIT 1;
  `;

  if (!current) {
    return null;
  }

  const currentIndex = STATUS_FLOW.indexOf(current.status);
  const nextIndex = Math.min(currentIndex + 1, STATUS_FLOW.length - 1);
  const nextStatus = STATUS_FLOW[nextIndex];

  const [updated] = await sql`
    UPDATE incidents
    SET status = ${nextStatus}, updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)};
  `;

  return mapIncidentRow(updated);
}

export async function findIncidentByIdentifier({ userId, identifier }) {
  const sql = ensureDatabase();
  await ensureSchema();
  const { idToken, shortToken } = extractIncidentLookupTokens(identifier);
  if (!idToken && !shortToken) {
    return null;
  }

  if (idToken) {
    const [byId] = await sql`
      SELECT ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)}
      FROM incidents
      WHERE user_id = ${userId}
        AND id = ${idToken}
      LIMIT 1;
    `;
    if (byId) {
      return mapIncidentRow(byId);
    }
  }

  if (shortToken) {
    const [byShortCode] = await sql`
      SELECT ${sql.unsafe(ATTACHMENT_SELECT_FIELDS)}
      FROM incidents
      WHERE user_id = ${userId}
        AND LOWER(LEFT(id, 8)) = ${shortToken}
      ORDER BY updated_at DESC
      LIMIT 1;
    `;
    if (byShortCode) {
      return mapIncidentRow(byShortCode);
    }
  }

  return null;
}

export async function readIncidentAttachmentForUser({ incidentId, userId }) {
  const sql = ensureDatabase();
  await ensureSchema();
  const [row] = await sql`
    SELECT
      attachment_storage_provider,
      attachment_storage_key,
      attachment_mime_type,
      attachment_url
    FROM incidents
    WHERE id = ${incidentId}
      AND user_id = ${userId}
    LIMIT 1;
  `;
  if (!row?.attachment_storage_key) {
    return null;
  }
  const provider =
    row.attachment_storage_provider ||
    (String(row.attachment_storage_key || "").includes("/")
      ? ATTACHMENT_PROVIDER_VERCEL_BLOB
      : ATTACHMENT_PROVIDER_LOCAL_FS);
  const storage = getIncidentAttachmentStorageByProvider(provider);
  const out = await storage.readFinalIncidentBytes({
    incidentId,
    storageKey: row.attachment_storage_key,
    publicUrl: row.attachment_url,
    mimeType: row.attachment_mime_type,
  });
  if (!out?.buffer) {
    return null;
  }
  return { buffer: out.buffer, mimeType: out.mimeType };
}

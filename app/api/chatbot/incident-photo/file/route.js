import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/auth";
import { getSessionSnapshot } from "../../../../../lib/chatSessionStore";
import { extractDraftAttachmentRefFromCollectedData } from "../../../../../lib/attachments/draftAttachmentRef";
import { getIncidentAttachmentStorageByProvider } from "../../../../../lib/attachments/getIncidentAttachmentStorage";
import {
  ATTACHMENT_PROVIDER_LOCAL_FS,
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
} from "../../../../../lib/attachments/incidentAttachmentTypes";
import path from "path";
import { isSafeStoredPhotoBasename } from "../../../../../lib/incidentAttachmentFsStorage";

export const runtime = "nodejs";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;

function mimeForBasename(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  return "application/octet-stream";
}

export async function GET(request) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId =
      typeof searchParams.get("sessionId") === "string" ? searchParams.get("sessionId").trim() : "";
    const legacyName =
      typeof searchParams.get("name") === "string" ? searchParams.get("name").trim() : "";

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    }

    const snapshot = await getSessionSnapshot(sessionId);
    if (!snapshot) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }
    if (snapshot.userId && snapshot.userId !== user.id) {
      return NextResponse.json({ error: "Prohibido." }, { status: 403 });
    }

    const draftRef = extractDraftAttachmentRefFromCollectedData(snapshot.collectedData || {});
    if (!draftRef) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }

    if (legacyName && legacyName !== path.basename(draftRef.storageKey)) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }

    const provider =
      draftRef.storageProvider ||
      (draftRef.storageKey.includes("/") ? ATTACHMENT_PROVIDER_VERCEL_BLOB : ATTACHMENT_PROVIDER_LOCAL_FS);
    const storage = getIncidentAttachmentStorageByProvider(provider);

    if (provider === ATTACHMENT_PROVIDER_LOCAL_FS) {
      const name = path.basename(draftRef.storageKey);
      if (!isSafeStoredPhotoBasename(name)) {
        return NextResponse.json({ error: "No encontrado." }, { status: 404 });
      }
      const stored = snapshot.collectedData?.photoAttachmentStoredFilename || "";
      if (stored && stored !== name) {
        return NextResponse.json({ error: "No encontrado." }, { status: 404 });
      }
    }

    const mimeFromSession =
      typeof snapshot.collectedData?.photoAttachmentMimeType === "string"
        ? snapshot.collectedData.photoAttachmentMimeType.trim().toLowerCase()
        : "";
    const contentType = mimeFromSession || mimeForBasename(path.basename(draftRef.storageKey));

    const bytesResult = await storage.readDraftAttachmentBytes(draftRef);
    if (!bytesResult?.buffer) {
      return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
    }

    return new NextResponse(bytesResult.buffer, {
      status: 200,
      headers: {
        "Content-Type": bytesResult.mimeType || contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo obtener el archivo." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { requireAuthenticatedUser } from "../../../../../lib/auth";
import {
  getChatbotIncidentPhotoDir,
  isSafeStoredPhotoBasename,
} from "../../../../../lib/chatbotIncidentPhotoUpload";
import { getSessionSnapshot } from "../../../../../lib/chatSessionStore";

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
  const user = await requireAuthenticatedUser(request);
  if (!user?.id) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = typeof searchParams.get("sessionId") === "string" ? searchParams.get("sessionId").trim() : "";
  const name = typeof searchParams.get("name") === "string" ? searchParams.get("name").trim() : "";

  if (!SESSION_ID_PATTERN.test(sessionId) || !isSafeStoredPhotoBasename(name)) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const snapshot = await getSessionSnapshot(sessionId);
  if (!snapshot) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  if (snapshot.userId && snapshot.userId !== user.id) {
    return NextResponse.json({ error: "Prohibido." }, { status: 403 });
  }
  const stored = snapshot.collectedData?.photoAttachmentStoredFilename || "";
  if (stored !== name) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }

  const fullPath = path.join(getChatbotIncidentPhotoDir(), name);
  const mimeFromSession =
    typeof snapshot.collectedData?.photoAttachmentMimeType === "string"
      ? snapshot.collectedData.photoAttachmentMimeType.trim().toLowerCase()
      : "";
  const contentType = mimeFromSession || mimeForBasename(name);
  try {
    const buffer = await readFile(fullPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (_error) {
    return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
  }
}

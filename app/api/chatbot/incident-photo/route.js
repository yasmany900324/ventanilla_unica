import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../lib/auth";
import { persistIncidentPhotoForChatSession } from "../../../../lib/chatbotIncidentPhotoUpload";

export const runtime = "nodejs";

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;

export async function POST(request) {
  const user = await requireAuthenticatedUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { error: "Necesitás iniciar sesión para adjuntar una imagen." },
      { status: 401 }
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (_error) {
    return NextResponse.json({ error: "Formato de solicitud inválido." }, { status: 400 });
  }

  const sessionIdRaw = formData.get("sessionId");
  const sessionId = typeof sessionIdRaw === "string" ? sessionIdRaw.trim() : "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return NextResponse.json({ error: "Identificador de sesión inválido." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "No se recibió el archivo." }, { status: 400 });
  }

  const mimeType = typeof file.type === "string" ? file.type.toLowerCase().trim() : "";
  const originalName = typeof file.name === "string" ? file.name : "";
  const preferredLocaleRaw = formData.get("preferredLocale");
  const preferredLocale = typeof preferredLocaleRaw === "string" ? preferredLocaleRaw : "";

  const bytes = Buffer.from(await file.arrayBuffer());
  const originHeader = request.headers.get("origin");
  const origin =
    typeof originHeader === "string" && originHeader.startsWith("http")
      ? originHeader
      : new URL(request.url).origin;

  const result = await persistIncidentPhotoForChatSession({
    sessionId,
    userId: user.id,
    bytes,
    mimeType,
    originalName,
    preferredLocale,
    origin,
  });

  return NextResponse.json(result.body, { status: result.status });
}

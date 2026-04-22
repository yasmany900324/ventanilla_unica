import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/auth";
import { readIncidentAttachmentForUser } from "../../../../../lib/incidents";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const incidentId = params?.id;

  if (!isUuid(incidentId)) {
    return NextResponse.json({ error: "ID de incidencia inválido." }, { status: 400 });
  }

  const authenticatedUser = await requireAuthenticatedUser(request);
  if (!authenticatedUser) {
    return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
  }

  try {
    const result = await readIncidentAttachmentForUser({
      incidentId,
      userId: authenticatedUser.id,
    });
    if (!result) {
      return NextResponse.json({ error: "Adjunto no encontrado." }, { status: 404 });
    }
    return new NextResponse(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo leer el adjunto." }, { status: 500 });
  }
}

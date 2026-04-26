import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../lib/nextAppRouteParams";
import { getProcedureRequestById, listProcedureRequestEvents } from "../../../../../../lib/procedureRequests";

export async function GET(request, { params }) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const procedureRequestId = await getAppRouteParamString(params, "id");
    if (!procedureRequestId) {
      return NextResponse.json({ error: "Identificador invalido." }, { status: 400 });
    }

    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontro el tramite." }, { status: 404 });
    }

    const ownerId = String(procedureRequest.userId || "").trim();
    const sessionUserId = String(authenticatedUser.id || "").trim();
    if (!ownerId || ownerId !== sessionUserId) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const history = await listProcedureRequestEvents(procedureRequest.id, { limit: 100 });

    return NextResponse.json({
      procedure: procedureRequest,
      history,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo cargar el tramite." }, { status: 500 });
  }
}

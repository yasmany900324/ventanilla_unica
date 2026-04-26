import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../lib/auth";
import { listProcedureRequestsForCitizen } from "../../../../../../lib/procedureRequests";

export async function GET(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") || "50", 10);
    const procedures = await listProcedureRequestsForCitizen({
      userId: authenticatedUser.id,
      limit,
    });
    return NextResponse.json({ procedures });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar la bandeja de tramites." },
      { status: 500 }
    );
  }
}

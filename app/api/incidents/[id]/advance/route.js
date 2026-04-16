import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/auth";
import { advanceIncidentStatus } from "../../../../../lib/incidents";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function PATCH(request, { params }) {
  const incidentId = params.id;

  if (!isUuid(incidentId)) {
    return NextResponse.json(
      { error: "ID de incidencia inválido." },
      { status: 400 }
    );
  }

  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const incident = await advanceIncidentStatus(incidentId, authenticatedUser.id);

    if (!incident) {
      return NextResponse.json(
        { error: "Incidencia no encontrada." },
        { status: 404 }
      );
    }

    return NextResponse.json({ incident });
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar el estado." },
      { status: 500 }
    );
  }
}

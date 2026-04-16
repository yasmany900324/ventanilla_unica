import { NextResponse } from "next/server";
import { advanceIncidentStatus } from "../../../../../lib/incidents";

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function PATCH(_request, { params }) {
  const incidentId = params.id;

  if (!isUuid(incidentId)) {
    return NextResponse.json(
      { error: "ID de incidencia inválido." },
      { status: 400 }
    );
  }

  try {
    const incident = await advanceIncidentStatus(incidentId);

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

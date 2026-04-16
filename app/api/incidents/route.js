import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/auth";
import { createIncident, listIncidents } from "../../../lib/incidents";

export async function GET(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const incidents = await listIncidents(authenticatedUser.id);
    return NextResponse.json({ incidents });
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudieron consultar las incidencias." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const body = await request.json();
    const category = body?.category?.trim();
    const description = body?.description?.trim();
    const location = body?.location?.trim();

    if (!category || !description || !location) {
      return NextResponse.json(
        { error: "category, description y location son obligatorios." },
        { status: 400 }
      );
    }

    const incident = await createIncident({
      userId: authenticatedUser.id,
      category,
      description,
      location,
    });
    return NextResponse.json({ incident }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "No se pudo crear la incidencia." },
      { status: 500 }
    );
  }
}

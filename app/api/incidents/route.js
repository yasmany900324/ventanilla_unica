import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../lib/auth";
import {
  createIncident,
  listIncidents,
  listIncidentsPaginated,
} from "../../../lib/incidents";

export async function GET(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Number.parseInt(searchParams.get("page"), 10);
    const pageSize = Number.parseInt(searchParams.get("pageSize"), 10);
    const hasPaginationParams =
      searchParams.has("page") || searchParams.has("pageSize");

    if (hasPaginationParams) {
      const normalizedPage = Number.isInteger(page) && page > 0 ? page : 1;
      const normalizedPageSize =
        Number.isInteger(pageSize) && pageSize > 0
          ? Math.min(Math.max(pageSize, 1), 50)
          : 10;
      const paginatedResult = await listIncidentsPaginated(authenticatedUser.id, {
        page: normalizedPage,
        pageSize: normalizedPageSize,
      });
      return NextResponse.json(paginatedResult);
    }

    const incidents = await listIncidents(authenticatedUser.id);
    return NextResponse.json({
      incidents,
      pagination: {
        page: 1,
        pageSize: incidents.length,
        total: incidents.length,
        totalPages: incidents.length ? 1 : 0,
      },
    });
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

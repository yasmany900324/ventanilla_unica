import { NextResponse } from "next/server";
import { requireAdministrator, listUsersForAdmin } from "../../../../lib/auth";
import { ROLES } from "../../../../lib/roles";

const ALLOWED_FILTER_ROLES = new Set(["all", ROLES.CITIZEN, ROLES.AGENT, ROLES.ADMIN]);

export async function GET(request) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const search = String(searchParams.get("search") || "").trim();
    const role = String(searchParams.get("role") || "all").trim().toLowerCase();
    const limit = Number.parseInt(searchParams.get("limit") || "200", 10);
    if (!ALLOWED_FILTER_ROLES.has(role)) {
      return NextResponse.json({ error: "El filtro de rol no es válido." }, { status: 400 });
    }
    const users = await listUsersForAdmin({
      search,
      role,
      limit,
    });
    return NextResponse.json({ ok: true, users });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo cargar el listado de usuarios." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireAdministrator, updateUserRolesByAdministrator } from "../../../../../../lib/auth";
import { ROLES } from "../../../../../../lib/roles";

const ALLOWED_ROLES = new Set([ROLES.CITIZEN, ROLES.AGENT, ROLES.ADMIN]);

export async function PATCH(request, { params }) {
  try {
    const { id: targetUserIdFromRoute } = await params;
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }
    const incomingRoles = Array.isArray(body?.roles)
      ? body.roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean)
      : null;
    if (!incomingRoles) {
      return NextResponse.json({ error: "Debes enviar roles como arreglo." }, { status: 400 });
    }
    if (!incomingRoles.every((role) => ALLOWED_ROLES.has(role))) {
      return NextResponse.json({ error: "Hay uno o más roles inválidos." }, { status: 400 });
    }

    const result = await updateUserRolesByAdministrator({
      adminUserId: administrator.id,
      targetUserId: targetUserIdFromRoute,
      roles: incomingRoles,
    });
    if (!result?.ok) {
      return NextResponse.json(
        { error: result?.error || "No se pudieron actualizar los roles." },
        { status: result?.status || 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      unchanged: result.unchanged === true,
      user: result.user,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudieron actualizar los roles del usuario." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireAdministrator, updateUserRoleByAdministrator } from "../../../../../../../lib/auth";
import { ROLES } from "../../../../../../../lib/roles";

const ALLOWED_ROLES = new Set([ROLES.CITIZEN, ROLES.AGENT, ROLES.ADMIN]);

export async function PATCH(request, { params }) {
  try {
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
    const nextRole = String(body?.role || "").trim().toLowerCase();
    if (!ALLOWED_ROLES.has(nextRole)) {
      return NextResponse.json({ error: "El rol informado no es válido." }, { status: 400 });
    }

    const result = await updateUserRoleByAdministrator({
      adminUserId: administrator.id,
      targetUserId: params?.id,
      nextRole,
    });
    if (!result?.ok) {
      return NextResponse.json(
        { error: result?.error || "No se pudo actualizar el rol." },
        { status: result?.status || 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      unchanged: result.unchanged === true,
      user: result.user,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo actualizar el rol del usuario." }, { status: 500 });
  }
}

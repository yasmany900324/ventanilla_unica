import { NextResponse } from "next/server";
import {
  requireBackofficeUser,
  userHasRole,
} from "../../../../../lib/auth";
import { ROLES } from "../../../../../lib/roles";
import { getAppRouteParamString } from "../../../../../lib/nextAppRouteParams";
import { canAccessProcedureRequestStrict } from "../../../../../lib/procedureRequestInboxDetail";
import { getProcedureRequestById } from "../../../../../lib/procedureRequests";
import { deleteProcedureRequestSafely } from "../../../../../lib/camunda/deleteProcedureRequestSafely";

export async function DELETE(request, { params }) {
  try {
    const actor = await requireBackofficeUser(request);
    if (!actor) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json(
        { ok: true, alreadyDeleted: true, message: "El expediente ya no existe." },
        { status: 200 }
      );
    }
    const isAdmin = userHasRole(actor, ROLES.ADMIN);
    if (!isAdmin && !canAccessProcedureRequestStrict(actor.id, procedureRequest)) {
      return NextResponse.json(
        { error: "No tienes permisos para eliminar este expediente." },
        { status: 403 }
      );
    }
    const result = await deleteProcedureRequestSafely({
      procedureRequestId: procedureRequest.id,
      actorId: actor.id || null,
    });
    if (!result?.ok) {
      if (result.reason === "delete_in_progress") {
        return NextResponse.json(
          { error: "La eliminación del expediente ya está en curso." },
          { status: 409 }
        );
      }
      if (result.reason === "camunda_delete_failed") {
        return NextResponse.json(
          {
            error: "No se pudo eliminar la instancia en Camunda. El expediente no fue eliminado.",
            technicalDetails: { reason: result.reason, processInstanceKey: result.processInstanceKey || null, detail: result.error || null },
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "No se pudo eliminar el expediente.",
          technicalDetails: { reason: result.reason || "delete_failed", detail: result.error || null },
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      deleted: result.deleted === true,
      alreadyDeleted: result.alreadyDeleted === true,
      message: "Expediente eliminado correctamente.",
      redirectTo: "/funcionario/dashboard",
    });
  } catch (error) {
    console.error("[funcionario/delete-expediente] unexpected error", {
      message: error?.message || null,
    });
    return NextResponse.json({ error: "No se pudo eliminar el expediente." }, { status: 500 });
  }
}

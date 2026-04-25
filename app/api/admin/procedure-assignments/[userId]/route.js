import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../lib/auth";
import { hasDatabase } from "../../../../../lib/db";
import { updateProcedureAssignmentsForAgent } from "../../../../../lib/procedureAssignments";

export async function PATCH(request, { params }) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json(
        { error: "La asignación de procedimientos requiere base de datos configurada." },
        { status: 503 }
      );
    }

    const { userId } = await params;
    const targetUserId = String(userId || "").trim();
    if (!targetUserId) {
      return NextResponse.json({ error: "El userId es obligatorio." }, { status: 400 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }
    if (!Array.isArray(body?.procedureTypeIds)) {
      return NextResponse.json({ error: "procedureTypeIds debe ser un arreglo." }, { status: 400 });
    }

    const result = await updateProcedureAssignmentsForAgent({
      adminUserId: administrator.id,
      agentUserId: targetUserId,
      procedureTypeIds: body.procedureTypeIds,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }

    return NextResponse.json({
      ok: true,
      previousProcedureTypeIds: result.previousProcedureTypeIds,
      newProcedureTypeIds: result.newProcedureTypeIds,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudieron actualizar las asignaciones del funcionario." },
      { status: 500 }
    );
  }
}

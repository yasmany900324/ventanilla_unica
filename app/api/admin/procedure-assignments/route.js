import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../lib/auth";
import { hasDatabase } from "../../../../lib/db";
import { listProcedureAssignmentsForAdmin } from "../../../../lib/procedureAssignments";

export async function GET(request) {
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

    const data = await listProcedureAssignmentsForAdmin();
    return NextResponse.json({
      ok: true,
      agents: data.agents,
      procedureTypes: data.procedureTypes,
      assignmentsByUserId: data.assignmentsByUserId,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudieron cargar las asignaciones de procedimientos." },
      { status: 500 }
    );
  }
}

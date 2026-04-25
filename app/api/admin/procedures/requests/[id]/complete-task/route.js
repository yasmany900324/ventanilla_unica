import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../../lib/auth";
import {
  CompleteProcedureTaskError,
  completeProcedureTaskFromBackoffice,
} from "../../../../../../../lib/camunda/completeProcedureTaskFromBackoffice";

export async function POST(request, { params }) {
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
    const result = await completeProcedureTaskFromBackoffice({
      procedureRequestId: params?.id,
      collectedData: body?.collectedData && typeof body.collectedData === "object" ? body.collectedData : {},
      nextLocalStatus:
        typeof body?.nextStatus === "string" && body.nextStatus.trim()
          ? body.nextStatus.trim().slice(0, 80)
          : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CompleteProcedureTaskError) {
      return NextResponse.json(
        { error: error.message, details: error.details || {} },
        { status: error.status || 400 }
      );
    }
    return NextResponse.json({ error: "No se pudo completar la tarea en Camunda." }, { status: 500 });
  }
}

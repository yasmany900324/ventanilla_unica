import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../../../lib/auth";
import {
  CompleteProcedureTaskError,
  completeProcedureTaskFromBackoffice,
} from "../../../../../../../lib/camunda/completeProcedureTaskFromBackoffice";
import { canAccessProcedureRequestStrict } from "../../../../../../../lib/procedureRequestInboxDetail";
import { getProcedureRequestById } from "../../../../../../../lib/procedureRequests";

export async function POST(request, { params }) {
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!funcionario?.id) {
      return NextResponse.json({ error: "Actor no válido." }, { status: 403 });
    }
    const procedureRequest = await getProcedureRequestById(params?.id);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    if (!canAccessProcedureRequestStrict(funcionario.id, procedureRequest)) {
      return NextResponse.json(
        { error: "No tienes permisos para modificar este expediente." },
        { status: 403 }
      );
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
      expectedTaskDefinitionKey:
        typeof body?.expectedTaskDefinitionKey === "string" && body.expectedTaskDefinitionKey.trim()
          ? body.expectedTaskDefinitionKey.trim().slice(0, 160)
          : null,
      idempotencyKey:
        typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 240)
          : null,
      actorId: funcionario?.id || null,
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

import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../../lib/auth";
import { retryProcedureCamundaSync } from "../../../../../../../lib/camunda/syncLocalCaseToCamunda";

export async function POST(request, { params }) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!administrator?.id) {
      return NextResponse.json({ error: "Actor no válido." }, { status: 403 });
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }
    const result = await retryProcedureCamundaSync({
      procedureRequestId: params?.id,
      actorId: administrator?.id || null,
      idempotencyKey:
        typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 240)
          : null,
    });
    if (!result?.ok) {
      const reason = String(result?.reason || "retry_failed");
      if (reason === "procedure_not_found") {
        return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
      }
      if (reason === "camunda_instance_already_exists") {
        return NextResponse.json(
          {
            error: "El expediente ya tiene una instancia Camunda asociada.",
            processInstanceKey: result.processInstanceKey || null,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "No se pudo reintentar la sincronización con Camunda.",
          details: result,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo reintentar la sincronización con Camunda." },
      { status: 500 }
    );
  }
}

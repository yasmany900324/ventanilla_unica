import { NextResponse } from "next/server";
import { syncProcedureRequestStateFromCamunda } from "../../../../lib/camunda/syncProcedureStateFromCamunda";

function isAuthorized(request) {
  const configured = String(process.env.CAMUNDA_WEBHOOK_SECRET || "").trim();
  if (!configured) {
    return false;
  }
  const received = String(request.headers.get("x-camunda-webhook-secret") || "").trim();
  return configured === received;
}

export async function POST(request) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    let body = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }
    const procedureRequestId = String(body?.procedureRequestId || "").trim();
    if (!procedureRequestId) {
      return NextResponse.json({ error: "procedureRequestId es obligatorio." }, { status: 400 });
    }
    const out = await syncProcedureRequestStateFromCamunda({
      procedureRequestId,
      actorId: "system",
      sourceEventId:
        typeof body?.eventId === "string" && body.eventId.trim()
          ? body.eventId.trim().slice(0, 240)
          : null,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo procesar el webhook de Camunda." }, { status: 500 });
  }
}

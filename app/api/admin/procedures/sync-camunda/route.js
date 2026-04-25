import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../lib/auth";
import {
  runProcedureCamundaAutoRetries,
  runProcedureCamundaSyncPolling,
  syncProcedureRequestStateFromCamunda,
} from "../../../../../lib/camunda/syncProcedureStateFromCamunda";

export async function POST(request) {
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
    const mode = String(body?.mode || "all").trim().toLowerCase();
    const limit = Number.parseInt(body?.limit || "100", 10);
    const procedureRequestId = String(body?.procedureRequestId || "").trim();

    if (procedureRequestId) {
      const out = await syncProcedureRequestStateFromCamunda({
        procedureRequestId,
        actorId: administrator.id,
        sourceEventId:
          typeof body?.eventId === "string" && body.eventId.trim()
            ? body.eventId.trim().slice(0, 240)
            : `manual-sync:${procedureRequestId}:${Date.now()}`,
      });
      return NextResponse.json({ ok: true, mode: "single", ...out });
    }

    if (mode === "poll") {
      const poll = await runProcedureCamundaSyncPolling({
        limit,
        actorId: administrator.id,
      });
      return NextResponse.json({ ok: true, mode, ...poll });
    }
    if (mode === "retry") {
      const retry = await runProcedureCamundaAutoRetries({
        limit: Math.min(limit, 50),
        actorId: administrator.id,
      });
      return NextResponse.json({ ok: true, mode, ...retry });
    }
    const [poll, retry] = await Promise.all([
      runProcedureCamundaSyncPolling({
        limit,
        actorId: administrator.id,
      }),
      runProcedureCamundaAutoRetries({
        limit: Math.min(limit, 50),
        actorId: administrator.id,
      }),
    ]);
    return NextResponse.json({
      ok: true,
      mode: "all",
      polling: poll,
      retries: retry,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo sincronizar estados de Camunda." }, { status: 500 });
  }
}

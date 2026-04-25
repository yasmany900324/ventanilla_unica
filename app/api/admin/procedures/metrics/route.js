import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../lib/auth";
import { getProcedureMetricsSummary } from "../../../../../lib/procedureRequests";

export async function GET(request) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const days = Number.parseInt(searchParams.get("days") || "7", 10);
    const metrics = await getProcedureMetricsSummary({ days });
    return NextResponse.json({ ok: true, metrics });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudieron cargar las métricas de procedimientos." },
      { status: 500 }
    );
  }
}

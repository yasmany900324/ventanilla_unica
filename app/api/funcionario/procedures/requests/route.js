import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../lib/auth";
import { enrichProcedureRequestsForInbox } from "../../../../../lib/procedureRequestInboxListHelpers";
import {
  listProcedureRequestsForFuncionarioInbox,
  releaseExpiredProcedureTaskClaims,
} from "../../../../../lib/procedureRequests";

export async function GET(request) {
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") || "100", 10);
    await releaseExpiredProcedureTaskClaims();
    const procedures = await listProcedureRequestsForFuncionarioInbox({
      funcionarioUserId: funcionario.id,
      limit,
    });
    const enriched = await enrichProcedureRequestsForInbox(procedures);
    return NextResponse.json({ procedures: enriched });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el listado de expedientes de procedimientos." },
      { status: 500 }
    );
  }
}

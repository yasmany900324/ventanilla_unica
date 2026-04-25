import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../lib/auth";
import { getActiveTaskForProcedure } from "../../../../../../lib/camunda/getActiveTaskForProcedure";
import {
  getProcedureRequestById,
  listProcedureRequestEvents,
} from "../../../../../../lib/procedureRequests";

export async function GET(request, { params }) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const procedureRequest = await getProcedureRequestById(params?.id);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    const [events, activeTask] = await Promise.all([
      listProcedureRequestEvents(procedureRequest.id, { limit: 200 }),
      getActiveTaskForProcedure(procedureRequest.id).catch(() => null),
    ]);
    return NextResponse.json({
      procedureRequest,
      activeTask,
      history: events,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el detalle del expediente." },
      { status: 500 }
    );
  }
}

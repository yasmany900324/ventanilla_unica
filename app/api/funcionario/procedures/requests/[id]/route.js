import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../../lib/auth";
import { getActiveTaskForProcedure } from "../../../../../../lib/camunda/getActiveTaskForProcedure";
import { getProcedureCatalogEntryById } from "../../../../../../lib/procedureCatalog";
import {
  buildAvailableActions,
  canAccessProcedureRequestStrict,
  resolveTaskDisplayConfig,
} from "../../../../../../lib/procedureRequestInboxDetail";
import {
  getProcedureRequestById,
  listProcedureRequestEvents,
} from "../../../../../../lib/procedureRequests";

export async function GET(request, { params }) {
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const procedureRequest = await getProcedureRequestById(params?.id);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    if (!canAccessProcedureRequestStrict(funcionario.id, procedureRequest)) {
      return NextResponse.json(
        { error: "No tienes permisos para ver este expediente." },
        { status: 403 }
      );
    }
    const [events, activeTask] = await Promise.all([
      listProcedureRequestEvents(procedureRequest.id, { limit: 200 }),
      getActiveTaskForProcedure(procedureRequest.id).catch(() => null),
    ]);
    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;
    return NextResponse.json({
      procedureRequest: {
        ...procedureRequest,
        assignedToUserId: procedureRequest.assignedToUserId || null,
      },
      activeTask,
      activeTaskDisplay: resolveTaskDisplayConfig({ activeTask, procedureType }),
      history: events,
      procedureType,
      availableActions: buildAvailableActions({
        procedureRequest,
        activeTask,
        procedureType,
        actorId: funcionario.id,
        requestsApiSegment: "funcionario",
        includeClaimTask: false,
      }),
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el detalle del expediente." },
      { status: 500 }
    );
  }
}

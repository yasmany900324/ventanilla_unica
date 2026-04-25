import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../lib/nextAppRouteParams";
import { getActiveTaskForProcedure } from "../../../../../../lib/camunda/getActiveTaskForProcedure";
import { getProcedureCatalogEntryById } from "../../../../../../lib/procedureCatalog";
import {
  buildAvailableActions,
  canAccessProcedureRequestLax,
  resolveTaskDisplayConfig,
} from "../../../../../../lib/procedureRequestInboxDetail";
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
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    if (!canAccessProcedureRequestLax(administrator.id, procedureRequest)) {
      return NextResponse.json(
        { error: "No tienes permisos para ver este expediente asignado a otro funcionario." },
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
        actorId: administrator.id,
        requestsApiSegment: "admin",
        includeClaimTask: true,
      }),
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el detalle del expediente." },
      { status: 500 }
    );
  }
}

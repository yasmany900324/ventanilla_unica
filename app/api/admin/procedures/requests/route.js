import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../lib/auth";
import { getActiveTaskForProcedure } from "../../../../../lib/camunda/getActiveTaskForProcedure";
import {
  listProcedureRequestsForAdmin,
  releaseExpiredProcedureTaskClaims,
} from "../../../../../lib/procedureRequests";

function buildPendingAction(procedureRequest) {
  if (procedureRequest.camundaError) {
    return "Reintentar sincronización Camunda";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    if (procedureRequest.taskAssigneeId) {
      return `Tarea ${procedureRequest.currentTaskDefinitionKey} asignada a ${procedureRequest.taskAssigneeId}`;
    }
    return `Reclamar tarea ${procedureRequest.currentTaskDefinitionKey}`;
  }
  return "Sin acción pendiente";
}

export async function GET(request) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") || "100", 10);
    await releaseExpiredProcedureTaskClaims();
    const procedures = await listProcedureRequestsForAdmin({ limit });
    const enriched = await Promise.all(
      procedures.map(async (procedureRequest) => {
        const activeTask =
          procedureRequest.camundaProcessInstanceKey && !procedureRequest.currentTaskDefinitionKey
            ? await getActiveTaskForProcedure(procedureRequest.id).catch(() => null)
            : null;
        return {
          ...procedureRequest,
          hasCamundaError: Boolean(procedureRequest.camundaError),
          pendingAction: buildPendingAction({
            ...procedureRequest,
            currentTaskDefinitionKey:
              activeTask?.taskDefinitionKey || procedureRequest.currentTaskDefinitionKey || null,
          }),
          activeTask: activeTask || null,
        };
      })
    );
    return NextResponse.json({ procedures: enriched });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el listado de expedientes de procedimientos." },
      { status: 500 }
    );
  }
}

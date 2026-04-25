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

function buildCamundaStatusLabel(camundaStatus) {
  if (camundaStatus === "ERROR_SYNC") {
    return "Error de sincronización";
  }
  if (camundaStatus === "TASK_ACTIVE") {
    return "Pendiente de revisión";
  }
  if (camundaStatus === "PROCESS_RUNNING") {
    return "En proceso";
  }
  return "Sin tarea activa";
}

function buildCamundaStatus(procedureRequest) {
  if (procedureRequest.camundaError) {
    return "ERROR_SYNC";
  }
  if (procedureRequest.currentTaskDefinitionKey) {
    return "TASK_ACTIVE";
  }
  if (procedureRequest.camundaProcessInstanceKey) {
    return "PROCESS_RUNNING";
  }
  return "NOT_SYNCED";
}

export async function GET(request) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") || "100", 10);
    const scope = String(searchParams.get("scope") || "all").trim().toLowerCase();
    await releaseExpiredProcedureTaskClaims();
    const procedures = await listProcedureRequestsForAdmin({
      limit,
      assignmentScope: scope,
      requesterUserId: administrator.id,
    });
    const enriched = await Promise.all(
      procedures.map(async (procedureRequest) => {
        const activeTask =
          procedureRequest.camundaProcessInstanceKey && !procedureRequest.currentTaskDefinitionKey
            ? await getActiveTaskForProcedure(procedureRequest.id).catch(() => null)
            : null;
        const currentTaskDefinitionKey =
          activeTask?.taskDefinitionKey || procedureRequest.currentTaskDefinitionKey || null;
        const camundaStatus = buildCamundaStatus({
          ...procedureRequest,
          currentTaskDefinitionKey,
        });
        return {
          ...procedureRequest,
          assignedToUserId: procedureRequest.assignedToUserId || null,
          hasCamundaError: Boolean(procedureRequest.camundaError),
          camundaStatus,
          camundaStatusLabel: buildCamundaStatusLabel(camundaStatus),
          pendingAction: buildPendingAction({
            ...procedureRequest,
            currentTaskDefinitionKey,
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

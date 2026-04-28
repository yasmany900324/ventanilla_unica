import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { getLiveCamundaTaskSnapshot } from "../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { CamundaClientError, claimCamundaUserTask } from "../../../../../../../lib/camunda/client";
import { sanitizeForLogs } from "../../../../../../../lib/logging/sanitizeForLogs";
import { getProcedureRequestById } from "../../../../../../../lib/procedureRequests";

const ENDPOINT_ACTION = "FUNCIONARIO_CLAIM_CAMUNDA_TASK";

export async function POST(request, { params }) {
  let procedureRequestIdForLogs = null;
  let funcionarioIdForLogs = null;
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario?.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const funcionarioId = String(funcionario.id).trim();
    funcionarioIdForLogs = funcionarioId;
    const procedureRequestId = await getAppRouteParamString(params, "id");
    procedureRequestIdForLogs = procedureRequestId;
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    if (String(procedureRequest.assignedToUserId || "").trim() !== funcionarioId) {
      return NextResponse.json(
        { error: "Debes tomar el expediente localmente antes de reclamar la tarea de Camunda." },
        { status: 409 }
      );
    }

    const beforeSnapshot = await getLiveCamundaTaskSnapshot({
      procedureRequest,
      actorId: funcionarioId,
    });
    const activeTask = beforeSnapshot?.activeTask?.exists ? beforeSnapshot.activeTask : null;
    if (!activeTask?.id) {
      return NextResponse.json(
        { error: "No hay tarea activa para reclamar en Camunda." },
        { status: 409 }
      );
    }
    const assigneeBefore = String(activeTask.assignee || "").trim() || null;
    if (assigneeBefore && assigneeBefore !== funcionarioId) {
      return NextResponse.json(
        { error: "La tarea activa ya está asignada a otro funcionario." },
        { status: 409 }
      );
    }
    if (assigneeBefore === funcionarioId) {
      console.info(
        "[procedure-claim-camunda]",
        sanitizeForLogs({
          endpointAction: ENDPOINT_ACTION,
          procedureRequestId: procedureRequestIdForLogs,
          processInstanceKey: beforeSnapshot?.process?.instanceKey || null,
          activeTaskId: activeTask.id || null,
          userTaskKey: activeTask.userTaskKey || null,
          activeTaskDefinitionKey: activeTask.taskDefinitionKey || null,
          funcionarioId,
          assigneeBefore,
          assigneeAfter: assigneeBefore,
          camundaResponse: { status: "ok", result: "idempotent" },
        })
      );
      return NextResponse.json({
        ok: true,
        idempotent: true,
        message: "La tarea ya estaba asignada a tu usuario.",
      });
    }

    await claimCamundaUserTask(activeTask.id, funcionarioId);
    const afterSnapshot = await getLiveCamundaTaskSnapshot({
      procedureRequest,
      actorId: funcionarioId,
    });
    const assigneeAfter = String(afterSnapshot?.activeTask?.assignee || "").trim() || null;

    console.info(
      "[procedure-claim-camunda]",
      sanitizeForLogs({
        endpointAction: ENDPOINT_ACTION,
        procedureRequestId: procedureRequestIdForLogs,
        processInstanceKey: beforeSnapshot?.process?.instanceKey || null,
        activeTaskId: activeTask.id || null,
        userTaskKey: activeTask.userTaskKey || null,
        activeTaskDefinitionKey: activeTask.taskDefinitionKey || null,
        funcionarioId,
        assigneeBefore,
        assigneeAfter,
        camundaResponse: { status: "ok", result: "claimed" },
      })
    );

    return NextResponse.json({
      ok: true,
      idempotent: false,
      message: "Tarea de Camunda reclamada correctamente.",
      snapshot: afterSnapshot,
    });
  } catch (error) {
    if (error instanceof CamundaClientError) {
      const status = Number(error.status || 0);
      const responseStatus = status === 409 ? 409 : status === 400 ? 400 : 502;
      console.info(
        "[procedure-claim-camunda]",
        sanitizeForLogs({
          endpointAction: ENDPOINT_ACTION,
          procedureRequestId: procedureRequestIdForLogs,
          processInstanceKey: null,
          activeTaskId: null,
          userTaskKey: null,
          activeTaskDefinitionKey: null,
          funcionarioId: funcionarioIdForLogs,
          assigneeBefore: null,
          assigneeAfter: null,
          camundaResponse: {
            status: responseStatus,
            result: "error",
            detail: String(error.message || "camunda_error").slice(0, 300),
          },
        })
      );
      return NextResponse.json(
        { error: "No se pudo reclamar la tarea activa en Camunda." },
        { status: responseStatus }
      );
    }
    return NextResponse.json(
      { error: "No se pudo reclamar la tarea activa en Camunda." },
      { status: 500 }
    );
  }
}

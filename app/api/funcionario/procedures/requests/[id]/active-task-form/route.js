import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { getLiveCamundaTaskSnapshot } from "../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { getCamundaUserTaskForm } from "../../../../../../../lib/camunda/client";
import { canAccessProcedureRequestStrict } from "../../../../../../../lib/procedureRequestInboxDetail";
import { getProcedureRequestById } from "../../../../../../../lib/procedureRequests";

function buildActiveTaskPayload(activeTask) {
  return {
    id: activeTask?.id || activeTask?.taskId || null,
    userTaskKey: activeTask?.userTaskKey || activeTask?.id || null,
    taskDefinitionKey: activeTask?.taskDefinitionKey || null,
    name: activeTask?.name || null,
    assignee: activeTask?.assignee ?? null,
  };
}

export async function GET(request, { params }) {
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario?.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    if (!canAccessProcedureRequestStrict(funcionario.id, procedureRequest)) {
      return NextResponse.json(
        {
          error: "No tienes permisos para ver este expediente.",
        },
        { status: 403 }
      );
    }
    const snapshot = await getLiveCamundaTaskSnapshot({
      procedureRequest,
      actorId: funcionario.id,
    });
    const activeTask = snapshot?.activeTask?.exists ? snapshot.activeTask : null;
    if (!activeTask) {
      return NextResponse.json({
        status: "no_active_task",
        procedureRequestId,
        activeTask: null,
        form: null,
        message: "No hay una tarea activa en Camunda para este expediente.",
      });
    }
    const userTaskKey = String(activeTask.userTaskKey || activeTask.id || "").trim();
    if (!userTaskKey) {
      return NextResponse.json({
        status: "error",
        procedureRequestId,
        activeTask: buildActiveTaskPayload(activeTask),
        form: null,
        message: "No se pudo obtener el formulario asociado a la tarea activa.",
      });
    }
    const formResult = await getCamundaUserTaskForm(userTaskKey);
    if (formResult.status === "ok") {
      return NextResponse.json({
        status: "ok",
        procedureRequestId,
        activeTask: buildActiveTaskPayload(activeTask),
        form: formResult.form,
        message: null,
      });
    }
    if (formResult.status === "no_form") {
      return NextResponse.json({
        status: "no_form",
        procedureRequestId,
        activeTask: buildActiveTaskPayload(activeTask),
        form: null,
        message: "Esta tarea no tiene formulario asociado en Camunda.",
      });
    }
    return NextResponse.json({
      status: "error",
      procedureRequestId,
      activeTask: buildActiveTaskPayload(activeTask),
      form: null,
      message: "No se pudo obtener el formulario asociado a la tarea activa.",
    });
  } catch (_error) {
    return NextResponse.json(
      {
        status: "error",
        message: "No se pudo obtener el formulario asociado a la tarea activa.",
      },
      { status: 500 }
    );
  }
}

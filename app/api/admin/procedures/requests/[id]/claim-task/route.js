import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../../lib/auth";
import { claimProcedureTask } from "../../../../../../../lib/procedureRequests";
import { getActiveTaskForProcedure } from "../../../../../../../lib/camunda/getActiveTaskForProcedure";
import { claimCamundaUserTask } from "../../../../../../../lib/camunda/client";

export async function POST(request, { params }) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!administrator?.id) {
      return NextResponse.json({ error: "Actor no válido." }, { status: 403 });
    }
    const procedureRequestId = params?.id;
    const activeTask = await getActiveTaskForProcedure(procedureRequestId);
    if (!activeTask) {
      return NextResponse.json(
        { error: "No hay tarea activa para reclamar en este expediente." },
        { status: 409 }
      );
    }
    const claimResult = await claimProcedureTask({
      procedureRequestId,
      actorId: administrator.id,
      expectedTaskDefinitionKey: activeTask.taskDefinitionKey,
    });
    if (!claimResult?.ok) {
      return NextResponse.json(
        { error: "No se pudo reclamar la tarea. Ya fue tomada o cambió.", details: claimResult },
        { status: 409 }
      );
    }
    try {
      await claimCamundaUserTask(activeTask.taskId, administrator.id);
    } catch (_error) {
      // best effort; local lock already prevents double completion.
    }
    return NextResponse.json({
      ok: true,
      procedureRequest: claimResult.procedureRequest,
      activeTask,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo reclamar la tarea." }, { status: 500 });
  }
}

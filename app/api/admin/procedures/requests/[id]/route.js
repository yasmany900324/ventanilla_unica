import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../lib/nextAppRouteParams";
import { getLiveCamundaTaskSnapshot } from "../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
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

function mapOperationalActions({ snapshotActions, legacyActions }) {
  const byLegacyKey = new Map(
    legacyActions
      .filter((item) => item?.actionKey)
      .map((item) => [String(item.actionKey || "").trim().toLowerCase(), item])
  );
  return snapshotActions.map((actionItem) => {
    const action = String(actionItem?.action || "").trim().toUpperCase();
    const out = {
      action,
      enabled: actionItem?.enabled === true,
      reason: actionItem?.reason || null,
    };
    if (action === "CLAIM_TASK") {
      const legacy = byLegacyKey.get("claim_task");
      if (legacy?.endpoint) {
        out.endpoint = legacy.endpoint;
        out.method = legacy.method || "POST";
      }
    }
    if (action === "COMPLETE_TASK") {
      const legacy = byLegacyKey.get("complete_task");
      if (legacy?.endpoint) {
        out.endpoint = legacy.endpoint;
        out.method = legacy.method || "POST";
        out.expectedTaskDefinitionKey = legacy.expectedTaskDefinitionKey || null;
        out.requiredVariables = Array.isArray(legacy.requiredVariables)
          ? legacy.requiredVariables
          : [];
        out.description = legacy.description || "";
        out.displayLabel = legacy.displayLabel || "Completar tarea";
      }
    }
    return out;
  });
}

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
    const [events, liveSnapshot] = await Promise.all([
      listProcedureRequestEvents(procedureRequest.id, { limit: 200 }),
      getLiveCamundaTaskSnapshot({
        procedureRequest,
        actorId: administrator.id,
      }),
    ]);
    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;
    const normalizedActiveTask = liveSnapshot?.activeTask?.exists
      ? {
          taskId: liveSnapshot.activeTask.id,
          taskDefinitionKey: liveSnapshot.activeTask.taskDefinitionKey,
          name: liveSnapshot.activeTask.name,
          assignee: liveSnapshot.activeTask.assignee,
          state: liveSnapshot.activeTask.state,
          createdAt: liveSnapshot.activeTask.createdAt,
        }
      : null;
    const legacyAvailableActions = buildAvailableActions({
      procedureRequest,
      activeTask: normalizedActiveTask,
      procedureType,
      actorId: administrator.id,
      requestsApiSegment: "admin",
      includeClaimTask: true,
    });
    const operationalActions = mapOperationalActions({
      snapshotActions: Array.isArray(liveSnapshot?.availableActions)
        ? liveSnapshot.availableActions
        : [],
      legacyActions: legacyAvailableActions,
    });
    return NextResponse.json({
      localCase: {
        ...procedureRequest,
        assignedToUserId: procedureRequest.assignedToUserId || null,
      },
      operationalState: {
        ...(liveSnapshot || {}),
        availableActions: operationalActions,
      },
      activeTaskDisplay: resolveTaskDisplayConfig({ activeTask: normalizedActiveTask, procedureType }),
      history: events,
      procedureType,
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el detalle del expediente." },
      { status: 500 }
    );
  }
}

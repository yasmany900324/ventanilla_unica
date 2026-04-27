import { NextResponse } from "next/server";
import { requireBackofficeUser, userHasRole } from "../../../../../../lib/auth";
import { ROLES } from "../../../../../../lib/roles";
import { getAppRouteParamString } from "../../../../../../lib/nextAppRouteParams";
import { getLiveCamundaTaskSnapshot } from "../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { getProcedureCatalogEntryById } from "../../../../../../lib/procedureCatalog";
import {
  buildAvailableActions,
  resolveTaskDisplayConfig,
} from "../../../../../../lib/procedureRequestInboxDetail";
import {
  getProcedureRequestById,
  listProcedureRequestEvents,
  resolveFuncionarioAssignmentScopeForProcedureRequest,
} from "../../../../../../lib/procedureRequests";

function mapOperationalActions({
  snapshotActions,
  legacyActions,
  requestsApiSegment,
  procedureRequestId,
}) {
  const byLegacyKey = new Map(
    legacyActions
      .filter((item) => item?.actionKey)
      .map((item) => [String(item.actionKey || "").trim().toLowerCase(), item])
  );
  const normalizedSegment = String(requestsApiSegment || "funcionario").trim().toLowerCase();
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
      } else if (normalizedSegment === "funcionario" && procedureRequestId) {
        out.endpoint = `/api/funcionario/procedures/requests/${encodeURIComponent(
          procedureRequestId
        )}/claim-task`;
        out.method = "POST";
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
    const actor = await requireBackofficeUser(request);
    if (!actor) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }
    const isAdmin = userHasRole(actor, ROLES.ADMIN);
    const assignmentScope = isAdmin
      ? "admin"
      : await resolveFuncionarioAssignmentScopeForProcedureRequest({
          funcionarioUserId: actor.id,
          procedureRequestId: procedureRequest.id,
        });
    if (!isAdmin && !assignmentScope) {
      return NextResponse.json(
        {
          error:
            "No tienes permisos para ver este expediente o ya fue tomado por otro funcionario.",
        },
        { status: 403 }
      );
    }
    const [events, activeTask] = await Promise.all([
      listProcedureRequestEvents(procedureRequest.id, { limit: 200 }),
      getLiveCamundaTaskSnapshot({
        procedureRequest,
        actorId: actor.id,
      }),
    ]);
    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;
    const normalizedActiveTask = activeTask?.activeTask?.exists
      ? {
          taskId: activeTask.activeTask.id,
          taskDefinitionKey: activeTask.activeTask.taskDefinitionKey,
          name: activeTask.activeTask.name,
          assignee: activeTask.activeTask.assignee,
          state: activeTask.activeTask.state,
          createdAt: activeTask.activeTask.createdAt,
        }
      : null;
    const legacyAvailableActions = buildAvailableActions({
      procedureRequest: {
        ...procedureRequest,
        assignmentScope,
        isAssignedToMe: assignmentScope === "assigned_to_me",
        isAvailableToClaim: assignmentScope === "available",
      },
      activeTask: normalizedActiveTask,
      procedureType,
      actorId: actor.id,
      requestsApiSegment: "funcionario",
      includeClaimTask: false,
      assignmentScope,
    });
    const operationalActions = mapOperationalActions({
      snapshotActions: Array.isArray(activeTask?.availableActions) ? activeTask.availableActions : [],
      legacyActions: legacyAvailableActions,
      requestsApiSegment: "funcionario",
      procedureRequestId: procedureRequest.id,
    });
    return NextResponse.json({
      localCase: {
        ...procedureRequest,
        assignmentScope,
        isAssignedToMe: assignmentScope === "assigned_to_me",
        isAvailableToClaim: assignmentScope === "available",
      },
      operationalState: {
        ...(activeTask || {}),
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

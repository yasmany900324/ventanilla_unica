import { NextResponse } from "next/server";
import { requireBackofficeUser, userHasRole } from "../../../../../../lib/auth";
import { ROLES } from "../../../../../../lib/roles";
import { getAppRouteParamString } from "../../../../../../lib/nextAppRouteParams";
import { getActiveTaskForProcedure } from "../../../../../../lib/camunda/getActiveTaskForProcedure";
import { getProcedureCatalogEntryById } from "../../../../../../lib/procedureCatalog";
import {
  buildAvailableActions,
  resolveTaskDisplayConfig,
} from "../../../../../../lib/procedureRequestInboxDetail";
import {
  buildCamundaStatus,
  buildCamundaStatusLabel,
} from "../../../../../../lib/procedureRequestInboxListHelpers";
import {
  getProcedureRequestById,
  listProcedureRequestEvents,
  resolveFuncionarioAssignmentScopeForProcedureRequest,
} from "../../../../../../lib/procedureRequests";

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
      getActiveTaskForProcedure(procedureRequest.id).catch(() => null),
    ]);
    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;
    const currentTaskDefinitionKey =
      activeTask?.taskDefinitionKey || procedureRequest.currentTaskDefinitionKey || null;
    const camundaStatus = buildCamundaStatus({
      ...procedureRequest,
      currentTaskDefinitionKey,
    });
    return NextResponse.json({
      procedureRequest: {
        ...procedureRequest,
        assignedToUserId: procedureRequest.assignedToUserId || null,
        assignmentScope,
        isAssignedToMe: assignmentScope === "assigned_to_me",
        isAvailableToClaim: assignmentScope === "available",
        camundaStatus,
        camundaStatusLabel: buildCamundaStatusLabel(camundaStatus),
      },
      activeTask,
      activeTaskDisplay: resolveTaskDisplayConfig({ activeTask, procedureType }),
      history: events,
      procedureType,
      availableActions: buildAvailableActions({
        procedureRequest: {
          ...procedureRequest,
          assignmentScope,
          isAssignedToMe: assignmentScope === "assigned_to_me",
          isAvailableToClaim: assignmentScope === "available",
        },
        activeTask,
        procedureType,
        actorId: actor.id,
        requestsApiSegment: "funcionario",
        includeClaimTask: false,
        assignmentScope,
      }),
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "No se pudo cargar el detalle del expediente." },
      { status: 500 }
    );
  }
}

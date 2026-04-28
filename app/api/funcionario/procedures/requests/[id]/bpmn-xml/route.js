import { NextResponse } from "next/server";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { resolveFuncionarioProcedureRequestReadContext } from "../../../../../../../lib/funcionarioProcedureRequestReadContext";
import { getLiveCamundaTaskSnapshot } from "../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { CamundaClientError, getCamundaProcessDefinitionXml, getCamundaProcessInstance } from "../../../../../../../lib/camunda/client";
import { resolveProcedureCamundaProcessDefinitionId } from "../../../../../../../lib/camunda/resolveProcedureCamundaProcessDefinitionId";
import { getProcedureCatalogEntryById } from "../../../../../../../lib/procedureCatalog";

export async function GET(request, { params }) {
  try {
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const gate = await resolveFuncionarioProcedureRequestReadContext(request, procedureRequestId);
    if (!gate.ok) {
      return gate.response;
    }
    const { procedureRequest, actor } = gate;
    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;

    const snapshot = await getLiveCamundaTaskSnapshot({
      procedureRequest,
      actorId: actor.id,
    });

    const instanceKey = String(
      procedureRequest.camundaProcessInstanceKey || snapshot?.process?.instanceKey || ""
    ).trim();

    let processInstance = null;
    const fromSnap = String(snapshot?.process?.definitionId || snapshot?.process?.bpmnProcessId || "").trim();
    if (instanceKey && !fromSnap) {
      processInstance = await getCamundaProcessInstance(instanceKey).catch(() => null);
    }

    const processDefinitionId = resolveProcedureCamundaProcessDefinitionId({
      snapshot,
      processInstance,
      procedureRequest,
      procedureType,
    });
    if (!processDefinitionId) {
      return NextResponse.json(
        { error: "No hay definición de proceso Camunda resuelta para este expediente." },
        { status: 404 }
      );
    }

    const bpmnXml = await getCamundaProcessDefinitionXml(processDefinitionId);
    const activeElementId =
      snapshot?.activeTask?.exists && snapshot.activeTask.taskDefinitionKey
        ? String(snapshot.activeTask.taskDefinitionKey).trim()
        : null;

    return NextResponse.json({
      bpmnXml,
      activeElementId,
      processInstanceKey: snapshot?.process?.instanceKey ?? null,
      bpmnProcessId: snapshot?.process?.bpmnProcessId ?? procedureType?.camundaProcessId ?? null,
      processDefinitionId,
    });
  } catch (error) {
    if (error instanceof CamundaClientError) {
      const status = Number(error.status) || 502;
      return NextResponse.json(
        { error: error.message || "No se pudo obtener el BPMN XML desde Camunda." },
        { status: status >= 400 && status < 600 ? status : 502 }
      );
    }
    return NextResponse.json({ error: "No se pudo obtener el BPMN XML del proceso." }, { status: 500 });
  }
}

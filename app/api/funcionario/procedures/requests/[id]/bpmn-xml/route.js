import { NextResponse } from "next/server";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { resolveFuncionarioProcedureRequestReadContext } from "../../../../../../../lib/funcionarioProcedureRequestReadContext";
import { getLiveCamundaTaskSnapshot } from "../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { CamundaClientError, getCamundaProcessDefinitionXml, getCamundaProcessInstance } from "../../../../../../../lib/camunda/client";
import { resolveProcedureCamundaProcessDefinitionKey } from "../../../../../../../lib/camunda/resolveProcedureCamundaProcessDefinitionKey";
import { getProcedureCatalogEntryById } from "../../../../../../../lib/procedureCatalog";
import { sanitizeForLogs } from "../../../../../../../lib/logging/sanitizeForLogs";

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
    const snapshotDefinitionKey = String(
      snapshot?.process?.processDefinitionKey || snapshot?.process?.definitionKey || ""
    ).trim();
    if (instanceKey && !snapshotDefinitionKey) {
      processInstance = await getCamundaProcessInstance(instanceKey).catch(() => null);
    }

    const resolvedDefinition = await resolveProcedureCamundaProcessDefinitionKey({
      snapshot,
      processInstance,
      procedureRequest,
      procedureType,
    });
    console.info(
      "[camunda] resolución de processDefinitionKey para BPMN XML",
      sanitizeForLogs({
        processInstanceKey: instanceKey || null,
        bpmnProcessId: resolvedDefinition.bpmnProcessId || null,
        resolvedProcessDefinitionKey: resolvedDefinition.processDefinitionKey || null,
        resolutionSource: resolvedDefinition.resolutionSource || null,
      })
    );

    if (!resolvedDefinition.processDefinitionKey) {
      return NextResponse.json(
        { error: "No se pudo resolver la key de definición de proceso para descargar el BPMN XML." },
        { status: 502 }
      );
    }

    const bpmnXml = await getCamundaProcessDefinitionXml(resolvedDefinition.processDefinitionKey);
    const activeElementId =
      snapshot?.activeTask?.exists && snapshot.activeTask.taskDefinitionKey
        ? String(snapshot.activeTask.taskDefinitionKey).trim()
        : null;

    return NextResponse.json({
      bpmnXml,
      activeElementId,
      processInstanceKey: snapshot?.process?.instanceKey ?? null,
      bpmnProcessId: resolvedDefinition.bpmnProcessId ?? procedureType?.camundaProcessId ?? null,
      processDefinitionKey: resolvedDefinition.processDefinitionKey,
      processDefinitionId: resolvedDefinition.processDefinitionKey,
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

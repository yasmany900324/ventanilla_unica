import { NextResponse } from "next/server";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { resolveFuncionarioProcedureRequestReadContext } from "../../../../../../../lib/funcionarioProcedureRequestReadContext";
import { getLiveCamundaTaskSnapshot } from "../../../../../../../lib/camunda/getLiveCamundaTaskSnapshot";
import { CamundaClientError, getCamundaProcessDefinitionXml, getCamundaProcessInstance } from "../../../../../../../lib/camunda/client";
import { resolveProcedureCamundaProcessDefinitionKey } from "../../../../../../../lib/camunda/resolveProcedureCamundaProcessDefinitionKey";
import { getProcedureCatalogEntryById } from "../../../../../../../lib/procedureCatalog";
import { listProcedureRequestEvents } from "../../../../../../../lib/procedureRequests";
import { buildProcedureRequestProcessFlowSummary } from "../../../../../../../lib/procedureRequestProcessFlowSummary";
import { sanitizeForLogs } from "../../../../../../../lib/logging/sanitizeForLogs";

export async function GET(request, { params }) {
  try {
    const procedureRequestId = await getAppRouteParamString(params, "id");
    const gate = await resolveFuncionarioProcedureRequestReadContext(request, procedureRequestId);
    if (!gate.ok) {
      return gate.response;
    }
    const { procedureRequest, actor } = gate;

    const [events, snapshot] = await Promise.all([
      listProcedureRequestEvents(procedureRequest.id, { limit: 200 }),
      getLiveCamundaTaskSnapshot({
        procedureRequest,
        actorId: actor.id,
      }),
    ]);

    const procedureType = procedureRequest.procedureTypeId
      ? await getProcedureCatalogEntryById(procedureRequest.procedureTypeId, { includeInactive: true })
      : null;

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
      "[process-flow-summary] resolución de processDefinitionKey",
      sanitizeForLogs({
        processInstanceKey: instanceKey || null,
        bpmnProcessId: resolvedDefinition.bpmnProcessId || null,
        resolvedProcessDefinitionKey: resolvedDefinition.processDefinitionKey || null,
        resolutionSource: resolvedDefinition.resolutionSource || null,
      })
    );

    let bpmnXml = null;
    if (resolvedDefinition.processDefinitionKey) {
      try {
        bpmnXml = await getCamundaProcessDefinitionXml(resolvedDefinition.processDefinitionKey);
      } catch (error) {
        if (error instanceof CamundaClientError) {
          console.warn(
            "[process-flow-summary] No se pudo cargar BPMN XML; se devuelve resumen parcial.",
            error.message
          );
        } else {
          console.warn("[process-flow-summary] Error inesperado al cargar BPMN XML.", String(error?.message || ""));
        }
        bpmnXml = null;
      }
    } else {
      console.warn(
        "[process-flow-summary] No se pudo resolver la key de definición de proceso para descargar el BPMN XML.",
        sanitizeForLogs({
          processInstanceKey: instanceKey || null,
          bpmnProcessId: resolvedDefinition.bpmnProcessId || null,
        })
      );
    }

    const summary = await buildProcedureRequestProcessFlowSummary({
      bpmnXml,
      snapshot,
      events,
    });

    return NextResponse.json(summary);
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo construir el resumen del flujo." }, { status: 500 });
  }
}

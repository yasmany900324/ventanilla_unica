import { describe, expect, it } from "vitest";
import {
  ACTIVE_TASK_API_MISS_USER_MESSAGE,
  buildCamundaAdvanceActionSummaryLabel,
  buildCamundaAssigneeResponsibilityLabel,
  buildFunctionalWorkflowStateLabel,
  buildInboxRelationLabelFromOwner,
  buildOperativeStepLabel,
  buildOperationalSituation,
  computeRequiresCamundaRetry,
  deriveCamundaStatus,
  splitOperationalErrors,
} from "../funcionarioExpedienteOperationalCamunda.js";

function computeShowActiveTaskApiMissBanner({ operationalErrors, showCamundaSyncAlert, camundaProcessInstanceKey }) {
  const { benignActiveTaskMiss } = splitOperationalErrors(operationalErrors);
  return Boolean(
    benignActiveTaskMiss.length > 0 && !showCamundaSyncAlert && Boolean(camundaProcessInstanceKey)
  );
}

describe("funcionarioExpedienteOperationalCamunda", () => {
  it("processState ACTIVE + error CAMUNDA_ACTIVE_TASK_NOT_FOUND no deriva a ERROR_SYNC", () => {
    const detail = {
      operationalState: {
        process: { state: "ACTIVE" },
        errors: [
          {
            code: "CAMUNDA_ACTIVE_TASK_NOT_FOUND",
            message: "sin user task mapeable",
            source: "camunda",
          },
        ],
      },
      activeTask: null,
    };
    const key = deriveCamundaStatus(
      { status: "IN_PROGRESS", camundaProcessInstanceKey: "2251799813704048" },
      detail
    );
    expect(key).toBe("ACTIVE_TASK_NOT_FOUND");
  });

  it("ACTIVE + activeTask null + processInstanceKey no activa requiresCamundaRetry (sin botón reintento sync)", () => {
    const requires = computeRequiresCamundaRetry({
      procedureRequest: {
        status: "IN_PROGRESS",
        camundaProcessInstanceKey: "2251799813704048",
      },
      camundaStatusKey: "ACTIVE_TASK_NOT_FOUND",
      camundaStatusLabel: "Instancia activa (tarea API no resuelta)",
      hasActiveTask: false,
      isAvailable: false,
    });
    expect(requires).toBe(false);
  });

  it("ACTIVE_TASK_NOT_FOUND muestra situación con mensaje de diagnóstico API (no revisión sync)", () => {
    const situation = buildOperationalSituation({
      procedureRequest: {},
      camundaStatusKey: "ACTIVE_TASK_NOT_FOUND",
      hasActiveTask: false,
      requiresCamundaRetry: false,
      isInitialCamundaSyncPending: false,
    });
    expect(situation).toBe(ACTIVE_TASK_API_MISS_USER_MESSAGE);
  });

  it("con instancia ya vinculada no fuerza retry por ausencia de tarea mapeada", () => {
    expect(
      computeRequiresCamundaRetry({
        procedureRequest: {
          status: "IN_PROGRESS",
          camundaProcessInstanceKey: "2251799813704048",
        },
        camundaStatusKey: "ACTIVE_TASK_NOT_FOUND",
        camundaStatusLabel: "Instancia activa (tarea API no resuelta)",
        hasActiveTask: false,
        isAvailable: false,
      })
    ).toBe(false);
  });

  it("sin error benigno no se arma el banner azul de API miss (misma regla que la UI)", () => {
    expect(
      computeShowActiveTaskApiMissBanner({
        operationalErrors: [],
        showCamundaSyncAlert: false,
        camundaProcessInstanceKey: "2251799813704048",
      })
    ).toBe(false);
  });

  it("detail con tarea mapeable (taskDefinitionKey) deriva a TASK_ACTIVE, no ACTIVE_TASK_NOT_FOUND", () => {
    const key = deriveCamundaStatus(
      { status: "IN_PROGRESS", camundaProcessInstanceKey: "2251799813704048" },
      {
        operationalState: { process: { state: "ACTIVE" }, errors: [] },
        activeTask: {
          taskDefinitionKey: "Activity_registrar_datos",
          name: "Registrar Datos Iniciales",
          state: "CREATED",
        },
      }
    );
    expect(key).toBe("TASK_ACTIVE");
  });

  it("Paso visible: prioriza name humano sobre taskDefinitionKey (elementId BPMN)", () => {
    expect(
      buildOperativeStepLabel({
        name: "Registrar Datos Iniciales",
        taskDefinitionKey: "Activity_0g0id0y",
      })
    ).toBe("Registrar Datos Iniciales");
  });

  it("sin name usa taskDefinitionKey como último recurso (elementId en técnico, no como nombre preferido)", () => {
    expect(buildOperativeStepLabel({ taskDefinitionKey: "Activity_0g0id0y" })).toBe("Activity_0g0id0y");
  });

  it("estado funcional: CREATED y assignee null → Pendiente de tomar", () => {
    expect(
      buildFunctionalWorkflowStateLabel({
        hasActiveTask: true,
        activeTask: { state: "CREATED", assignee: null },
        processStateUpper: "ACTIVE",
        camundaStatusKey: "TASK_ACTIVE",
      })
    ).toBe("Pendiente de tomar");
  });

  it("estado funcional: con assignee → En gestión", () => {
    expect(
      buildFunctionalWorkflowStateLabel({
        hasActiveTask: true,
        activeTask: { state: "CREATED", assignee: "user-1" },
        processStateUpper: "ACTIVE",
        camundaStatusKey: "TASK_ACTIVE",
      })
    ).toBe("En gestión");
  });

  it("inbox_owner del funcionario actual → Asignado a mí", () => {
    expect(buildInboxRelationLabelFromOwner("func-1", "func-1")).toBe("Asignado a mí");
  });

  it("inbox_owner null → Disponible", () => {
    expect(buildInboxRelationLabelFromOwner(null, "func-1")).toBe("Disponible");
    expect(buildInboxRelationLabelFromOwner("", "func-1")).toBe("Disponible");
  });

  it("inbox_owner otro funcionario → Asignado a otro funcionario", () => {
    expect(buildInboxRelationLabelFromOwner("func-2", "func-1")).toBe("Asignado a otro funcionario");
  });

  it("responsable Camunda: assignee coincide con funcionario actual", () => {
    expect(buildCamundaAssigneeResponsibilityLabel("func-1", "func-1")).toBe("Asignado a mí");
  });

  it("responsable Camunda: sin assignee", () => {
    expect(buildCamundaAssigneeResponsibilityLabel(null, "func-1")).toBe("Sin asignar");
  });

  it("acción para avanzar: claim habilitado → Tomar tarea", () => {
    expect(
      buildCamundaAdvanceActionSummaryLabel([
        { actionKey: "claim_task", enabled: true },
        { actionKey: "complete_task", enabled: false },
      ])
    ).toBe("Tomar tarea");
  });

  it("acción para avanzar: complete habilitado → Completar tarea", () => {
    expect(
      buildCamundaAdvanceActionSummaryLabel([
        { actionKey: "claim_task", enabled: false },
        { actionKey: "complete_task", enabled: true },
      ])
    ).toBe("Completar tarea");
  });
});

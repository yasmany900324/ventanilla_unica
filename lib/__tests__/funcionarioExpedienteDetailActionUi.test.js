import { describe, expect, it } from "vitest";
import { deriveFuncionarioExpedienteActionUi, isFuncionarioProcessEnded } from "../funcionarioExpedienteDetailActionUi";

function detailWithTask(activeTask, processState = "ACTIVE") {
  return {
    activeTask,
    operationalState: { process: { state: processState }, errors: [] },
  };
}

describe("isFuncionarioProcessEnded", () => {
  it("detecta proceso Camunda terminado por estado de instancia", () => {
    expect(
      isFuncionarioProcessEnded({
        processStateUpper: "COMPLETED",
        camundaStatusKey: "TASK_ACTIVE",
        procedureStatus: "IN_PROGRESS",
      })
    ).toBe(true);
  });
});

describe("deriveFuncionarioExpedienteActionUi", () => {
  const claimExp = { actionKey: "claim_task", enabled: true, endpoint: "/api/claim" };
  const claimCamunda = { actionKey: "claim_task", enabled: true, endpoint: "/api/camunda-claim" };
  const complete = { actionKey: "complete_task", enabled: true, endpoint: "/api/complete" };

  it("bandeja general: solo Tomar expediente; rail sin complete ni claim Camunda", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: false,
      assignmentScope: "available",
      isAvailable: true,
      isAssignedToMe: false,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: { taskDefinitionKey: "step1", assignee: null },
      operationalActions: [claimCamunda, complete],
      claimAction: claimExp,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "available" },
      detail: detailWithTask({ taskDefinitionKey: "step1", assignee: null }),
    });
    expect(r.mode).toBe("take_expediente");
    expect(r.siguienteAccionLabel).toBe("Tomar expediente");
    expect(r.completeActionForWide).toBeNull();
    expect(r.showClaimExpediente).toBe(true);
    expect(r.railOperationalActions.map((a) => a.actionKey)).toEqual([]);
  });

  it("asignado a mí, tarea Camunda sin assignee: Tomar tarea; sin formulario ancho", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: false,
      assignmentScope: "assigned_to_me",
      isAvailable: false,
      isAssignedToMe: true,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: { taskDefinitionKey: "step1", assignee: null },
      operationalActions: [claimCamunda, complete],
      claimAction: null,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "assigned_to_me" },
      detail: detailWithTask({ taskDefinitionKey: "step1", assignee: null }),
    });
    expect(r.mode).toBe("take_camunda_task");
    expect(r.siguienteAccionLabel).toBe("Tomar tarea");
    expect(r.completeActionForWide).toBeNull();
    expect(r.railOperationalActions.some((a) => a.actionKey === "complete_task")).toBe(false);
    expect(r.railOperationalActions.some((a) => a.actionKey === "claim_task")).toBe(true);
  });

  it("tarea asignada a mí: Completar este paso en rail status y wide; rail sin complete ni claim", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: false,
      assignmentScope: "assigned_to_me",
      isAvailable: false,
      isAssignedToMe: true,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: { taskDefinitionKey: "step1", assignee: "u1" },
      operationalActions: [claimCamunda, complete],
      claimAction: null,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "assigned_to_me" },
      detail: detailWithTask({ taskDefinitionKey: "step1", assignee: "u1" }),
    });
    expect(r.mode).toBe("complete_step");
    expect(r.siguienteAccionLabel).toBe("Completar este paso");
    expect(r.completeActionForWide).toEqual(complete);
    expect(r.railOperationalActions.map((a) => a.actionKey)).not.toContain("complete_task");
    expect(r.railOperationalActions.map((a) => a.actionKey)).not.toContain("claim_task");
  });

  it("tarea asignada a otro: bloqueo y rail vacío", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: false,
      assignmentScope: "assigned_to_me",
      isAvailable: false,
      isAssignedToMe: true,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: { taskDefinitionKey: "step1", assignee: "u2" },
      operationalActions: [complete],
      claimAction: null,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "assigned_to_me" },
      detail: detailWithTask({ taskDefinitionKey: "step1", assignee: "u2" }),
    });
    expect(r.mode).toBe("blocked_other_assignee");
    expect(r.blockingMessage).toMatch(/otro funcionario/i);
    expect(r.railOperationalActions).toHaveLength(0);
    expect(r.completeActionForWide).toBeNull();
  });

  it("proceso finalizado: etiqueta y sin acciones en rail", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: false,
      assignmentScope: "assigned_to_me",
      isAvailable: false,
      isAssignedToMe: true,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: null,
      operationalActions: [complete],
      claimAction: null,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "assigned_to_me" },
      detail: {
        activeTask: null,
        operationalState: { process: { state: "COMPLETED" }, errors: [] },
      },
    });
    expect(r.mode).toBe("process_finished");
    expect(r.siguienteAccionLabel).toBe("Proceso finalizado");
    expect(r.railOperationalActions).toHaveLength(0);
    expect(r.completeActionForWide).toBeNull();
  });

  it("prioriza alerta de sincronización", () => {
    const r = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert: true,
      assignmentScope: "assigned_to_me",
      isAvailable: false,
      isAssignedToMe: true,
      isAdmin: false,
      currentUserId: "u1",
      activeTask: { taskDefinitionKey: "step1", assignee: "u1" },
      operationalActions: [claimCamunda, complete],
      claimAction: null,
      procedureRequest: { status: "IN_PROGRESS", assignmentScope: "assigned_to_me" },
      detail: detailWithTask({ taskDefinitionKey: "step1", assignee: "u1" }),
    });
    expect(r.mode).toBe("sync_required");
    expect(r.siguienteAccionLabel).toBe("Sincronizar con el motor de procesos");
    expect(r.completeActionForWide).toBeNull();
  });
});

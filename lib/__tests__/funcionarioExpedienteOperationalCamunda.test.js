import { describe, expect, it } from "vitest";
import {
  ACTIVE_TASK_API_MISS_USER_MESSAGE,
  buildOperationalSituation,
  computeRequiresCamundaRetry,
  deriveCamundaStatus,
} from "../funcionarioExpedienteOperationalCamunda.js";

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
});

import { describe, expect, it } from "vitest";
import { buildCamundaStatus, buildCamundaStatusLabel } from "../procedureRequestInboxListHelpers";

describe("procedureRequestInboxListHelpers camunda status", () => {
  it("reporta estado visible cuando hay instancia sin tarea activa", () => {
    const status = buildCamundaStatus({
      status: "IN_PROGRESS",
      camundaProcessInstanceKey: "225795013660914",
      currentTaskDefinitionKey: null,
      camundaError: null,
    });
    expect(status).toBe("PROCESS_RUNNING");
    expect(buildCamundaStatusLabel(status)).toMatch(/Instancia creada|proceso/i);
  });

  it("reporta TASK_ACTIVE cuando hay tarea activa", () => {
    const status = buildCamundaStatus({
      status: "PENDING_BACKOFFICE_ACTION",
      camundaProcessInstanceKey: "225795013660914",
      currentTaskDefinitionKey: "Task_Review",
      camundaError: null,
    });
    expect(status).toBe("TASK_ACTIVE");
    expect(buildCamundaStatusLabel(status)).toMatch(/Pendiente|revisión/i);
  });
});

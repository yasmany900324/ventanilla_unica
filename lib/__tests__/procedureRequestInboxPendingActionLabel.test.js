import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveTaskForProcedure: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
}));

vi.mock("../camunda/getActiveTaskForProcedure", () => ({
  getActiveTaskForProcedure: mocks.getActiveTaskForProcedure,
}));

vi.mock("../procedureCatalog", () => ({
  getProcedureCatalogEntryById: mocks.getProcedureCatalogEntryById,
}));

import { enrichProcedureRequestsForInbox } from "../procedureRequestInboxListHelpers";

describe("procedureRequestInbox pending action labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProcedureCatalogEntryById.mockResolvedValue({
      id: "proc-type-1",
      flowDefinition: {
        taskUiDictionary: [
          {
            taskDefinitionKey: "Activity_0g0id0y",
            title: "Registrar Datos Iniciales",
          },
        ],
      },
    });
  });

  it("usa nombre funcional de activeTask y no deja Activity_* como principal", async () => {
    mocks.getActiveTaskForProcedure.mockResolvedValueOnce({
      taskDefinitionKey: "Activity_0g0id0y",
      name: "Registrar Datos Iniciales",
      taskName: "Registrar Datos Iniciales",
    });

    const [row] = await enrichProcedureRequestsForInbox([
      {
        id: "pr-1",
        assignmentScope: "assigned_to_me",
        camundaError: null,
        camundaProcessInstanceKey: "camunda-1",
        currentTaskDefinitionKey: null,
        taskAssigneeId: null,
        procedureTypeId: "proc-type-1",
      },
    ]);

    expect(row.pendingAction).toBe("Reclamar tarea");
    expect(row.pendingActionDetail).toBe("Registrar Datos Iniciales");
    expect(row.pendingActionDetail).not.toMatch(/^Activity_/);
  });

  it("cuando no hay nombre funcional, cae a 'Tarea pendiente' y nunca muestra Activity_*", async () => {
    mocks.getProcedureCatalogEntryById.mockResolvedValueOnce({
      id: "proc-type-1",
      flowDefinition: { taskUiDictionary: [] },
    });
    mocks.getActiveTaskForProcedure.mockResolvedValueOnce({
      taskDefinitionKey: "Activity_0g0id0y",
      name: "",
      taskName: "",
    });

    const [row] = await enrichProcedureRequestsForInbox([
      {
        id: "pr-2",
        assignmentScope: "assigned_to_me",
        camundaError: null,
        camundaProcessInstanceKey: "camunda-2",
        currentTaskDefinitionKey: null,
        taskAssigneeId: "func-1",
        procedureTypeId: "proc-type-1",
      },
    ]);

    expect(row.pendingAction).toBe("Completar paso");
    expect(row.pendingActionDetail).toBe("Tarea pendiente");
    expect(row.pendingActionDetail).not.toBe("Sin tarea activa");
    expect(row.pendingActionDetail).not.toContain("Activity_0g0id0y");
  });

  it("si hay taskDefinitionKey local y label en taskUiDictionary, usa ese nombre funcional", async () => {
    mocks.getActiveTaskForProcedure.mockResolvedValueOnce(null);

    const [row] = await enrichProcedureRequestsForInbox([
      {
        id: "pr-3",
        assignmentScope: "assigned_to_me",
        camundaError: null,
        camundaProcessInstanceKey: "camunda-3",
        currentTaskDefinitionKey: "Activity_0g0id0y",
        activeTaskId: "2251799813693770",
        taskAssigneeId: null,
        procedureTypeId: "proc-type-1",
      },
    ]);

    expect(row.pendingAction).toBe("Reclamar tarea");
    expect(row.pendingActionDetail).toBe("Registrar Datos Iniciales");
    expect(row.pendingActionDetail).not.toBe("Sin tarea activa");
    expect(row.pendingActionDetail).not.toMatch(/^Activity_/);
  });
});

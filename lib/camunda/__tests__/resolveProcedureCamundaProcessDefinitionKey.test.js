import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchCamundaProcessDefinitions: vi.fn(),
}));

vi.mock("../client", async () => {
  const actual = await vi.importActual("../client");
  return {
    ...actual,
    searchCamundaProcessDefinitions: mocks.searchCamundaProcessDefinitions,
  };
});

import { resolveProcedureCamundaProcessDefinitionKey } from "../resolveProcedureCamundaProcessDefinitionKey";

describe("resolveProcedureCamundaProcessDefinitionKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchCamundaProcessDefinitions.mockResolvedValue([]);
  });

  it("prioriza processDefinitionKey numérico del snapshot", async () => {
    const out = await resolveProcedureCamundaProcessDefinitionKey({
      snapshot: {
        process: {
          processDefinitionKey: "2251799813689999",
          bpmnProcessId: "Process_1hvmc45",
        },
      },
    });
    expect(out.processDefinitionKey).toBe("2251799813689999");
    expect(out.resolutionSource).toBe("snapshot.processDefinitionKey");
  });

  it("si solo hay bpmnProcessId textual busca key en Camunda", async () => {
    mocks.searchCamundaProcessDefinitions.mockResolvedValueOnce([
      { processDefinitionKey: "2251799813690001", processDefinitionId: "Process_1hvmc45" },
    ]);
    const out = await resolveProcedureCamundaProcessDefinitionKey({
      snapshot: { process: { definitionId: "Process_1hvmc45" } },
    });
    expect(out.processDefinitionKey).toBe("2251799813690001");
    expect(out.resolutionSource).toBe("search.process-definitions");
  });

  it("no usa bpmnProcessId textual como processDefinitionKey", async () => {
    const out = await resolveProcedureCamundaProcessDefinitionKey({
      snapshot: { process: { definitionId: "Process_1hvmc45" } },
      procedureType: { camundaProcessId: "Process_1hvmc45" },
    });
    expect(out.processDefinitionKey).toBeNull();
    expect(out.bpmnProcessId).toBe("Process_1hvmc45");
  });
});

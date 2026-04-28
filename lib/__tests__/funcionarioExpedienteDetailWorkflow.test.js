import { describe, expect, it } from "vitest";
import { inferFuncionarioWorkflowProgress } from "../funcionarioExpedienteDetailWorkflow";

describe("inferFuncionarioWorkflowProgress", () => {
  it("maps terminal statuses to closure", () => {
    const r = inferFuncionarioWorkflowProgress({
      procedureStatus: "RESOLVED",
      operativeStepLabel: "Anything",
      hasActiveTask: true,
    });
    expect(r.currentIndex).toBe(4);
    expect(r.completedBefore).toBe(4);
  });

  it("uses keyword revision in task label", () => {
    const r = inferFuncionarioWorkflowProgress({
      procedureStatus: "IN_PROGRESS",
      operativeStepLabel: "Revisión documental",
      hasActiveTask: true,
    });
    expect(r.currentIndex).toBe(1);
  });
});

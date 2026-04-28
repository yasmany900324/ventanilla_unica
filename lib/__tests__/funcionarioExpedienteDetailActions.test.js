import { describe, expect, it } from "vitest";
import { buildFuncionarioSiguienteAccionLabel, partitionPrimaryOperationalActions } from "../funcionarioExpedienteDetailActions";

describe("buildFuncionarioSiguienteAccionLabel", () => {
  it("prioriza tomar expediente cuando el caso está en bandeja general y el claim está habilitado", () => {
    const label = buildFuncionarioSiguienteAccionLabel({
      isAvailable: true,
      claimAction: { actionKey: "claim_task", enabled: true },
      showCamundaSyncAlert: false,
      operationalActions: [{ actionKey: "complete_task", enabled: true }],
    });
    expect(label).toBe("Tomar expediente");
  });

  it("prioriza sincronización cuando hay alerta de Camunda", () => {
    const label = buildFuncionarioSiguienteAccionLabel({
      isAvailable: false,
      claimAction: null,
      showCamundaSyncAlert: true,
      operationalActions: [],
    });
    expect(label).toBe("Sincronizar con el motor de procesos");
  });

  it("muestra completar paso cuando hay complete_task habilitado y no aplica claim", () => {
    const label = buildFuncionarioSiguienteAccionLabel({
      isAvailable: false,
      claimAction: null,
      showCamundaSyncAlert: false,
      operationalActions: [{ actionKey: "complete_task", enabled: true }],
    });
    expect(label).toBe("Completar paso");
  });
});

describe("partitionPrimaryOperationalActions", () => {
  it("separa complete_task como primario", () => {
    const { primary, secondary } = partitionPrimaryOperationalActions([
      { actionKey: "retry_camunda_sync" },
      { actionKey: "complete_task" },
    ]);
    expect(primary?.actionKey).toBe("complete_task");
    expect(secondary).toHaveLength(1);
    expect(secondary[0].actionKey).toBe("retry_camunda_sync");
  });
});

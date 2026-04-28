import { describe, expect, it } from "vitest";
import { mapCamundaOrchestrationUserTask } from "../mapOrchestrationUserTask";

describe("mapCamundaOrchestrationUserTask", () => {
  it("acepta ítem v2 con userTaskKey + elementId sin id ni taskDefinitionKey", () => {
    const item = {
      userTaskKey: "2251799813704056",
      elementId: "Activity_registrar_datos",
      elementInstanceKey: "2251799813704057",
      name: "Registrar Datos Iniciales",
      state: "CREATED",
      assignee: null,
      processInstanceKey: "2251799813704048",
      formKey: "form-1",
      candidateGroups: ["g1"],
      candidateUsers: [],
    };
    const mapped = mapCamundaOrchestrationUserTask(item);
    expect(mapped).not.toBeNull();
    expect(mapped.id).toBe("2251799813704056");
    expect(mapped.taskId).toBe("2251799813704056");
    expect(mapped.userTaskKey).toBe("2251799813704056");
    expect(mapped.taskDefinitionKey).toBe("Activity_registrar_datos");
    expect(mapped.taskDefinitionId).toBe("Activity_registrar_datos");
    expect(mapped.name).toBe("Registrar Datos Iniciales");
    expect(mapped.state).toBe("CREATED");
    expect(mapped.assignee).toBeNull();
    expect(mapped.processInstanceKey).toBe("2251799813704048");
    expect(mapped.elementInstanceKey).toBe("2251799813704057");
    expect(mapped.formKey).toBe("form-1");
    expect(mapped.candidateGroups).toEqual(["g1"]);
    expect(mapped.candidateUsers).toEqual([]);
  });

  it("sigue aceptando taskDefinitionId + userTaskKey legacy", () => {
    const mapped = mapCamundaOrchestrationUserTask({
      userTaskKey: "99",
      taskDefinitionId: "legacy_key",
      name: "Legacy",
      state: "created",
    });
    expect(mapped?.taskDefinitionKey).toBe("legacy_key");
    expect(mapped?.id).toBe("99");
    expect(mapped?.state).toBe("CREATED");
  });

  it("rechaza ítem sin identificador ni par v2", () => {
    expect(mapCamundaOrchestrationUserTask({ name: "x" })).toBeNull();
    expect(mapCamundaOrchestrationUserTask(null)).toBeNull();
  });
});

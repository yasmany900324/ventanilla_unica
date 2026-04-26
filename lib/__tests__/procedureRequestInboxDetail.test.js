import { describe, expect, it } from "vitest";
import { buildAvailableActions } from "../procedureRequestInboxDetail";

describe("procedureRequestInboxDetail field definitions", () => {
  it("usa fieldDefinitions para etiquetas legibles de variables requeridas", () => {
    const actions = buildAvailableActions({
      procedureRequest: {
        id: "pr-1",
        camundaError: null,
        taskAssigneeId: null,
      },
      activeTask: { taskDefinitionKey: "Task_Review" },
      procedureType: {
        fieldDefinitions: [
          { key: "location", label: "Ubicación", type: "location", required: true },
          { key: "photo", label: "Foto de respaldo", type: "image", required: false },
        ],
        camundaVariableMappings: [
          {
            scope: "COMPLETE_TASK",
            camundaTaskDefinitionKey: "Task_Review",
            procedureFieldKey: "location",
            camundaVariableName: "ubicacion",
            camundaVariableType: "json",
            required: true,
            enabled: true,
          },
          {
            scope: "COMPLETE_TASK",
            camundaTaskDefinitionKey: "Task_Review",
            procedureFieldKey: "photo",
            camundaVariableName: "foto",
            camundaVariableType: "json",
            required: false,
            enabled: true,
          },
        ],
      },
      actorId: "func-1",
      requestsApiSegment: "funcionario",
      includeClaimTask: false,
      assignmentScope: "assigned_to_me",
    });

    const complete = actions.find((item) => item.actionKey === "complete_task");
    expect(complete).toBeTruthy();
    expect(complete.requiredVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          procedureFieldKey: "location",
          fieldLabel: "Ubicación",
        }),
        expect.objectContaining({
          procedureFieldKey: "photo",
          fieldLabel: "Foto de respaldo",
        }),
      ])
    );
  });

  it("mantiene compatibilidad con requiredFields cuando falta fieldDefinitions", () => {
    const actions = buildAvailableActions({
      procedureRequest: {
        id: "pr-2",
        camundaError: null,
        taskAssigneeId: null,
      },
      activeTask: { taskDefinitionKey: "Task_Review" },
      procedureType: {
        requiredFields: [{ key: "descripcion", label: "Descripción", type: "text", required: true }],
        camundaVariableMappings: [
          {
            scope: "COMPLETE_TASK",
            camundaTaskDefinitionKey: "Task_Review",
            procedureFieldKey: "descripcion",
            camundaVariableName: "descripcion",
            camundaVariableType: "string",
            required: true,
            enabled: true,
          },
        ],
      },
      actorId: "func-1",
      requestsApiSegment: "funcionario",
      includeClaimTask: false,
      assignmentScope: "assigned_to_me",
    });

    const complete = actions.find((item) => item.actionKey === "complete_task");
    expect(complete.requiredVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          procedureFieldKey: "descripcion",
          fieldLabel: "Descripción",
        }),
      ])
    );
  });
});

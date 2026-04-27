import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBackofficeUser: vi.fn(),
  userHasRole: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
  buildAvailableActions: vi.fn(),
  resolveTaskDisplayConfig: vi.fn(),
  getProcedureRequestById: vi.fn(),
  listProcedureRequestEvents: vi.fn(),
  resolveFuncionarioAssignmentScopeForProcedureRequest: vi.fn(),
}));

vi.mock("../../../../../../lib/auth", () => ({
  requireBackofficeUser: mocks.requireBackofficeUser,
  userHasRole: mocks.userHasRole,
}));

vi.mock("../../../../../../lib/roles", () => ({
  ROLES: { ADMIN: "administrador" },
}));

vi.mock("../../../../../../lib/nextAppRouteParams", () => ({
  getAppRouteParamString: mocks.getAppRouteParamString,
}));

vi.mock("../../../../../../lib/camunda/getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

vi.mock("../../../../../../lib/procedureCatalog", () => ({
  getProcedureCatalogEntryById: mocks.getProcedureCatalogEntryById,
}));

vi.mock("../../../../../../lib/procedureRequestInboxDetail", () => ({
  buildAvailableActions: mocks.buildAvailableActions,
  resolveTaskDisplayConfig: mocks.resolveTaskDisplayConfig,
}));

vi.mock("../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
  listProcedureRequestEvents: mocks.listProcedureRequestEvents,
  resolveFuncionarioAssignmentScopeForProcedureRequest: mocks.resolveFuncionarioAssignmentScopeForProcedureRequest,
}));

import { GET } from "./route";

describe("api/funcionario/procedures/requests/[id] GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBackofficeUser.mockResolvedValue({ id: "func-1" });
    mocks.userHasRole.mockReturnValue(false);
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      status: "PENDING_BACKOFFICE_ACTION",
      procedureTypeId: "proc-1",
      camundaProcessInstanceKey: "123",
    });
    mocks.resolveFuncionarioAssignmentScopeForProcedureRequest.mockResolvedValue("assigned_to_me");
    mocks.listProcedureRequestEvents.mockResolvedValue([]);
    mocks.getProcedureCatalogEntryById.mockResolvedValue(null);
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      sourceOfTruth: "camunda_live",
      process: { state: "ACTIVE", instanceKey: "123" },
      activeTask: {
        exists: true,
        id: "task-1",
        taskDefinitionKey: "registrar_datos_iniciales",
        name: "Registrar Datos Iniciales",
        assignee: null,
      },
      availableActions: [{ action: "COMPLETE_TASK", enabled: true, reason: null }],
      errors: [],
    });
    mocks.buildAvailableActions.mockReturnValue([
      {
        actionKey: "complete_task",
        endpoint: "/api/funcionario/procedures/requests/pr-1/complete-task",
        method: "POST",
        expectedTaskDefinitionKey: "registrar_datos_iniciales",
        requiredVariables: [],
      },
    ]);
    mocks.resolveTaskDisplayConfig.mockReturnValue({ title: "Registrar Datos Iniciales" });
  });

  it("devuelve contrato localCase + operationalState y acciones operativas", async () => {
    const request = new Request("http://localhost/api/funcionario/procedures/requests/pr-1");
    const response = await GET(request, { params: Promise.resolve({ id: "pr-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.localCase?.id).toBe("pr-1");
    expect(body.operationalState?.sourceOfTruth).toBe("camunda_live");
    expect(Array.isArray(body.operationalState?.availableActions)).toBe(true);
    expect(body.operationalState.availableActions[0]).toEqual(
      expect.objectContaining({
        action: "COMPLETE_TASK",
        enabled: true,
        endpoint: "/api/funcionario/procedures/requests/pr-1/complete-task",
      })
    );
    expect(body.availableActions).toBeUndefined();
  });
});

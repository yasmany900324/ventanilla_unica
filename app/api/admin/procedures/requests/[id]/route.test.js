import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdministrator: vi.fn(),
  getAppRouteParamString: vi.fn(),
  getLiveCamundaTaskSnapshot: vi.fn(),
  getProcedureCatalogEntryById: vi.fn(),
  buildAvailableActions: vi.fn(),
  canAccessProcedureRequestLax: vi.fn(),
  resolveTaskDisplayConfig: vi.fn(),
  getProcedureRequestById: vi.fn(),
  listProcedureRequestEvents: vi.fn(),
}));

vi.mock("../../../../../../lib/auth", () => ({
  requireAdministrator: mocks.requireAdministrator,
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
  canAccessProcedureRequestLax: mocks.canAccessProcedureRequestLax,
  resolveTaskDisplayConfig: mocks.resolveTaskDisplayConfig,
}));

vi.mock("../../../../../../lib/procedureRequests", () => ({
  getProcedureRequestById: mocks.getProcedureRequestById,
  listProcedureRequestEvents: mocks.listProcedureRequestEvents,
}));

import { GET } from "./route";

describe("api/admin/procedures/requests/[id] GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdministrator.mockResolvedValue({ id: "admin-1" });
    mocks.getAppRouteParamString.mockResolvedValue("pr-1");
    mocks.getProcedureRequestById.mockResolvedValue({
      id: "pr-1",
      status: "PENDING_BACKOFFICE_ACTION",
      procedureTypeId: "proc-1",
      camundaProcessInstanceKey: "123",
    });
    mocks.canAccessProcedureRequestLax.mockReturnValue(true);
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
      availableActions: [
        { action: "CLAIM_TASK", enabled: true, reason: null },
        { action: "COMPLETE_TASK", enabled: true, reason: null },
      ],
      errors: [],
    });
    mocks.buildAvailableActions.mockReturnValue([
      {
        actionKey: "claim_task",
        endpoint: "/api/admin/procedures/requests/pr-1/claim-task",
        method: "POST",
      },
      {
        actionKey: "complete_task",
        endpoint: "/api/admin/procedures/requests/pr-1/complete-task",
        method: "POST",
        expectedTaskDefinitionKey: "registrar_datos_iniciales",
      },
    ]);
    mocks.resolveTaskDisplayConfig.mockReturnValue({ title: "Registrar Datos Iniciales" });
  });

  it("devuelve acciones operativas dentro de operationalState", async () => {
    const request = new Request("http://localhost/api/admin/procedures/requests/pr-1");
    const response = await GET(request, { params: Promise.resolve({ id: "pr-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.localCase?.id).toBe("pr-1");
    expect(body.operationalState?.sourceOfTruth).toBe("camunda_live");
    expect(body.operationalState.availableActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CLAIM_TASK",
          endpoint: "/api/admin/procedures/requests/pr-1/claim-task",
        }),
        expect.objectContaining({
          action: "COMPLETE_TASK",
          endpoint: "/api/admin/procedures/requests/pr-1/complete-task",
        }),
      ])
    );
    expect(body.availableActions).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  request: null,
  enabledByProcedure: new Map(),
};

function buildProcedureRow(request, extra = {}) {
  return {
    id: request.id,
    user_id: request.user_id ?? null,
    channel: request.channel ?? "WEB",
    whatsapp_phone: request.whatsapp_phone ?? null,
    whatsapp_wa_id: request.whatsapp_wa_id ?? null,
    request_code: request.request_code ?? "TRA-TEST0001",
    procedure_type_id: request.procedure_type_id ?? null,
    procedure_code: request.procedure_code ?? "test_proc",
    procedure_name: request.procedure_name ?? "Tramite de prueba",
    procedure_category: request.procedure_category ?? "",
    status: request.status ?? "PENDING_BACKOFFICE_ACTION",
    summary: request.summary ?? "",
    collected_data_json: request.collected_data_json ?? {},
    camunda_process_instance_key: request.camunda_process_instance_key ?? null,
    camunda_process_definition_id: request.camunda_process_definition_id ?? null,
    camunda_process_version: request.camunda_process_version ?? null,
    camunda_task_definition_key: request.camunda_task_definition_key ?? null,
    current_task_definition_key: request.current_task_definition_key ?? null,
    camunda_metadata_json: request.camunda_metadata_json ?? {},
    camunda_error_summary: request.camunda_error_summary ?? null,
    task_assignee_id: request.task_assignee_id ?? null,
    inbox_owner_user_id: request.inbox_owner_user_id ?? null,
    inbox_owner_assigned_at: request.inbox_owner_assigned_at ?? null,
    task_claimed_at: request.task_claimed_at ?? null,
    task_claim_expires_at: request.task_claim_expires_at ?? null,
    sync_retry_count: 0,
    sync_max_retry_count: 3,
    sync_last_retry_at: null,
    sync_next_retry_at: null,
    auto_sync_retry_enabled: true,
    sla_deadline: null,
    is_escalated: false,
    escalated_at: null,
    waiting_citizen_info_started_at: null,
    waiting_citizen_info_deadline: null,
    closed_at: null,
    created_at: request.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: request.updated_at ?? "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const sqlMock = vi.fn(async (strings, ...values) => {
  const query = String(strings.join(" ")).replace(/\s+/g, " ").trim();

  if (query.includes("SELECT") && query.includes("FROM chatbot_procedure_requests") && query.includes("WHERE id =")) {
    const requestId = values.find((value) => typeof value === "string" && value === state.request?.id);
    if (!state.request || !requestId) {
      return [];
    }
    return [buildProcedureRow(state.request)];
  }

  if (
    query.includes("SELECT") &&
    query.includes("AS assignment_scope") &&
    query.includes("FROM chatbot_procedure_requests pr") &&
    query.includes("WHERE pr.id =")
  ) {
    const funcionarioId = values.find((value) => typeof value === "string" && value.startsWith("func-"));
    const requestId = values.find((value) => typeof value === "string" && value === state.request?.id);
    if (!state.request || !funcionarioId || !requestId) {
      return [];
    }
    const owner = state.request.inbox_owner_user_id || null;
    const canTakeType = Boolean(
      state.request.procedure_type_id &&
        state.enabledByProcedure.get(state.request.procedure_type_id)?.has(funcionarioId)
    );
    const assignmentScope =
      owner === funcionarioId ? "assigned_to_me" : owner === null && canTakeType ? "available" : null;
    return [{ assignment_scope: assignmentScope }];
  }

  if (query.includes("UPDATE chatbot_procedure_requests pr") && query.includes("inbox_owner_user_id =")) {
    const funcionarioId = values.find((value) => typeof value === "string" && value.startsWith("func-"));
    const requestId = values.find((value) => typeof value === "string" && value === state.request?.id);
    if (!state.request || !funcionarioId || !requestId) {
      return [];
    }
    const canTakeType = Boolean(
      state.request.procedure_type_id &&
        state.enabledByProcedure.get(state.request.procedure_type_id)?.has(funcionarioId)
    );
    if (state.request.inbox_owner_user_id || !canTakeType) {
      return [];
    }
    state.request = {
      ...state.request,
      inbox_owner_user_id: funcionarioId,
      inbox_owner_assigned_at: "2026-01-02T10:00:00.000Z",
      updated_at: "2026-01-02T10:00:00.000Z",
    };
    return [
      buildProcedureRow(state.request, {
        assignment_scope: "assigned_to_me",
        is_assigned_to_me: true,
        is_available_to_claim: false,
      }),
    ];
  }

  if (
    query.includes("SELECT") &&
    query.includes("FROM chatbot_procedure_requests pr") &&
    query.includes("is_available_to_claim")
  ) {
    const funcionarioId = values.find((value) => typeof value === "string" && value.startsWith("func-"));
    if (!state.request || !funcionarioId) {
      return [];
    }
    const owner = state.request.inbox_owner_user_id || null;
    const canTakeType = Boolean(
      state.request.procedure_type_id &&
        state.enabledByProcedure.get(state.request.procedure_type_id)?.has(funcionarioId)
    );
    if (owner === funcionarioId) {
      return [
        buildProcedureRow(state.request, {
          assignment_scope: "assigned_to_me",
          is_assigned_to_me: true,
          is_available_to_claim: false,
        }),
      ];
    }
    if (owner === null && canTakeType) {
      return [
        buildProcedureRow(state.request, {
          assignment_scope: "available",
          is_assigned_to_me: false,
          is_available_to_claim: true,
        }),
      ];
    }
    return [];
  }

  return [];
});
sqlMock.unsafe = vi.fn(async () => []);

vi.mock("../db", () => ({
  ensureDatabase: () => sqlMock,
}));

vi.mock("../auth", () => ({
  ensureAuthSchema: vi.fn(async () => {}),
}));

vi.mock("../procedureAssignments", () => ({
  ensureProcedureAssignmentsSchema: vi.fn(async () => {}),
}));

import {
  claimProcedureRequestForFuncionarioInbox,
  listProcedureRequestsForFuncionarioInbox,
} from "../procedureRequests";
import { enrichProcedureRequestsForInbox } from "../procedureRequestInboxListHelpers";

describe("procedureRequests inbox ownership local", () => {
  beforeEach(() => {
    sqlMock.mockClear();
    sqlMock.unsafe.mockClear();
    state.enabledByProcedure = new Map([["proc-type-1", new Set(["func-1", "func-2"])]]);
    state.request = {
      id: "pr-1",
      procedure_type_id: "proc-type-1",
      inbox_owner_user_id: null,
      inbox_owner_assigned_at: null,
      task_assignee_id: "camunda-user-7",
      status: "PENDING_BACKOFFICE_ACTION",
    };
  });

  it("claim persiste owner local y no toca task_assignee_id", async () => {
    const result = await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-1",
    });

    expect(result.ok).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.rowsUpdated).toBe(1);
    expect(result.procedureRequest.assignedToUserId).toBe("func-1");
    expect(state.request.inbox_owner_user_id).toBe("func-1");
    expect(state.request.task_assignee_id).toBe("camunda-user-7");
  });

  it("post-claim + refresh mantienen asignacion y no vuelve Tomar expediente", async () => {
    const beforeClaim = await listProcedureRequestsForFuncionarioInbox({ funcionarioUserId: "func-1" });
    const beforeEnriched = await enrichProcedureRequestsForInbox(beforeClaim);
    expect(beforeEnriched[0].assignmentScope).toBe("available");
    expect(beforeEnriched[0].pendingAction).toBe("Tomar expediente");

    await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-1",
    });

    const afterClaim = await listProcedureRequestsForFuncionarioInbox({ funcionarioUserId: "func-1" });
    const firstRefresh = await enrichProcedureRequestsForInbox(afterClaim);
    const secondRefresh = await enrichProcedureRequestsForInbox(afterClaim);
    expect(firstRefresh[0].assignmentScope).toBe("assigned_to_me");
    expect(firstRefresh[0].isAvailableToClaim).toBe(false);
    expect(firstRefresh[0].pendingAction).not.toBe("Tomar expediente");
    expect(secondRefresh[0].assignmentScope).toBe("assigned_to_me");
  });

  it("otro funcionario recibe conflicto cuando ya tiene owner local distinto", async () => {
    await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-1",
    });

    const conflict = await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-2",
    });

    expect(conflict.ok).toBe(false);
    expect(conflict.reason).toBe("assigned_to_other");
  });

  it("enriquecimiento no borra inbox_owner_user_id aunque task_assignee sea null", async () => {
    await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId: "pr-1",
      funcionarioUserId: "func-1",
    });
    state.request.task_assignee_id = null;

    const listed = await listProcedureRequestsForFuncionarioInbox({ funcionarioUserId: "func-1" });
    const enriched = await enrichProcedureRequestsForInbox(listed);

    expect(enriched[0].assignedToUserId).toBe("func-1");
    expect(enriched[0].assignmentScope).toBe("assigned_to_me");
  });
});

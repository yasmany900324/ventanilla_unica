import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lastInsertProcedureValues;

const sqlMock = vi.fn(async (strings, ...values) => {
  const query = String(strings.join(" ")).replace(/\s+/g, " ").trim();

  if (query.includes("INSERT INTO chatbot_procedure_requests")) {
    lastInsertProcedureValues = values;
    const id = values[0];
    const requestCode = values[5];
    const procedureCode = values[7];
    const procedureName = values[8];
    const procedureCategory = values[9] ?? "";
    const status = values[10];
    const summary = values[11] ?? "";
    const collectedDataJson = values[12] ?? {};
    const camundaMetadataJson = values[18];

    return [
      {
        id,
        user_id: values[1],
        channel: values[2],
        whatsapp_phone: values[3],
        whatsapp_wa_id: values[4],
        request_code: requestCode,
        procedure_type_id: values[6],
        procedure_code: procedureCode,
        procedure_name: procedureName,
        procedure_category: procedureCategory,
        status,
        summary,
        collected_data_json: collectedDataJson,
        camunda_process_instance_key: null,
        camunda_process_definition_id: null,
        camunda_process_version: null,
        camunda_task_definition_key: null,
        current_task_definition_key: null,
        camunda_metadata_json: camundaMetadataJson,
        camunda_error_summary: null,
        task_assignee_id: null,
        inbox_owner_user_id: null,
        inbox_owner_assigned_at: null,
        task_claimed_at: null,
        task_claim_expires_at: null,
        sync_retry_count: 0,
        sync_max_retry_count: 3,
        sync_last_retry_at: null,
        sync_next_retry_at: null,
        auto_sync_retry_enabled: true,
        sla_deadline: values[30],
        is_escalated: false,
        escalated_at: null,
        waiting_citizen_info_started_at: null,
        waiting_citizen_info_deadline: null,
        closed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
  }

  if (query.includes("INSERT INTO chatbot_procedure_request_events")) {
    return [
      {
        id: "evt-test-1",
        procedure_request_id: values[1],
        type: values[2],
        previous_status: values[3],
        new_status: values[4],
        metadata_json: values[5] ?? {},
        actor_id: values[6],
        created_at: new Date().toISOString(),
      },
    ];
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

import * as procedureRequests from "../procedureRequests.js";

const { createProcedureRequest, DEFAULT_CAMUNDA_METADATA_ON_CREATE } = procedureRequests;

describe("createProcedureRequest persistencia", () => {
  beforeEach(() => {
    lastInsertProcedureValues = null;
    sqlMock.mockClear();
    sqlMock.unsafe.mockClear();
    vi.spyOn(procedureRequests, "ensureProcedureRequestSchema").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin camundaMetadata explícita inserta camunda_metadata_json no nulo con syncStatus PENDING", async () => {
    const created = await createProcedureRequest({
      whatsappWaId: "59811112222",
      channel: "WHATSAPP",
      procedureTypeId: "type-1",
      procedureCode: "registrar_incidencia",
      procedureName: "Registrar incidencia",
      procedureCategory: "Incidencia",
      summary: "resumen",
      collectedData: { description: "x" },
    });

    expect(created.requestCode).toMatch(/^TRA-[A-F0-9]{8}$/u);
    expect(created.camundaMetadata).toEqual(DEFAULT_CAMUNDA_METADATA_ON_CREATE);
    expect(lastInsertProcedureValues).not.toBeNull();
    expect(lastInsertProcedureValues[18]).toEqual({ syncStatus: "PENDING" });
    expect(lastInsertProcedureValues[12]).toEqual({ description: "x" });
    expect(lastInsertProcedureValues[19]).toBeNull();
    expect(lastInsertProcedureValues[20]).toBeNull();
    expect(lastInsertProcedureValues[21]).toBeNull();
    expect(lastInsertProcedureValues[22]).toBeNull();
    expect(lastInsertProcedureValues[23]).toBeNull();
    expect(lastInsertProcedureValues[24]).toBeNull();
  });

  it("camundaMetadata explícito se fusiona sobre el valor por defecto", async () => {
    await createProcedureRequest({
      whatsappWaId: "59811112233",
      channel: "WHATSAPP",
      procedureTypeId: "type-1",
      procedureCode: "test_proc",
      procedureName: "Prueba",
      camundaMetadata: { traceId: "abc" },
    });
    expect(lastInsertProcedureValues[18]).toEqual({
      syncStatus: "PENDING",
      traceId: "abc",
    });
  });
});

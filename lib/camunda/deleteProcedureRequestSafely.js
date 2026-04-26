import {
  PROCEDURE_REQUEST_EVENT_TYPES,
  addProcedureRequestEvent,
  deleteProcedureRequestById,
  getProcedureRequestById,
} from "../procedureRequests";
import { CamundaClientError, deleteCamundaProcessInstance } from "./client";

const deleteInFlight = new Set();

function pickProcessInstanceKey(procedureRequest) {
  const directCandidates = [
    procedureRequest?.camundaProcessInstanceKey,
    procedureRequest?.processInstanceKey,
    procedureRequest?.processInstanceId,
    procedureRequest?.camundaInstanceId,
  ];
  for (const candidate of directCandidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  const metadata = procedureRequest?.camundaMetadata;
  if (metadata && typeof metadata === "object") {
    const fromMetadata = [
      metadata.processInstanceKey,
      metadata.processInstanceId,
      metadata.camundaInstanceId,
      metadata.instanceKey,
    ];
    for (const candidate of fromMetadata) {
      const normalized = String(candidate || "").trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

function summarizeError(error) {
  if (!error) {
    return "unknown_error";
  }
  if (error instanceof CamundaClientError) {
    return error.message.slice(0, 500);
  }
  if (typeof error?.message === "string") {
    return error.message.slice(0, 500);
  }
  return String(error).slice(0, 500);
}

async function logEventSafe(input) {
  try {
    await addProcedureRequestEvent(input);
  } catch (error) {
    console.warn("[case-delete] no se pudo guardar evento técnico", {
      procedureRequestId: input?.procedureRequestId || null,
      type: input?.type || null,
      error: summarizeError(error),
    });
  }
}

export async function deleteProcedureRequestSafely({ procedureRequestId, actorId = null } = {}) {
  const normalizedId = String(procedureRequestId || "").trim();
  if (!normalizedId) {
    return { ok: false, reason: "invalid_procedure_request_id" };
  }
  if (deleteInFlight.has(normalizedId)) {
    return { ok: false, reason: "delete_in_progress" };
  }
  deleteInFlight.add(normalizedId);
  try {
    const procedureRequest = await getProcedureRequestById(normalizedId);
    if (!procedureRequest) {
      return { ok: true, alreadyDeleted: true, reason: "procedure_not_found" };
    }
    const processInstanceKey = pickProcessInstanceKey(procedureRequest);

    await logEventSafe({
      procedureRequestId: procedureRequest.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.CASE_DELETE_REQUESTED,
      previousStatus: procedureRequest.status,
      newStatus: procedureRequest.status,
      metadata: {
        requestCode: procedureRequest.requestCode || null,
        hasCamundaInstance: Boolean(processInstanceKey),
      },
      actorId: actorId || null,
    });

    if (processInstanceKey) {
      await logEventSafe({
        procedureRequestId: procedureRequest.id,
        type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_DELETE_STARTED,
        previousStatus: procedureRequest.status,
        newStatus: procedureRequest.status,
        metadata: { processInstanceKey },
        actorId: actorId || null,
      });
      try {
        const camundaResult = await deleteCamundaProcessInstance(processInstanceKey);
        await logEventSafe({
          procedureRequestId: procedureRequest.id,
          type: camundaResult?.alreadyMissing
            ? PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_INSTANCE_ALREADY_MISSING
            : PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_DELETE_OK,
          previousStatus: procedureRequest.status,
          newStatus: procedureRequest.status,
          metadata: {
            processInstanceKey,
            status: camundaResult?.status || null,
            alreadyMissing: camundaResult?.alreadyMissing === true,
          },
          actorId: actorId || null,
        });
      } catch (error) {
        const errorSummary = summarizeError(error);
        await logEventSafe({
          procedureRequestId: procedureRequest.id,
          type: PROCEDURE_REQUEST_EVENT_TYPES.CAMUNDA_DELETE_FAILED,
          previousStatus: procedureRequest.status,
          newStatus: procedureRequest.status,
          metadata: {
            processInstanceKey,
            error: errorSummary,
          },
          actorId: actorId || null,
        });
        await logEventSafe({
          procedureRequestId: procedureRequest.id,
          type: PROCEDURE_REQUEST_EVENT_TYPES.CASE_DELETE_FAILED,
          previousStatus: procedureRequest.status,
          newStatus: procedureRequest.status,
          metadata: {
            stage: "camunda_delete",
            error: errorSummary,
          },
          actorId: actorId || null,
        });
        return {
          ok: false,
          reason: "camunda_delete_failed",
          error: errorSummary,
          processInstanceKey,
        };
      }
    }

    await logEventSafe({
      procedureRequestId: procedureRequest.id,
      type: PROCEDURE_REQUEST_EVENT_TYPES.CASE_DELETE_DB_STARTED,
      previousStatus: procedureRequest.status,
      newStatus: procedureRequest.status,
      metadata: { requestCode: procedureRequest.requestCode || null },
      actorId: actorId || null,
    });

    const dbDeleteResult = await deleteProcedureRequestById(procedureRequest.id);
    if (!dbDeleteResult?.ok || dbDeleteResult.deleted !== true) {
      await logEventSafe({
        procedureRequestId: procedureRequest.id,
        type: PROCEDURE_REQUEST_EVENT_TYPES.CASE_DELETE_DB_FAILED,
        previousStatus: procedureRequest.status,
        newStatus: procedureRequest.status,
        metadata: {
          reason: dbDeleteResult?.reason || "db_delete_failed",
        },
        actorId: actorId || null,
      });
      return {
        ok: false,
        reason: "db_delete_failed",
        error: "No se pudo eliminar el expediente en base de datos.",
      };
    }

    // El historial técnico cuelga de la misma entidad y se elimina por cascada.
    // Dejamos traza explícita de auditoría en logs de servidor.
    console.info("[case-delete] expediente eliminado", {
      procedureRequestId: procedureRequest.id,
      requestCode: procedureRequest.requestCode || null,
      actorId: actorId || null,
      processInstanceKey: processInstanceKey || null,
      eventType: PROCEDURE_REQUEST_EVENT_TYPES.CASE_DELETE_DB_OK,
    });
    return {
      ok: true,
      deleted: true,
      requestCode: procedureRequest.requestCode || null,
      processInstanceKey: processInstanceKey || null,
    };
  } finally {
    deleteInFlight.delete(normalizedId);
  }
}

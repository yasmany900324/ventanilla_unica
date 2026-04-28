import { sanitizeForLogs } from "../logging/sanitizeForLogs";
import { getLiveCamundaTaskSnapshot } from "./getLiveCamundaTaskSnapshot";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForCamundaSnapshotChange({
  procedureRequest,
  actorId = null,
  action = "unknown",
  predicate,
  timeoutMs = 5000,
  intervalMs = 500,
} = {}) {
  const startedAt = Date.now();
  const safeTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Math.max(0, Number(timeoutMs)) : 5000;
  const safeIntervalMs = Number.isFinite(Number(intervalMs)) ? Math.max(50, Number(intervalMs)) : 500;
  const normalizedPredicate = typeof predicate === "function" ? predicate : () => false;
  const procedureRequestId = String(procedureRequest?.id || "").trim() || null;
  const processInstanceKey = String(procedureRequest?.camundaProcessInstanceKey || "").trim() || null;

  let attempts = 0;
  let lastSnapshot = null;
  let confirmed = false;

  do {
    attempts += 1;
    lastSnapshot = await getLiveCamundaTaskSnapshot({
      procedureRequest,
      actorId,
    });
    if (normalizedPredicate(lastSnapshot)) {
      confirmed = true;
      break;
    }
    if (Date.now() - startedAt >= safeTimeoutMs) {
      break;
    }
    await delay(safeIntervalMs);
  } while (true);

  console.info(
    "[camunda] snapshot wait finished",
    sanitizeForLogs({
      procedureRequestId,
      processInstanceKey,
      action: String(action || "unknown").trim() || "unknown",
      attempts,
      confirmed,
      timeoutMs: safeTimeoutMs,
    })
  );

  return {
    confirmed,
    attempts,
    snapshot: lastSnapshot,
  };
}

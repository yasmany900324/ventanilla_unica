const PENDING_SYNC_NOTICE =
  "La acción fue enviada a Camunda. El estado puede tardar unos segundos en actualizarse.";

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canRunFuncionarioAction(actionLoadingKey) {
  return !String(actionLoadingKey || "").trim();
}

export async function syncFuncionarioActionDetail({
  syncStatus,
  procedureRequestId,
  loadDetail,
  setActionInfoMessage,
  waitMs = 1700,
  waitFn = defaultWait,
}) {
  setActionInfoMessage("Actualizando estado del trámite...");
  await loadDetail(procedureRequestId);
  if (String(syncStatus || "").trim().toLowerCase() === "pending") {
    setActionInfoMessage(PENDING_SYNC_NOTICE);
    await waitFn(waitMs);
    await loadDetail(procedureRequestId);
    return { pending: true };
  }
  setActionInfoMessage("");
  return { pending: false };
}

export const FUNCIONARIO_PENDING_SYNC_NOTICE = PENDING_SYNC_NOTICE;

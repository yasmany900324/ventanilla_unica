import { describe, expect, it, vi } from "vitest";
import {
  canRunFuncionarioAction,
  FUNCIONARIO_PENDING_SYNC_NOTICE,
  syncFuncionarioActionDetail,
} from "../funcionarioActionSync";

describe("funcionarioActionSync", () => {
  it("evita doble submit cuando ya hay acción en curso", () => {
    expect(canRunFuncionarioAction("complete_task:/api/foo")).toBe(false);
    expect(canRunFuncionarioAction("")).toBe(true);
  });

  it("muestra loading de sincronización y hace un único refresh en confirmed", async () => {
    const setActionInfoMessage = vi.fn();
    const loadDetail = vi.fn().mockResolvedValue(undefined);

    const out = await syncFuncionarioActionDetail({
      syncStatus: "confirmed",
      procedureRequestId: "pr-1",
      loadDetail,
      setActionInfoMessage,
      waitFn: vi.fn(),
    });

    expect(out.pending).toBe(false);
    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(setActionInfoMessage).toHaveBeenNthCalledWith(1, "Actualizando estado del trámite...");
    expect(setActionInfoMessage).toHaveBeenLastCalledWith("");
  });

  it("en pending muestra aviso y ejecuta segundo refresh", async () => {
    const setActionInfoMessage = vi.fn();
    const loadDetail = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue(undefined);

    const out = await syncFuncionarioActionDetail({
      syncStatus: "pending",
      procedureRequestId: "pr-2",
      loadDetail,
      setActionInfoMessage,
      waitMs: 1700,
      waitFn,
    });

    expect(out.pending).toBe(true);
    expect(loadDetail).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledWith(1700);
    expect(setActionInfoMessage).toHaveBeenNthCalledWith(1, "Actualizando estado del trámite...");
    expect(setActionInfoMessage).toHaveBeenNthCalledWith(2, FUNCIONARIO_PENDING_SYNC_NOTICE);
  });
});

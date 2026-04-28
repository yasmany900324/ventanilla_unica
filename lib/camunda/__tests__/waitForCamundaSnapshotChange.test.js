import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLiveCamundaTaskSnapshot: vi.fn(),
}));

vi.mock("../getLiveCamundaTaskSnapshot", () => ({
  getLiveCamundaTaskSnapshot: mocks.getLiveCamundaTaskSnapshot,
}));

import { waitForCamundaSnapshotChange } from "../waitForCamundaSnapshotChange";

describe("waitForCamundaSnapshotChange", () => {
  it("confirma cuando el predicate se cumple", async () => {
    mocks.getLiveCamundaTaskSnapshot
      .mockResolvedValueOnce({
        activeTask: { exists: true, assignee: null },
      })
      .mockResolvedValueOnce({
        activeTask: { exists: true, assignee: "func-1" },
      });

    const result = await waitForCamundaSnapshotChange({
      procedureRequest: { id: "pr-1", camundaProcessInstanceKey: "123" },
      actorId: "func-1",
      action: "claim_task",
      timeoutMs: 100,
      intervalMs: 1,
      predicate: (snapshot) => String(snapshot?.activeTask?.assignee || "") === "func-1",
    });

    expect(result.confirmed).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.snapshot?.activeTask?.assignee).toBe("func-1");
  });

  it("retorna pending (confirmed=false) cuando vence timeout", async () => {
    mocks.getLiveCamundaTaskSnapshot.mockResolvedValue({
      activeTask: { exists: true, assignee: null },
    });

    const result = await waitForCamundaSnapshotChange({
      procedureRequest: { id: "pr-2", camundaProcessInstanceKey: "456" },
      actorId: "func-2",
      action: "claim_task",
      timeoutMs: 0,
      intervalMs: 1,
      predicate: (snapshot) => String(snapshot?.activeTask?.assignee || "") === "func-2",
    });

    expect(result.confirmed).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.snapshot?.activeTask?.assignee).toBeNull();
  });
});

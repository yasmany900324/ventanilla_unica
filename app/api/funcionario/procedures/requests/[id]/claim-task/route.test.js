import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postClaimExpediente: vi.fn(),
}));

vi.mock("../claim-expediente/route", () => ({
  POST: mocks.postClaimExpediente,
}));

import { POST } from "./route";

describe("api/funcionario/procedures/requests/[id]/claim-task POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postClaimExpediente.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("mantiene compatibilidad delegando al endpoint explícito", async () => {
    const response = await POST(new Request("http://localhost/api/funcionario/procedures/requests/pr-1/claim-task"), {
      params: Promise.resolve({ id: "pr-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.postClaimExpediente).toHaveBeenCalledTimes(1);
    expect(response.headers.get("X-Endpoint-Deprecated")).toBe("true");
    expect(response.headers.get("X-Endpoint-Replacement")).toContain("/claim-expediente");
  });
});

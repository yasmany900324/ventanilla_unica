import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCamundaProcessInstance,
  getCamundaBaseUrl,
  normalizeOrchestrationV2Base,
  resetCamundaClientForTests,
} from "../client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  resetCamundaClientForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeOrchestrationV2Base", () => {
  it("añade /v2 si falta", () => {
    expect(normalizeOrchestrationV2Base("https://example.com/cluster")).toBe("https://example.com/cluster/v2");
  });

  it("no duplica /v2 y quita slash final", () => {
    expect(normalizeOrchestrationV2Base("https://example.com/cluster/v2/")).toBe("https://example.com/cluster/v2");
  });
});

describe("getCamundaBaseUrl", () => {
  it("prioriza CAMUNDA_REST_ADDRESS sobre ZEEBE_REST_ADDRESS", () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://a.example/v2";
    process.env.ZEEBE_REST_ADDRESS = "https://b.example/v2";
    expect(getCamundaBaseUrl()).toBe("https://a.example/v2");
  });

  it("construye URL SaaS con región e id de clúster", () => {
    delete process.env.CAMUNDA_REST_ADDRESS;
    delete process.env.ZEEBE_REST_ADDRESS;
    process.env.CAMUNDA_CLUSTER_REGION = "bru-2";
    process.env.CAMUNDA_CLUSTER_ID = "cluster-uuid";
    expect(getCamundaBaseUrl()).toBe("https://bru-2.api.camunda.io/cluster-uuid/v2");
  });
});

describe("createCamundaProcessInstance", () => {
  it("POST con bearer y cuerpo processDefinitionId + variables", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "dummy",
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            processInstanceKey: "2251799813686019",
            processDefinitionId: "seguimiento_incidencia",
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const out = await createCamundaProcessInstance({
      processId: "seguimiento_incidencia",
      variables: { localCaseId: "x" },
    });

    expect(out.processInstanceKey).toBe("2251799813686019");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, initOptions] = fetchMock.mock.calls[1];
    expect(initOptions.method).toBe("POST");
    expect(initOptions.headers.Authorization).toBe("Bearer dummy");
    const body = JSON.parse(initOptions.body);
    expect(body.processDefinitionId).toBe("seguimiento_incidencia");
    expect(body.variables.localCaseId).toBe("x");
  });
});

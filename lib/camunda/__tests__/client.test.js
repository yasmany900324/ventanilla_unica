import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CamundaClientError,
  createCamundaProcessInstance,
  deleteCamundaProcessInstance,
  getCamundaBaseUrl,
  getCamundaOAuthAudience,
  getCamundaProcessDefinitionXml,
  normalizeOrchestrationV2Base,
  resetCamundaClientForTests,
  searchCamundaProcessDefinitions,
  searchCamundaUserTasks,
  buildUserTaskSearchPayload,
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

describe("getCamundaOAuthAudience", () => {
  it("respeta CAMUNDA_TOKEN_AUDIENCE", () => {
    process.env.CAMUNDA_TOKEN_AUDIENCE = "zeebe.camunda.io";
    delete process.env.ZEEBE_TOKEN_AUDIENCE;
    expect(getCamundaOAuthAudience()).toBe("zeebe.camunda.io");
  });
});

describe("buildUserTaskSearchPayload", () => {
  it("omitStateFromFilter deja solo processInstanceKey en filter (diagnóstico B)", () => {
    const body = buildUserTaskSearchPayload({
      processInstanceKey: "2251799813704048",
      pageSize: 25,
      omitStateFromFilter: true,
    });
    expect(body).toEqual({
      filter: { processInstanceKey: "2251799813704048" },
      page: { limit: 25 },
    });
  });
});

describe("searchCamundaUserTasks", () => {
  it("POST filter+page.limit según Orchestration REST v2", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () =>
          JSON.stringify({
            items: [{ userTaskKey: "1", taskDefinitionId: "t1", state: "CREATED" }],
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    await searchCamundaUserTasks({
      processInstanceKey: "2251799813692030",
      state: "created",
      pageSize: 25,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, opts] = fetchMock.mock.calls[1];
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      filter: { state: "CREATED", processInstanceKey: "2251799813692030" },
      page: { limit: 25 },
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://gw.example/v2/user-tasks/search");
  });

  it("HTTP 400 incluye errorCode CAMUNDA_TASK_SEARCH_BAD_REQUEST", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ "content-type": "application/problem+json" }),
        text: async () => JSON.stringify({ type: "about:blank", title: "Bad Request", detail: "invalid filter" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      searchCamundaUserTasks({ processInstanceKey: "2251799813692030", state: "INVALID_ENUM_STATE" })
    ).rejects.toSatisfy(
      (err) =>
        err instanceof CamundaClientError &&
        err.status === 400 &&
        err.errorCode === "CAMUNDA_TASK_SEARCH_BAD_REQUEST"
    );
  });

  it("remapea ASSIGNED a CREATED para no enviar enum inválido", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ items: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await searchCamundaUserTasks({ processInstanceKey: "2251799813692030", state: "ASSIGNED" });
    const [, opts] = fetchMock.mock.calls[1];
    const body = JSON.parse(opts.body);
    expect(body.filter.state).toBe("CREATED");
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

describe("deleteCamundaProcessInstance", () => {
  it("trata 404 confirmado como instancia ya faltante", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await deleteCamundaProcessInstance("2251");
    expect(out.ok).toBe(true);
    expect(out.alreadyMissing).toBe(true);
  });

  it("usa fallback DELETE cuando cancellation responde 405", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 405,
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await deleteCamundaProcessInstance("2251");
    expect(out.ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toContain("/process-instances/2251/cancellation");
    expect(fetchMock.mock.calls[2][0]).toContain("/process-instances/2251");
  });

  it("propaga error de red/timeout como fallo bloqueante", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockRejectedValueOnce(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteCamundaProcessInstance("2251")).rejects.toBeInstanceOf(Error);
  });
});

describe("getCamundaProcessDefinitionXml", () => {
  it("GET /process-definitions/{key}/xml y devuelve XML cuando el cuerpo es texto", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const xml = '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/xml" }),
        text: async () => xml,
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await getCamundaProcessDefinitionXml("Process_x:1:key");
    expect(out).toBe(xml);
    expect(fetchMock.mock.calls[1][0]).toContain("/process-definitions/");
    expect(fetchMock.mock.calls[1][0]).toContain("%3A");
    expect(fetchMock.mock.calls[1][0]).toContain("/xml");
  });

  it("interpreta JSON con campo xml", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const xml = "<bpmn/>";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ xml }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await getCamundaProcessDefinitionXml("def-key");
    expect(out).toBe(xml);
  });

  it("usa processDefinitionKey numérico en la URL de xml", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/xml" }),
        text: async () => "<bpmn/>",
      });
    vi.stubGlobal("fetch", fetchMock);
    await getCamundaProcessDefinitionXml("2251799813689999");
    expect(fetchMock.mock.calls[1][0]).toContain("/process-definitions/2251799813689999/xml");
  });
});

describe("searchCamundaProcessDefinitions", () => {
  it("busca por processDefinitionId (bpmnProcessId textual) y devuelve items", async () => {
    process.env.CAMUNDA_REST_ADDRESS = "https://gw.example/v2";
    process.env.CAMUNDA_CLIENT_ID = "client";
    process.env.CAMUNDA_CLIENT_SECRET = "secret";
    process.env.CAMUNDA_OAUTH_URL = "https://login.example/oauth/token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "dummy", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ processDefinitionKey: "2251799813689999" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchCamundaProcessDefinitions({ bpmnProcessId: "Process_1hvmc45", pageSize: 3 });
    expect(out).toHaveLength(1);
    const [, request] = fetchMock.mock.calls[1];
    const body = JSON.parse(request.body);
    expect(body.filter.processDefinitionId).toBe("Process_1hvmc45");
  });
});

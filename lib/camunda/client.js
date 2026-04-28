import { sanitizeForLogs } from "../logging/sanitizeForLogs";

const LOG_PREFIX = "[camunda]";

/** @type {{ token: string, expiresAtMs: number } | null} */
let tokenCache = null;

/** Solo tests: limpia cache de token entre casos. */
export function resetCamundaClientForTests() {
  tokenCache = null;
}

export class CamundaClientError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, detail?: unknown, errorCode?: string }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.name = "CamundaClientError";
    this.status = extra.status;
    this.detail = extra.detail;
    this.errorCode = extra.errorCode;
  }
}

/**
 * Normaliza la base REST v2 (sin slash final).
 * @param {string} raw
 */
export function normalizeOrchestrationV2Base(raw) {
  const trimmed = raw.trim().replace(/\/+$/u, "");
  if (/\/v2$/iu.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v2`;
}

/**
 * URL base del Orchestration Cluster (incluye `/v2`).
 * Prioridad: CAMUNDA_REST_ADDRESS → ZEEBE_REST_ADDRESS → construcción SaaS con región + cluster.
 * @returns {string|null}
 */
export function getCamundaBaseUrl() {
  const explicit = process.env.CAMUNDA_REST_ADDRESS || process.env.ZEEBE_REST_ADDRESS;
  if (typeof explicit === "string" && explicit.trim()) {
    return normalizeOrchestrationV2Base(explicit);
  }

  const region = typeof process.env.CAMUNDA_CLUSTER_REGION === "string" ? process.env.CAMUNDA_CLUSTER_REGION.trim() : "";
  const clusterId = typeof process.env.CAMUNDA_CLUSTER_ID === "string" ? process.env.CAMUNDA_CLUSTER_ID.trim() : "";
  if (region && clusterId) {
    return `https://${region}.api.camunda.io/${clusterId}/v2`;
  }

  return null;
}

function getOAuthCredentials() {
  const clientId = typeof process.env.CAMUNDA_CLIENT_ID === "string" ? process.env.CAMUNDA_CLIENT_ID.trim() : "";
  const clientSecret =
    typeof process.env.CAMUNDA_CLIENT_SECRET === "string" ? process.env.CAMUNDA_CLIENT_SECRET.trim() : "";
  const oauthUrl = typeof process.env.CAMUNDA_OAUTH_URL === "string" ? process.env.CAMUNDA_OAUTH_URL.trim() : "";
  const audience =
    (typeof process.env.CAMUNDA_TOKEN_AUDIENCE === "string" && process.env.CAMUNDA_TOKEN_AUDIENCE.trim()) ||
    (typeof process.env.ZEEBE_TOKEN_AUDIENCE === "string" && process.env.ZEEBE_TOKEN_AUDIENCE.trim()) ||
    "zeebe-api";

  return { clientId, clientSecret, oauthUrl, audience };
}

/**
 * Audience OAuth configurado (mismo valor que en client_credentials).
 * En SaaS, `zeebe-api` / `zeebe.camunda.io` apuntan al clúster; el Orchestration REST `/v2` usa ese token, no el de Tasklist API aparte.
 * @returns {string}
 */
export function getCamundaOAuthAudience() {
  return getOAuthCredentials().audience;
}

/**
 * URL sin credenciales embebidas ni query (evita filtrar tokens accidentales en logs).
 * @param {string} href
 */
function urlForLogs(href) {
  try {
    const u = new URL(href);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "[invalid_url]";
  }
}

/** @param {Headers} headers */
function sanitizeResponseHeadersForLogs(headers) {
  /** @type {Record<string, string>} */
  const out = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "set-cookie" || lower === "cookie") {
      return;
    }
    out[key] = value.length > 400 ? `${value.slice(0, 400)}…` : value;
  });
  return sanitizeForLogs(out);
}

function accessTokenExpiryMs(accessToken, fallbackSeconds) {
  try {
    const parts = accessToken.split(".");
    if (parts.length === 3) {
      const json = Buffer.from(parts[1], "base64url").toString("utf8");
      const payload = JSON.parse(json);
      if (payload && typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
        return payload.exp * 1000 - 60_000;
      }
    }
  } catch {
    /* ignore */
  }
  return Date.now() + Math.max(60, fallbackSeconds) * 1000 - 60_000;
}

/**
 * OAuth2 client_credentials para Camunda 8 SaaS.
 * Cache en memoria del token para respetar rate limits de OAuth (~1 req/s por IP).
 * @returns {Promise<string>}
 */
export async function getCamundaAccessToken() {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAtMs) {
    return tokenCache.token;
  }

  const { clientId, clientSecret, oauthUrl, audience } = getOAuthCredentials();
  if (!clientId || !clientSecret || !oauthUrl) {
    throw new CamundaClientError("Camunda OAuth: faltan CAMUNDA_CLIENT_ID, CAMUNDA_CLIENT_SECRET o CAMUNDA_OAUTH_URL.");
  }

  // No registrar secretos; el audience es seguro.
  console.info(`${LOG_PREFIX} Solicitando access token OAuth (audience=${audience})`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    audience,
  });

  const res = await fetch(oauthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.error(
      `${LOG_PREFIX} Error OAuth`,
      sanitizeForLogs({ status: res.status, body: json ?? rawText?.slice(0, 500) })
    );
    throw new CamundaClientError(`Camunda OAuth falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 500),
    });
  }

  const accessToken = json && typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) {
    console.error(`${LOG_PREFIX} Respuesta OAuth sin access_token`, sanitizeForLogs(json));
    throw new CamundaClientError("Camunda OAuth: respuesta sin access_token.");
  }

  const expiresIn =
    json && typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
  const expiresAtMs = accessTokenExpiryMs(accessToken, expiresIn);
  tokenCache = { token: accessToken, expiresAtMs };

  console.info(`${LOG_PREFIX} Access token obtenido (expira aprox. ms=${expiresAtMs})`);
  return accessToken;
}

/**
 * Inicia una instancia de proceso por BPMN process id (processDefinitionId).
 * @param {{ processId: string, variables?: Record<string, unknown> }} params
 * @returns {Promise<Record<string, unknown>>}
 */
export async function createCamundaProcessInstance({ processId, variables = {} }) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError(
      "Camunda: no hay URL REST. Defina CAMUNDA_REST_ADDRESS o ZEEBE_REST_ADDRESS, o CAMUNDA_CLUSTER_REGION + CAMUNDA_CLUSTER_ID."
    );
  }
  if (typeof processId !== "string" || !processId.trim()) {
    throw new CamundaClientError("createCamundaProcessInstance: processId inválido.");
  }

  const token = await getCamundaAccessToken();
  const url = `${base}/process-instances`;

  const payload = {
    processDefinitionId: processId.trim(),
    variables: variables && typeof variables === "object" ? variables : {},
  };

  console.info(
    `${LOG_PREFIX} Iniciando instancia de proceso`,
    sanitizeForLogs({ processDefinitionId: payload.processDefinitionId, variableKeys: Object.keys(payload.variables) })
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.error(
      `${LOG_PREFIX} Error al crear instancia`,
      sanitizeForLogs({ status: res.status, body: json ?? rawText?.slice(0, 800) })
    );
    throw new CamundaClientError(`Camunda create process instance falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 800),
    });
  }

  console.info(
    `${LOG_PREFIX} Instancia creada`,
    sanitizeForLogs({
      processInstanceKey: json?.processInstanceKey,
      processDefinitionId: json?.processDefinitionId,
      processDefinitionKey: json?.processDefinitionKey,
    })
  );

  return json && typeof json === "object" ? json : {};
}

/**
 * Consulta una instancia por clave numérica (Orchestration REST GET /v2/process-instances/{key}).
 * @param {string|number} processInstanceKey
 * @returns {Promise<Record<string, unknown>|null>} null si 404
 */
export async function getCamundaProcessInstance(processInstanceKey) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError("Camunda: URL REST no configurada.");
  }
  const key = String(processInstanceKey ?? "").trim();
  if (!key) {
    throw new CamundaClientError("getCamundaProcessInstance: processInstanceKey inválido.");
  }

  const token = await getCamundaAccessToken();
  const url = `${base}/process-instances/${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  const rawText = await res.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new CamundaClientError(`Camunda get process instance falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 800),
    });
  }

  return json && typeof json === "object" ? json : {};
}

/**
 * Elimina/cancela una instancia de proceso en Camunda 8.
 * Para 404, confirma ausencia con GET para diferenciar "ya no existe" de un error ambiguo.
 *
 * @param {string|number} processInstanceKey
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, alreadyMissing?: boolean, status?: number }>}
 */
export async function deleteCamundaProcessInstance(processInstanceKey, options = {}) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError("Camunda: URL REST no configurada.");
  }
  const key = String(processInstanceKey ?? "").trim();
  if (!key) {
    throw new CamundaClientError("deleteCamundaProcessInstance: processInstanceKey inválido.");
  }
  const token = await getCamundaAccessToken();
  const timeoutMs =
    Number.isInteger(options?.timeoutMs) && options.timeoutMs >= 1000 ? Math.min(options.timeoutMs, 60_000) : 12_000;
  const requestHeaders = { Accept: "application/json", Authorization: `Bearer ${token}` };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("camunda_delete_timeout")), timeoutMs);
  try {
    // Camunda 8 Orchestration v2 commonly exposes cancellation via POST .../cancellation.
    // Some gateways may still accept DELETE on the instance resource. Try cancellation first.
    let res = await fetch(`${base}/process-instances/${encodeURIComponent(key)}/cancellation`, {
      method: "POST",
      headers: requestHeaders,
      signal: controller.signal,
    });
    if (res.status === 404) {
      const missing = await getCamundaProcessInstance(key);
      if (missing === null) {
        return { ok: true, alreadyMissing: true, status: 404 };
      }
    }
    if (res.status === 405 || res.status === 501) {
      res = await fetch(`${base}/process-instances/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: requestHeaders,
        signal: controller.signal,
      });
    }
    const rawText = await res.text();
    if (res.status === 404) {
      const missing = await getCamundaProcessInstance(key);
      if (missing === null) {
        return { ok: true, alreadyMissing: true, status: 404 };
      }
      throw new CamundaClientError("Camunda delete process instance recibió 404 sin confirmación de ausencia.", {
        status: 404,
        detail: rawText?.slice(0, 800),
      });
    }
    if (!res.ok) {
      let json = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }
      throw new CamundaClientError(`Camunda delete process instance falló (HTTP ${res.status}).`, {
        status: res.status,
        detail: json ?? rawText?.slice(0, 800),
      });
    }
    return { ok: true, status: res.status };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CamundaClientError(`Camunda delete process instance timeout (${timeoutMs}ms).`, {
        detail: "timeout",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Construye el body POST de `/v2/user-tasks/search` (Orchestration REST v2).
 * @param {{ processInstanceKey?: string|number|null, state?: string, pageSize?: number, omitStateFromFilter?: boolean }} params
 */
export function buildUserTaskSearchPayload({
  processInstanceKey = null,
  state = "CREATED",
  pageSize = 10,
  omitStateFromFilter = false,
} = {}) {
  const requestedState = typeof state === "string" && state.trim() ? state.trim().toUpperCase() : "CREATED";
  const stateNormalized = requestedState === "ASSIGNED" ? "CREATED" : requestedState;
  const pageLimit = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 50) : 10;
  /** @type {{ filter: Record<string, unknown>, page: { limit: number } }} */
  const payload = {
    filter: {},
    page: { limit: pageLimit },
  };
  if (!omitStateFromFilter) {
    payload.filter.state = stateNormalized;
  }
  const keyTrimmed =
    processInstanceKey != null && String(processInstanceKey).trim()
      ? String(processInstanceKey).trim()
      : "";
  if (keyTrimmed) {
    payload.filter.processInstanceKey = keyTrimmed;
  }
  return payload;
}

function sanitizeUserTaskSearchItemForLogs(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  return sanitizeForLogs({
    id: task.id ?? null,
    key: task.key ?? null,
    userTaskKey: task.userTaskKey ?? null,
    elementId: task.elementId ?? null,
    elementInstanceKey: task.elementInstanceKey ?? null,
    name: task.name ?? null,
    taskDefinitionId: task.taskDefinitionId ?? null,
    taskDefinitionKey: task.taskDefinitionKey ?? null,
    formKey: task.formKey ?? null,
    state: task.state ?? task.status ?? null,
    assignee: task.assignee ?? null,
    processInstanceKey: task.processInstanceKey ?? null,
  });
}

/**
 * POST `/v2/user-tasks/search` con payload explícito. Devuelve items + metadatos para logs y diagnóstico.
 * @param {{ filter: Record<string, unknown>, page: { limit: number } }} payload
 */
export async function executeCamundaUserTaskSearch(payload) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError("Camunda: URL REST no configurada.");
  }
  const token = await getCamundaAccessToken();
  const requestUrl = `${base}/user-tasks/search`;
  const res = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const audience = getCamundaOAuthAudience();
    let parsedRequestUrl = null;
    try {
      parsedRequestUrl = new URL(requestUrl);
    } catch {
      parsedRequestUrl = null;
    }
    const queryParams =
      parsedRequestUrl && parsedRequestUrl.search
        ? Object.fromEntries(parsedRequestUrl.searchParams.entries())
        : {};
    console.error(
      `${LOG_PREFIX} user-tasks/search falló`,
      sanitizeForLogs({
        orchestrationRestBaseUrl: urlForLogs(base),
        requestUrl: urlForLogs(requestUrl),
        httpMethod: "POST",
        endpointPath: "/user-tasks/search",
        oauthAudience: audience,
        requestPayload: payload,
        queryParams: Object.keys(queryParams).length ? queryParams : null,
        processInstanceKeyInFilter: payload?.filter?.processInstanceKey ?? null,
        processInstanceKeyInFilterTypeof: typeof payload?.filter?.processInstanceKey,
        stateInFilter: payload?.filter?.state ?? null,
        httpStatus: res.status,
        camundaResponseBody: json ?? rawText?.slice(0, 1200),
        responseHeaders: sanitizeResponseHeadersForLogs(res.headers),
        requestHeadersSafe: {
          "content-type": "application/json",
          accept: "application/json",
        },
      })
    );
    const errorCode = res.status === 400 ? "CAMUNDA_TASK_SEARCH_BAD_REQUEST" : undefined;
    throw new CamundaClientError(`Camunda search user tasks falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 800),
      errorCode,
    });
  }
  const items = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : [];
  return {
    orchestrationRestBaseUrl: urlForLogs(base),
    requestUrl: urlForLogs(requestUrl),
    method: "POST",
    endpoint: "/v2/user-tasks/search",
    requestPayload: payload,
    processInstanceKeyInFilter: payload?.filter?.processInstanceKey ?? null,
    processInstanceKeyInFilterTypeof: typeof payload?.filter?.processInstanceKey,
    statesConsulted: payload?.filter?.state ?? null,
    httpStatus: res.status,
    responseBodySanitized: sanitizeForLogs(json ?? rawText?.slice(0, 2000)),
    totalItems: items.length,
    firstItemSanitized: items[0] ? sanitizeUserTaskSearchItemForLogs(items[0]) : null,
    items,
  };
}

/**
 * Búsquedas de diagnóstico cuando la instancia está ACTIVE pero no hay user task mapeable.
 * @param {{ processInstanceKey: string, procedureRequestId?: string|null }} ctx
 */
export async function runCamundaUserTaskSearchDiagnosticQueries(ctx) {
  const processInstanceKey = String(ctx?.processInstanceKey || "").trim();
  if (!processInstanceKey) {
    return;
  }
  const procedureRequestId = ctx?.procedureRequestId ? String(ctx.procedureRequestId).trim() : null;

  const logDiag = (phase, meta) => {
    console.info(
      `${LOG_PREFIX} user-tasks/search diagnóstico`,
      sanitizeForLogs({
        phase,
        procedureRequestId,
        processInstanceKey,
        ...meta,
      })
    );
  };

  try {
    const payloadA = buildUserTaskSearchPayload({
      processInstanceKey,
      state: "CREATED",
      pageSize: 25,
      omitStateFromFilter: false,
    });
    const resultA = await executeCamundaUserTaskSearch(payloadA);
    logDiag("A_filter_processInstanceKey_and_CREATED", {
      requestPayload: sanitizeForLogs(payloadA),
      httpStatus: resultA.httpStatus,
      totalItems: resultA.totalItems,
      firstItemSanitized: resultA.firstItemSanitized,
      responseBodySanitized: resultA.responseBodySanitized,
    });
  } catch (error) {
    logDiag("A_error", {
      message: String(error?.message || "").slice(0, 400),
      status: error?.status,
      errorCode: error?.errorCode,
    });
  }

  try {
    const payloadB = buildUserTaskSearchPayload({
      processInstanceKey,
      pageSize: 25,
      omitStateFromFilter: true,
    });
    const resultB = await executeCamundaUserTaskSearch(payloadB);
    logDiag("B_filter_processInstanceKey_only", {
      requestPayload: sanitizeForLogs(payloadB),
      httpStatus: resultB.httpStatus,
      totalItems: resultB.totalItems,
      firstItemSanitized: resultB.firstItemSanitized,
      responseBodySanitized: resultB.responseBodySanitized,
    });
  } catch (error) {
    logDiag("B_rejected_or_error", {
      message: String(error?.message || "").slice(0, 400),
      status: error?.status,
      errorCode: error?.errorCode,
    });
  }

  try {
    const payloadC = buildUserTaskSearchPayload({
      processInstanceKey: null,
      state: "CREATED",
      pageSize: 10,
      omitStateFromFilter: false,
    });
    const resultC = await executeCamundaUserTaskSearch(payloadC);
    logDiag("C_filter_state_CREATED_limit_10", {
      requestPayload: sanitizeForLogs(payloadC),
      httpStatus: resultC.httpStatus,
      totalItems: resultC.totalItems,
      firstItemSanitized: resultC.firstItemSanitized,
      responseBodySanitized: resultC.responseBodySanitized,
    });
    if (resultC.totalItems > 0) {
      const samples = resultC.items.slice(0, 10).map((item) => sanitizeUserTaskSearchItemForLogs(item));
      logDiag("D_sample_tasks_from_C", { sampleCount: samples.length, samples: sanitizeForLogs(samples) });
    } else {
      logDiag("D_no_tasks_in_global_CREATED_sample", { note: "C returned zero items" });
    }
  } catch (error) {
    logDiag("C_error", {
      message: String(error?.message || "").slice(0, 400),
      status: error?.status,
      errorCode: error?.errorCode,
    });
  }
}

/**
 * Busca tareas de usuario por filtros (Camunda 8 Orchestration REST v2).
 * @param {{ processInstanceKey?: string|number, state?: string, pageSize?: number }} params
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function searchCamundaUserTasks({
  processInstanceKey = null,
  state = "CREATED",
  pageSize = 10,
} = {}) {
  const payload = buildUserTaskSearchPayload({ processInstanceKey, state, pageSize, omitStateFromFilter: false });
  const { items } = await executeCamundaUserTaskSearch(payload);
  return items;
}

/**
 * Completa una tarea de usuario en Camunda 8.
 * @param {string|number} taskId
 * @param {Record<string, unknown>} variables
 * @returns {Promise<void>}
 */
export async function completeCamundaUserTask(taskId, variables = {}) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError("Camunda: URL REST no configurada.");
  }
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new CamundaClientError("completeCamundaUserTask: taskId inválido.");
  }
  const token = await getCamundaAccessToken();
  const payload = {
    variables: variables && typeof variables === "object" ? variables : {},
  };
  console.info(
    `${LOG_PREFIX} Completando tarea de usuario`,
    sanitizeForLogs({ taskId: normalizedTaskId, variableKeys: Object.keys(payload.variables) })
  );
  const res = await fetch(`${base}/user-tasks/${encodeURIComponent(normalizedTaskId)}/completion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  if (!res.ok) {
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    throw new CamundaClientError(`Camunda complete task falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 800),
    });
  }
}

/**
 * Reclama (assign/claim) una tarea de usuario en Camunda 8 para un assignee local.
 * @param {string|number} taskId
 * @param {string} assignee
 * @returns {Promise<void>}
 */
export async function claimCamundaUserTask(taskId, assignee) {
  const base = getCamundaBaseUrl();
  if (!base) {
    throw new CamundaClientError("Camunda: URL REST no configurada.");
  }
  const normalizedTaskId = String(taskId || "").trim();
  const normalizedAssignee = String(assignee || "").trim();
  if (!normalizedTaskId) {
    throw new CamundaClientError("claimCamundaUserTask: taskId inválido.");
  }
  if (!normalizedAssignee) {
    throw new CamundaClientError("claimCamundaUserTask: assignee inválido.");
  }
  const token = await getCamundaAccessToken();
  const payload = { assignee: normalizedAssignee };
  const res = await fetch(`${base}/user-tasks/${encodeURIComponent(normalizedTaskId)}/assignment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  if (!res.ok) {
    let json = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    throw new CamundaClientError(`Camunda claim task falló (HTTP ${res.status}).`, {
      status: res.status,
      detail: json ?? rawText?.slice(0, 800),
    });
  }
}

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
   * @param {{ status?: number, detail?: unknown }} [extra]
   */
  constructor(message, extra = {}) {
    super(message);
    this.name = "CamundaClientError";
    this.status = extra.status;
    this.detail = extra.detail;
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

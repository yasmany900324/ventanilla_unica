import { formatIncidentCode } from "../incidentDisplay";

/**
 * Intenta extraer un texto de ubicación desde datos dinámicos de trámites.
 * @param {Record<string, unknown>|null|undefined} collected
 * @returns {string}
 */
export function pickLocationFromProcedureCollected(collected) {
  if (!collected || typeof collected !== "object") {
    return "";
  }
  const keys = ["location", "direccion", "domicilio", "address", "barrio", "lugar"];
  for (const k of keys) {
    const v = collected[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim().slice(0, 500);
    }
  }
  return "";
}

/**
 * Cuenta adjuntos heurísticamente en datos recolectados de trámite.
 * @param {Record<string, unknown>|null|undefined} collected
 * @returns {number}
 */
export function countProcedureAttachmentsHint(collected) {
  if (!collected || typeof collected !== "object") {
    return 0;
  }
  let n = 0;
  for (const [key, val] of Object.entries(collected)) {
    if (!/photo|archivo|adjunto|documento|file|attachment/i.test(key)) {
      continue;
    }
    if (typeof val === "string" && val.trim()) {
      n += 1;
    } else if (val && typeof val === "object") {
      n += 1;
    }
  }
  return Math.min(n, 20);
}

/**
 * Variables de proceso Camunda (objeto JSON plano; Orchestration REST v2).
 * @param {object} incident — fila mapeada de `createIncident` / `mapIncidentRow`
 * @param {object} [context]
 * @param {"web"|"whatsapp"} [context.channel]
 * @param {string|null} [context.risk]
 * @param {{ id?: string, fullName?: string, cedula?: string }|null} [context.authenticatedUser]
 * @returns {Record<string, unknown>}
 */
export function buildIncidentCamundaVariables(incident, context = {}) {
  const channel = context.channel === "whatsapp" ? "whatsapp" : "web";
  const risk =
    typeof context.risk === "string" && context.risk.trim() ? context.risk.trim().slice(0, 120) : null;
  const user = context.authenticatedUser && typeof context.authenticatedUser === "object" ? context.authenticatedUser : null;

  const attachmentsCount = incident?.hasAttachment ? 1 : 0;
  const createdAt =
    incident?.createdAt instanceof Date
      ? incident.createdAt.toISOString()
      : incident?.createdAt
        ? new Date(incident.createdAt).toISOString()
        : new Date().toISOString();

  const citizenId =
    typeof user?.cedula === "string" && user.cedula.trim()
      ? user.cedula.trim()
      : typeof user?.id === "string" && user.id.trim()
        ? user.id.trim()
        : null;

  return {
    localCaseId: incident.id,
    localCaseCode: formatIncidentCode(incident.id),
    caseType: "incident",
    channel,
    citizenId,
    citizenName: typeof user?.fullName === "string" && user.fullName.trim() ? user.fullName.trim() : null,
    description: typeof incident.description === "string" ? incident.description.slice(0, 4000) : "",
    location: typeof incident.location === "string" ? incident.location.slice(0, 500) : "",
    risk,
    attachmentsCount,
    createdAt,
    status: typeof incident.status === "string" ? incident.status : "recibido",
    category: typeof incident.category === "string" ? incident.category : "",
  };
}

/**
 * @param {object} procedure — fila mapeada de `createProcedureRequest` / `mapProcedureRequestRow`
 * @param {object} [context]
 * @param {"web"|"whatsapp"} [context.channel]
 * @param {{ id?: string, fullName?: string, cedula?: string }|null} [context.authenticatedUser]
 * @param {Record<string, unknown>|null} [context.procedureCollectedData]
 * @returns {Record<string, unknown>}
 */
export function buildTramiteCamundaVariables(procedure, context = {}) {
  const channel = context.channel === "whatsapp" ? "whatsapp" : "web";
  const user = context.authenticatedUser && typeof context.authenticatedUser === "object" ? context.authenticatedUser : null;
  const collected =
    context.procedureCollectedData && typeof context.procedureCollectedData === "object"
      ? context.procedureCollectedData
      : procedure?.collectedData && typeof procedure.collectedData === "object"
        ? procedure.collectedData
        : {};

  const location = pickLocationFromProcedureCollected(collected);
  const attachmentsCount = countProcedureAttachmentsHint(collected);
  const createdAt =
    procedure?.createdAt instanceof Date
      ? procedure.createdAt.toISOString()
      : procedure?.createdAt
        ? new Date(procedure.createdAt).toISOString()
        : new Date().toISOString();

  const citizenId =
    typeof user?.cedula === "string" && user.cedula.trim()
      ? user.cedula.trim()
      : typeof user?.id === "string" && user.id.trim()
        ? user.id.trim()
        : null;

  return {
    localCaseId: procedure.id,
    localCaseCode: typeof procedure.requestCode === "string" ? procedure.requestCode : "",
    caseType: "tramite",
    channel,
    citizenId,
    citizenName: typeof user?.fullName === "string" && user.fullName.trim() ? user.fullName.trim() : null,
    description: typeof procedure.summary === "string" ? procedure.summary.slice(0, 4000) : "",
    location,
    risk: null,
    attachmentsCount,
    createdAt,
    status: typeof procedure.status === "string" ? procedure.status : "recibido",
    procedureCode: typeof procedure.procedureCode === "string" ? procedure.procedureCode : "",
    procedureName: typeof procedure.procedureName === "string" ? procedure.procedureName : "",
    procedureCategory: typeof procedure.procedureCategory === "string" ? procedure.procedureCategory : "",
  };
}

const ROUTE_METADATA = {
  "/ciudadano/dashboard#nueva-incidencia": {
    label: "Crear una nueva incidencia",
  },
  "/mis-incidencias": {
    label: "Consultar el estado de mis incidencias",
  },
  "/#ayuda-soporte": {
    label: "Revisar ayuda y soporte",
  },
};

const ACTION_ROUTE_MAP = {
  crear_incidencia: "/ciudadano/dashboard#nueva-incidencia",
  reportar_problema: "/ciudadano/dashboard#nueva-incidencia",
  iniciar_tramite: "/ciudadano/dashboard#nueva-incidencia",
  consultar_tramite: "/mis-incidencias",
  consultar_estado_solicitud: "/mis-incidencias",
};

const INTENT_ROUTE_MAP = {
  crear_incidencia: "/ciudadano/dashboard#nueva-incidencia",
  reportar_problema: "/ciudadano/dashboard#nueva-incidencia",
  consultar_tramite: "/mis-incidencias",
  consultar_estado_solicitud: "/mis-incidencias",
  iniciar_tramite: "/ciudadano/dashboard#nueva-incidencia",
  ayuda_general: "/#ayuda-soporte",
};

function normalizeIntentKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

export function resolveChatbotRedirect({ action, intentDisplayName }) {
  const normalizedAction = normalizeIntentKey(action);
  if (normalizedAction && ACTION_ROUTE_MAP[normalizedAction]) {
    return ACTION_ROUTE_MAP[normalizedAction];
  }

  const normalizedIntent = normalizeIntentKey(intentDisplayName);
  if (normalizedIntent && INTENT_ROUTE_MAP[normalizedIntent]) {
    return INTENT_ROUTE_MAP[normalizedIntent];
  }

  return null;
}

export function getChatbotIntentRouteMap() {
  return {
    action: { ...ACTION_ROUTE_MAP },
    intent: { ...INTENT_ROUTE_MAP },
  };
}

export function getChatbotRouteMetadata(path) {
  if (!path || typeof path !== "string") {
    return null;
  }

  return ROUTE_METADATA[path] || null;
}

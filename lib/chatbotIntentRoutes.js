const ROUTE_METADATA = {
  "/asistente": {
    label: "Iniciar por chat",
  },
  "/mis-incidencias": {
    label: "Consultar el estado de mis incidencias",
  },
  "/#ayuda-soporte": {
    label: "Revisar ayuda y soporte",
  },
};

const ACTION_ROUTE_MAP = {
  crear_incidencia: "/asistente",
  reportar_problema: "/asistente",
  iniciar_tramite: "/asistente",
  consultar_tramite: "/mis-incidencias",
  consultar_estado_solicitud: "/mis-incidencias",
};

const INTENT_ROUTE_MAP = {
  crear_incidencia: "/asistente",
  reportar_problema: "/asistente",
  consultar_tramite: "/mis-incidencias",
  consultar_estado_solicitud: "/mis-incidencias",
  iniciar_tramite: "/asistente",
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

const sessionLocaleStore = new Map();

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") {
    return "";
  }

  return sessionId.trim();
}

export function getSessionLocale(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return null;
  }

  return sessionLocaleStore.get(normalizedSessionId) || null;
}

export function setSessionLocale(sessionId, locale) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId || typeof locale !== "string" || !locale.trim()) {
    return null;
  }

  const normalizedLocale = locale.trim().toLowerCase();
  sessionLocaleStore.set(normalizedSessionId, normalizedLocale);
  return normalizedLocale;
}

export function normalizeIntentLookup(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasProcedureSpecificSignals(text) {
  const normalized = normalizeIntentLookup(text);
  if (!normalized) {
    return false;
  }

  const genericProcedureSignals = new Set([
    "quiero iniciar un tramite",
    "quisiera iniciar un tramite",
    "me gustaria iniciar un tramite",
    "necesito hacer un tramite",
    "quisiera hacer un tramite",
    "necesito realizar una gestion",
    "quiero realizar una gestion",
    "quisiera realizar una gestion",
    "me gustaria realizar una gestion",
    "iniciar tramite",
    "iniciar un tramite",
    "hacer un tramite",
    "tramite",
    "trámite",
    "quiero gestionar un tramite",
    "quisiera gestionar un tramite",
    "quiero hacer un tramite",
    "deseo iniciar un tramite",
    "quiero iniciar tramite",
  ]);

  if (genericProcedureSignals.has(normalized)) {
    return false;
  }

  const genericProcedurePattern =
    /^(quiero|quisiera|me gustaria|deseo|necesito)\s+(iniciar|hacer|realizar|gestionar)\s+(un\s+)?(tramite|gestion)$/u;
  if (genericProcedurePattern.test(normalized)) {
    return false;
  }

  return normalized.length >= 18 || normalized.split(" ").length >= 4;
}

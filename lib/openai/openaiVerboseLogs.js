/**
 * OPENAI_VERBOSE_LOGS: si está definido como true/1 o false/0, tiene prioridad.
 * Si no está definido: verbose en development y Vercel preview; en production, desactivado salvo override true.
 */

export function isOpenAiVerboseLogsEnabled() {
  const raw = process.env.OPENAI_VERBOSE_LOGS;
  if (raw != null && String(raw).trim() !== "") {
    const v = String(raw).trim().toLowerCase();
    if (v === "true" || v === "1") {
      return true;
    }
    if (v === "false" || v === "0") {
      return false;
    }
  }
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  if (process.env.VERCEL_ENV === "preview") {
    return true;
  }
  return false;
}

/**
 * Normalización conservadora del texto proveniente de STT.
 * No inventa contenido: solo limpia espacios y saltos de línea.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTranscriptionText(raw) {
  if (typeof raw !== "string") {
    return "";
  }
  let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return s.trim();
}

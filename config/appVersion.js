/**
 * Versión mostrada en el pie del portal (PortalShell).
 *
 * Editá `CONFIGURED_APP_VERSION` cuando publiques una release.
 * Opcional: en build o en Vercel podés definir `NEXT_PUBLIC_APP_VERSION`
 * para sobrescribir sin tocar este archivo.
 */
const CONFIGURED_APP_VERSION = "0.1.0";

const MAX_LEN = 48;

export function getAppDisplayVersion() {
  const fromEnv =
    typeof process !== "undefined" &&
    typeof process.env.NEXT_PUBLIC_APP_VERSION === "string" &&
    process.env.NEXT_PUBLIC_APP_VERSION.trim()
      ? process.env.NEXT_PUBLIC_APP_VERSION.trim()
      : "";
  const raw = fromEnv || CONFIGURED_APP_VERSION;
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LEN) || CONFIGURED_APP_VERSION;
}

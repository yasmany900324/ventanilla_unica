/**
 * Debe coincidir con el tipo de Blob Store en Vercel (no se puede cambiar después de crearlo).
 *
 * - Store **público** → `public` (defecto)
 * - Store **privado** → `private` (definir `ATTACHMENT_VERCEL_BLOB_ACCESS=private`)
 *
 * @returns {"public"|"private"}
 */
export function getVercelBlobAccessMode() {
  const raw = (
    typeof process.env.ATTACHMENT_VERCEL_BLOB_ACCESS === "string"
      ? process.env.ATTACHMENT_VERCEL_BLOB_ACCESS
      : typeof process.env.VERCEL_BLOB_ACCESS === "string"
        ? process.env.VERCEL_BLOB_ACCESS
        : ""
  )
    .trim()
    .toLowerCase();
  if (raw === "private") {
    return "private";
  }
  return "public";
}

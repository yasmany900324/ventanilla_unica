/**
 * Resolves a short human-readable place label for map / GPS coordinates.
 * Uses the app's reverse-geocode API (Nominatim on the server).
 *
 * @param {{ latitude: number, longitude: number, fallbackLabel?: string, locale?: string }} params
 * @returns {Promise<string>}
 */
export async function resolveLocationReferenceLabel({
  latitude,
  longitude,
  fallbackLabel = "",
  locale = "es",
}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return typeof fallbackLabel === "string" ? fallbackLabel : "";
  }

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      locale: typeof locale === "string" && locale.trim() ? locale.trim().slice(0, 8) : "es",
    });
    const response = await fetch(`/api/geocode/reverse?${params.toString()}`);
    if (!response.ok) {
      return fallbackLabel || "";
    }
    const data = await response.json();
    const label = typeof data?.label === "string" ? data.label.trim() : "";
    return label || fallbackLabel || "";
  } catch {
    return fallbackLabel || "";
  }
}

/**
 * Builds a short, citizen-friendly place line from a Nominatim jsonv2 reverse payload.
 * Avoids raw display_name chains (e.g. many house numbers before the street name).
 */

function pickFirst(...candidates) {
  for (const value of candidates) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function isMostlyNumericCluster(segment) {
  const s = segment.trim();
  if (!s) {
    return true;
  }
  // "1993", "1993-1995", "1993, 1995, 1999"
  if (/^[\d\s,-]+$/.test(s)) {
    return true;
  }
  // "1993 Defensa" still noisy — strip leading number tokens elsewhere
  return false;
}

function localePhrases(locale) {
  const lang = typeof locale === "string" ? locale.trim().slice(0, 2).toLowerCase() : "es";
  if (lang === "en") {
    return { near: "Near", zone: "Approximate area:" };
  }
  if (lang === "pt") {
    return { near: "Perto de", zone: "Zona aproximada:" };
  }
  return { near: "Cerca de", zone: "Zona aproximada:" };
}

function simplifyDisplayName(displayName) {
  if (typeof displayName !== "string") {
    return "";
  }

  const segments = displayName
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const kept = segments.filter((segment) => !isMostlyNumericCluster(segment));
  if (kept.length === 0) {
    return "";
  }

  const joined = kept.slice(0, 4).join(", ");
  return joined.length > 110 ? `${joined.slice(0, 107).trimEnd()}…` : joined;
}

export function buildCitizenGeocodeLabel(payload, locale = "es") {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const { near, zone } = localePhrases(locale);

  const addr = payload.address && typeof payload.address === "object" ? payload.address : null;
  if (!addr) {
    return simplifyDisplayName(payload.display_name);
  }

  const road = pickFirst(addr.road, addr.pedestrian, addr.path, addr.footway, addr.residential, addr.cycleway);

  const area = pickFirst(
    addr.neighbourhood,
    addr.suburb,
    addr.quarter,
    addr.city_district,
    addr.district,
    addr.hamlet
  );

  const city = pickFirst(addr.city, addr.town, addr.village, addr.municipality, addr.county);
  const state = pickFirst(addr.state);
  const country = pickFirst(addr.country);

  const stateSuffix =
    state && city && state.toLowerCase() !== city.toLowerCase() ? `, ${state}` : "";
  const countrySuffix =
    country && city && country.toLowerCase() !== city.toLowerCase() && country.length < 22
      ? `, ${country}`
      : "";

  if (road && area && city && road !== area) {
    return `${near} ${road}, ${area}, ${city}${stateSuffix}`.replace(/,,+/g, ",").replace(/\s+/g, " ").trim();
  }

  if (road && city) {
    return `${near} ${road}, ${city}${stateSuffix}${countrySuffix}`.replace(/,,+/g, ",").replace(/\s+/g, " ").trim();
  }

  if (area && city) {
    return `${zone} ${area}, ${city}${stateSuffix}`.replace(/,,+/g, ",").replace(/\s+/g, " ").trim();
  }

  if (city) {
    const tail = `${stateSuffix}${countrySuffix}`.replace(/^,/, "");
    return `${city}${tail}`.trim();
  }

  return simplifyDisplayName(payload.display_name);
}

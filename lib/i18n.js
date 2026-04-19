export const SUPPORTED_LOCALES = ["es", "pt", "en"];
export const DEFAULT_LOCALE = "es";

const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);

function normalizeLocaleToken(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase().replace(/_/g, "-");
}

export function normalizeLocale(value) {
  const normalizedValue = normalizeLocaleToken(value);
  if (!normalizedValue) {
    return null;
  }

  const baseLocale = normalizedValue.split("-")[0];
  if (SUPPORTED_LOCALE_SET.has(baseLocale)) {
    return baseLocale;
  }

  return null;
}

export function getDefaultLocale() {
  return normalizeLocale(process.env.APP_DEFAULT_LOCALE) || DEFAULT_LOCALE;
}

export function resolveLocaleFromAcceptLanguage(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return null;
  }

  const localeCandidates = headerValue.split(",").map((segment) => {
    const [localePart, qualityPart] = segment.trim().split(";q=");
    const locale = normalizeLocale(localePart);
    const quality = Number.parseFloat(qualityPart);
    return {
      locale,
      quality: Number.isFinite(quality) ? quality : 1,
    };
  });

  localeCandidates.sort((a, b) => b.quality - a.quality);
  const firstSupportedLocale = localeCandidates.find((item) => Boolean(item.locale));
  return firstSupportedLocale?.locale || null;
}

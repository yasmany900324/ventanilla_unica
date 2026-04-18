import { normalizeLocale } from "./i18n";

const ENGLISH_MARKERS = [
  "hello",
  "hi",
  "good morning",
  "good afternoon",
  "good evening",
  "report",
  "issue",
  "status",
  "request",
  "help",
  "please",
];

const PORTUGUESE_MARKERS = [
  "ola",
  "olá",
  "bom dia",
  "boa tarde",
  "boa noite",
  "preciso",
  "tramite",
  "trâmite",
  "solicitacao",
  "solicitação",
  "problema",
  "obrigado",
  "ajuda",
];

const SPANISH_MARKERS = [
  "hola",
  "buen dia",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "necesito",
  "tramite",
  "trámite",
  "solicitud",
  "problema",
  "gracias",
  "ayuda",
  "quiero",
];

function normalizeForDetection(value) {
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

function scoreMarkers(text, markers) {
  if (!text) {
    return 0;
  }

  return markers.reduce((score, marker) => {
    if (!marker) {
      return score;
    }
    return text.includes(marker) ? score + 1 : score;
  }, 0);
}

export function detectLocaleFromText(text) {
  const normalizedText = normalizeForDetection(text);
  if (!normalizedText) {
    return null;
  }

  const scoreByLocale = {
    es: scoreMarkers(normalizedText, SPANISH_MARKERS),
    pt: scoreMarkers(normalizedText, PORTUGUESE_MARKERS),
    en: scoreMarkers(normalizedText, ENGLISH_MARKERS),
  };

  const rankedLocales = Object.entries(scoreByLocale).sort((a, b) => b[1] - a[1]);
  if (!rankedLocales.length || rankedLocales[0][1] === 0) {
    return null;
  }

  const [topLocale, topScore] = rankedLocales[0];
  const secondScore = rankedLocales[1]?.[1] || 0;
  const ambiguous = topScore - secondScore <= 0;
  if (ambiguous) {
    return null;
  }

  return normalizeLocale(topLocale);
}

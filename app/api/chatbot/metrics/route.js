import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../lib/auth";
import { getChatbotFunnelMetrics } from "../../../../lib/chatbotTelemetry";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../../../../lib/i18n";

const METRICS_MESSAGES = {
  es: {
    forbidden: "No autorizado.",
    loadError: "No se pudieron obtener métricas del chatbot.",
  },
  en: {
    forbidden: "Unauthorized.",
    loadError: "Could not load chatbot metrics.",
  },
  pt: {
    forbidden: "Não autorizado.",
    loadError: "Não foi possível obter métricas do chatbot.",
  },
};

function resolveRequestLocale(request, searchParams) {
  return (
    normalizeLocale(searchParams.get("locale")) ||
    resolveLocaleFromAcceptLanguage(request.headers.get("accept-language")) ||
    getDefaultLocale()
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = METRICS_MESSAGES[locale] || METRICS_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }

    const windowDays = Number.parseInt(searchParams.get("windowDays"), 10);
    const metrics = await getChatbotFunnelMetrics({
      windowDays,
    });

    return NextResponse.json({
      windowDays:
        Number.isInteger(windowDays) && windowDays > 0 ? Math.min(windowDays, 90) : 7,
      ...metrics,
    });
  } catch (error) {
    return NextResponse.json(
      { error: messages.loadError },
      { status: 500 }
    );
  }
}

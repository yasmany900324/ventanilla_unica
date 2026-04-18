import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../lib/auth";
import { getChatbotFunnelMetrics } from "../../../../../lib/chatbotTelemetry";

export async function GET(request) {
  try {
    const authenticatedUser = await requireAuthenticatedUser(request);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "Sesion no valida." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
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
      { error: "No se pudieron obtener metricas del chatbot." },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import {
  detectDialogflowIntent,
  isDialogflowConfigured,
  validateDialogflowMessagePayload,
} from "../../../../lib/dialogflowService";
import {
  getChatbotRouteMetadata,
  resolveChatbotRedirect,
} from "../../../../lib/chatbotIntentRoutes";

const FALLBACK_REPLY =
  "No logre identificar con claridad tu solicitud. Contame si quieres reportar un problema, iniciar un tramite o consultar el estado de una gestion.";
const MIN_CONFIDENCE_TO_REDIRECT = 0.45;

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "Metodo no permitido. Usa POST para enviar mensajes al chatbot." },
    { status: 405 }
  );
}

export async function POST(request) {
  let body = null;

  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      { error: "La solicitud no tiene un formato JSON valido." },
      { status: 400 }
    );
  }

  const validationResult = validateDialogflowMessagePayload(body);
  if (!validationResult.ok) {
    return NextResponse.json({ error: validationResult.error }, { status: 400 });
  }

  const { text, sessionId } = validationResult.value;

  if (!isDialogflowConfigured()) {
    console.error("[chatbot] Dialogflow no configurado en entorno servidor.");
    return NextResponse.json(
      {
        error: "El asistente no esta disponible temporalmente.",
      },
      { status: 503 }
    );
  }

  try {
    const dialogflowResponse = await detectDialogflowIntent({ text, sessionId });
    const hasLowConfidence =
      typeof dialogflowResponse.confidence === "number" &&
      dialogflowResponse.confidence < MIN_CONFIDENCE_TO_REDIRECT;
    const isFallbackIntent = dialogflowResponse.intent === "Default Fallback Intent";
    const shouldAskClarification =
      !dialogflowResponse.intent || hasLowConfidence || isFallbackIntent;
    const resolvedRedirect = shouldAskClarification
      ? null
      : resolveChatbotRedirect({
          action: dialogflowResponse.action,
          intentDisplayName: dialogflowResponse.intent,
        });
    const routeMetadata = getChatbotRouteMetadata(resolvedRedirect);
    const replyText = shouldAskClarification
      ? FALLBACK_REPLY
      : dialogflowResponse.replyText || FALLBACK_REPLY;

    return NextResponse.json({
      sessionId: dialogflowResponse.sessionId,
      replyText,
      intent: dialogflowResponse.intent,
      confidence: dialogflowResponse.confidence,
      fulfillmentMessages: dialogflowResponse.fulfillmentMessages,
      action: dialogflowResponse.action,
      parameters: dialogflowResponse.parameters,
      redirectTo: resolvedRedirect || null,
      redirectLabel: routeMetadata?.label || null,
      needsClarification: shouldAskClarification,
    });
  } catch (error) {
    console.error("[chatbot] Error detectando intencion.", {
      sessionId,
      textLength: text.length,
      message: error?.message,
    });

    return NextResponse.json(
      {
        error: "Ocurrio un error al procesar tu mensaje. Intenta nuevamente en unos segundos.",
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuthenticatedUser } from "../../../../lib/auth";
import { validateChatMessagePayload } from "../../../../lib/chatbotPayloadValidation";
import {
  processAssistantTurn,
  buildChatDebugHeaders,
} from "../../../../lib/assistant";
import { runWithOpenAiCorrelationId } from "../../../../lib/openai/correlationContext";

export const runtime = "nodejs";

function isChatDebugRequested(request) {
  const raw = request.headers.get("x-chatbot-debug");
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "1" || v === "true") {
      return true;
    }
  }
  return process.env.CHATBOT_DEBUG === "1";
}

function applyChatDebugHeaders(response, snapshot) {
  const headers = buildChatDebugHeaders(snapshot);
  if (!headers || !response?.headers) {
    return response;
  }
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export async function GET() {
  return NextResponse.json(
    { error: "Método no permitido. Usa POST para enviar mensajes al chatbot." },
    { status: 405 }
  );
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch (_error) {
    return NextResponse.json(
      { error: "La solicitud no tiene un formato JSON válido." },
      { status: 400 }
    );
  }

  const validationResult = validateChatMessagePayload(body);
  if (!validationResult.ok) {
    return NextResponse.json({ error: validationResult.error }, { status: 400 });
  }

  const authenticatedUser = await requireAuthenticatedUser(request);
  const {
    text,
    sessionId,
    preferredLocale,
    command,
    commandField,
    contextEntry,
  } = validationResult.value;

  const correlationId =
    request.headers.get("x-correlation-id")?.trim() ||
    request.headers.get("x-request-id")?.trim() ||
    randomUUID();

  try {
    const result = await runWithOpenAiCorrelationId(correlationId, () =>
      processAssistantTurn({
        channel: "web",
        sessionId,
        text,
        preferredLocale,
        command,
        commandField,
        contextEntry,
        authenticatedUser,
        acceptLanguage: request.headers.get("accept-language"),
        chatDebugEnabled: isChatDebugRequested(request),
      })
    );

    if (result.status >= 400) {
      return NextResponse.json(result.body, { status: result.status });
    }

    const response = NextResponse.json(result.body);
    response.headers.set("x-correlation-id", correlationId);
    applyChatDebugHeaders(response, result.snapshot);
    return response;
  } catch (error) {
    console.error("[chatbot/message] processAssistantTurn failed", error);
    return NextResponse.json(
      { error: "Error interno del asistente. Intenta nuevamente en unos segundos." },
      { status: 500 }
    );
  }
}

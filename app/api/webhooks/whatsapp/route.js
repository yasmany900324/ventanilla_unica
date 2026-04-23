import { NextResponse } from "next/server";
import { processAssistantTurn } from "../../../../lib/assistant";
import { verifyMetaAppSecretSignature } from "../../../../lib/whatsapp/metaSignature";
import {
  extractInboundNormalizedMessages,
  interactiveMessageToCommandText,
} from "../../../../lib/whatsapp/whatsappInboundAdapter";
import { sendWhatsAppTextMessage } from "../../../../lib/whatsapp/whatsappOutboundClient";
import { processWhatsAppInboundAudioToText } from "../../../../lib/whatsapp/whatsappAudioInbound";
import { buildWhatsAppAssistantSessionId } from "../../../../lib/whatsapp/whatsappSessionId";

export const runtime = "nodejs";

function maskWaId(waId) {
  if (typeof waId !== "string" || waId.length < 5) {
    return "***";
  }
  return `…${waId.slice(-4)}`;
}

/**
 * Meta webhook verification (WhatsApp Cloud API).
 */
export async function GET(request) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!verifyToken) {
    console.error("[whatsapp] GET webhook: WHATSAPP_VERIFY_TOKEN is not set");
    return NextResponse.json({ error: "WhatsApp webhook not configured" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * Receives WhatsApp Cloud API events; normalizes tipos de mensaje y responde vía Graph API.
 */
export async function POST(request) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) {
    console.error("[whatsapp] POST: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return NextResponse.json({ error: "WhatsApp not configured" }, { status: 503 });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (error) {
    console.error("[whatsapp] POST: failed to read body", error);
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyMetaAppSecretSignature(rawBody, signature, appSecret)) {
      console.warn("[whatsapp] POST: invalid X-Hub-Signature-256");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error(
      "[whatsapp] POST: WHATSAPP_APP_SECRET is not set — refusing unsigned webhooks in production"
    );
    return NextResponse.json({ error: "Signature verification required" }, { status: 503 });
  } else {
    console.warn(
      "[whatsapp] POST: WHATSAPP_APP_SECRET not set; accepting unsigned webhook (dev only)"
    );
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload?.object && payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const inbound = extractInboundNormalizedMessages(payload);
  if (inbound.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  for (const item of inbound) {
    const sessionId = buildWhatsAppAssistantSessionId(item.waId);

    const { normalized } = item;
    let text = "";
    let channelInbound = null;
    let inboundUserTextSource = null;
    let inboundOriginalChannelMeta = null;

    if (normalized.type === "text") {
      text = normalized.text;
    } else if (normalized.type === "interactive") {
      text = interactiveMessageToCommandText(normalized);
    } else if (normalized.type === "audio") {
      console.info("[whatsapp] webhook inbound audio", {
        waId: maskWaId(item.waId),
        messageId: item.messageId,
        timestamp: item.timestamp,
      });

      try {
        const ack = await sendWhatsAppTextMessage({
          to: item.waId,
          text: "Recibí tu audio, lo estoy procesando...",
        });
        if (!ack.ok) {
          console.warn("[whatsapp] processing ack message failed (continuing)", {
            waId: maskWaId(item.waId),
            httpStatus: ack.status,
          });
        }
      } catch (error) {
        console.warn("[whatsapp] processing ack message threw (continuing)", {
          waId: maskWaId(item.waId),
          message: error?.message,
        });
      }

      let audioOutcome;
      try {
        audioOutcome = await processWhatsAppInboundAudioToText({
          sessionId,
          waId: item.waId,
          messageId: item.messageId,
          mediaId: normalized.mediaId,
          mimeTypeHint: normalized.mimeType,
          timestamp: item.timestamp,
        });
      } catch (error) {
        console.error("[whatsapp] audio pipeline unexpected error", {
          waId: maskWaId(item.waId),
          message: error?.message,
          stack: typeof error?.stack === "string" ? error.stack.slice(0, 500) : undefined,
          discardReason: "unhandled_exception",
        });
        await sendWhatsAppTextMessage({
          to: item.waId,
          text:
            "Tuve un problema técnico al procesar el audio. ¿Podrías intentar de nuevo o escribir tu mensaje?",
        });
        continue;
      }

      if (!audioOutcome.ok) {
        console.warn("[whatsapp] audio pipeline outcome not ok", {
          waId: maskWaId(item.waId),
          reason: audioOutcome.reason,
          error: audioOutcome.error,
          discardReason: `pipeline_${audioOutcome.reason}`,
        });
        const replyText =
          audioOutcome.reason === "stt_disabled"
            ? "En este momento no puedo procesar audios. Por favor, escribí tu mensaje en texto."
            : audioOutcome.reason === "download" || audioOutcome.reason === "mime_rejected"
              ? "No pude acceder al audio que enviaste. Por favor, intenta enviarlo nuevamente."
              : audioOutcome.reason === "transcription_api_limit"
                ? "Ahora no puedo transcribir el audio por un límite del servicio de voz (cuota o uso). Escribí tu mensaje en texto o probá más tarde."
                : "No pude entender bien tu audio. ¿Podrías enviarlo otra vez o escribir tu mensaje?";
        const sendAudioErr = await sendWhatsAppTextMessage({ to: item.waId, text: replyText });
        if (!sendAudioErr.ok) {
          console.error("[whatsapp] failed to send audio error reply", {
            waId: maskWaId(item.waId),
            httpStatus: sendAudioErr.status,
          });
        }
        continue;
      }

      text = audioOutcome.normalizedText.slice(0, 4000);
      inboundUserTextSource = "speech_to_text";
      inboundOriginalChannelMeta = {
        originalMessageType: "audio",
        whatsappMessageId: item.messageId,
        mediaId: normalized.mediaId,
      };
    } else if (
      normalized.type === "location" ||
      normalized.type === "image" ||
      normalized.type === "unknown"
    ) {
      channelInbound = normalized;
    }

    console.info("[whatsapp] webhook inbound", {
      waId: maskWaId(item.waId),
      messageId: item.messageId,
      inboundType: normalized.type,
      fromSpeechToText: inboundUserTextSource === "speech_to_text",
    });

    try {
      const result = await processAssistantTurn({
        channel: "whatsapp",
        sessionId,
        text,
        preferredLocale: null,
        command: "none",
        commandField: null,
        contextEntry: null,
        authenticatedUser: null,
        whatsappWaId: item.waId,
        acceptLanguage: null,
        chatDebugEnabled: false,
        channelInbound,
        inboundUserTextSource,
        inboundOriginalChannelMeta,
      });

      if (result.status >= 400) {
        console.error("[whatsapp] assistant error", {
          waId: maskWaId(item.waId),
          status: result.status,
        });
        await sendWhatsAppTextMessage({
          to: item.waId,
          text:
            "No pudimos procesar tu mensaje en este momento. Intenta de nuevo en unos minutos.",
        });
        continue;
      }

      const reply =
        typeof result.body?.replyText === "string" && result.body.replyText.trim()
          ? result.body.replyText
          : "Listo.";

      const sendResult = await sendWhatsAppTextMessage({ to: item.waId, text: reply });
      if (!sendResult.ok) {
        console.error("[whatsapp] failed to send reply", {
          waId: maskWaId(item.waId),
          httpStatus: sendResult.status,
        });
      }
    } catch (error) {
      console.error("[whatsapp] turn failed", { waId: maskWaId(item.waId), error });
      await sendWhatsAppTextMessage({
        to: item.waId,
        text: "Ocurrió un error interno. Intenta más tarde.",
      });
    }
  }

  return NextResponse.json({ ok: true, processed: inbound.length });
}

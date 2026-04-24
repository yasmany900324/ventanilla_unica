const GRAPH_VERSION = "v21.0";
const MAX_TEXT_LENGTH = 4096;

function truncateForWhatsApp(text) {
  if (typeof text !== "string") {
    return "";
  }
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_TEXT_LENGTH - 20)}\n…(recortado)`;
}

/**
 * Sends a plain text message via WhatsApp Cloud API.
 * @param {object} params
 * @param {string} params.to — recipient wa_id (digits, no +)
 * @param {string} params.text
 * @returns {Promise<{ ok: boolean, status: number, json: unknown }>}
 */
export async function sendWhatsAppTextMessage({ to, text }) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) {
    console.error("[whatsapp] outbound: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return { ok: false, status: 0, json: { error: "not_configured" } };
  }
  if (!to || !text) {
    return { ok: false, status: 400, json: { error: "missing_to_or_text" } };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(to).replace(/\D/g, "") || to,
    type: "text",
    text: {
      preview_url: false,
      body: truncateForWhatsApp(text),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const graphError = json && typeof json === "object" && json.error ? json.error : null;
    console.error("[whatsapp] outbound API error", {
      status: response.status,
      messageId: json?.messages?.[0]?.id,
      graphMessage: typeof graphError?.message === "string" ? graphError.message : undefined,
      graphCode: graphError?.code,
      graphSubcode: graphError?.error_subcode,
      graphType: graphError?.type,
    });
  }

  return { ok: response.ok, status: response.status, json };
}

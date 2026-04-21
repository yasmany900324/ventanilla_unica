/**
 * Parses WhatsApp Cloud API webhook JSON and yields actionable inbound text messages.
 * Ignores statuses, reactions, unsupported types, and empty bodies.
 *
 * @returns {Array<{ waId: string, messageId: string, text: string, phoneNumberId: string | null }>}
 */
export function extractInboundTextMessages(payload) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const out = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  entries.forEach((entry) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    changes.forEach((change) => {
      const value = change?.value;
      if (!value || typeof value !== "object") {
        return;
      }
      const phoneNumberId =
        typeof value.metadata?.phone_number_id === "string"
          ? value.metadata.phone_number_id
          : null;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      messages.forEach((msg) => {
        if (!msg || typeof msg !== "object") {
          return;
        }
        if (msg.type !== "text") {
          return;
        }
        const waId = typeof msg.from === "string" ? msg.from.trim() : "";
        const messageId = typeof msg.id === "string" ? msg.id.trim() : "";
        const body =
          msg.text && typeof msg.text.body === "string" ? msg.text.body.trim() : "";
        if (!waId || !messageId || !body) {
          return;
        }
        out.push({
          waId,
          messageId,
          text: body.slice(0, 500),
          phoneNumberId,
        });
      });
    });
  });

  return out;
}

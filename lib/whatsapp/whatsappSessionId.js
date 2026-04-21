/**
 * Builds a chat session id compatible with `chatbotPayloadValidation` (alphanumeric, _, -, length 6–80).
 * One stable id per WhatsApp contact (`wa_id` from Meta).
 */
export function buildWhatsAppAssistantSessionId(waId) {
  if (typeof waId !== "string" || !waId.trim()) {
    return "wa_unknown";
  }
  const digits = waId.replace(/\D/g, "");
  const core = (digits || waId.replace(/[^a-zA-Z0-9_-]/g, "")).slice(0, 72);
  let id = `wa_${core || "unknown"}`;
  if (id.length < 6) {
    id = `wa_pad_${id}`;
  }
  return id.slice(0, 80);
}

/**
 * Maps a WhatsApp contact id (`wa_id` from Meta) to a portal citizen user for the assistant.
 *
 * **Current behavior (MVP):** always returns `null`. Conversation still works: the assistant uses
 * the same session store keyed by {@link ../whatsapp/whatsappSessionId.buildWhatsAppAssistantSessionId};
 * flows that require a logged-in portal user (e.g. persisting an incidencia) will receive the
 * existing `auth_required` style replies — same as an anonymous web user.
 *
 * **Future:** add a table such as `citizen_whatsapp_links (citizen_id, wa_id, verified_at)` and
 * resolve `citizen_id` here, then return `{ id, fullName, email, cedula, role, ... }` compatible
 * with `processAssistantTurn`'s `authenticatedUser`.
 *
 * @param {string} waId
 * @returns {Promise<object|null>}
 */
export async function resolvePortalUserFromWhatsAppWaId(_waId) {
  return null;
}

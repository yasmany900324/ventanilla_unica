/**
 * Reservado para futuras integraciones (p. ej. vincular `wa_id` con un ciudadano del portal).
 * El canal WhatsApp **no** usa usuario autenticado del portal: la identidad del solicitante es
 * siempre el `wa_id` / número, persistido en sesión y en tablas de incidencias y trámites
 * (`whatsapp_wa_id`). El webhook no debe pasar `authenticatedUser` a `processAssistantTurn`.
 *
 * @param {string} _waId
 * @returns {Promise<object|null>}
 */
export async function resolvePortalUserFromWhatsAppWaId(_waId) {
  return null;
}

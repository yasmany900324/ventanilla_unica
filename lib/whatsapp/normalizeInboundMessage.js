/**
 * @typedef {(
 *   | { type: 'text'; text: string }
 *   | { type: 'location'; latitude: number; longitude: number; addressText?: string; name?: string }
 *   | { type: 'image'; mediaId: string; mimeType?: string; caption?: string }
 *   | { type: 'audio'; mediaId: string; mimeType?: string }
 *   | { type: 'interactive'; id?: string; title?: string }
 *   | { type: 'unknown'; rawType?: string }
 * )} NormalizedIncomingMessage
 */

/**
 * @param {unknown} msg
 * @returns {NormalizedIncomingMessage | null}
 */
export function normalizeCloudApiInboundMessage(msg) {
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const type = typeof msg.type === "string" ? msg.type.trim().toLowerCase() : "";

  if (type === "text") {
    const body =
      msg.text && typeof msg.text.body === "string" ? msg.text.body.trim() : "";
    if (!body) {
      return null;
    }
    return { type: "text", text: body.slice(0, 500) };
  }

  if (type === "location") {
    const loc = msg.location && typeof msg.location === "object" ? msg.location : {};
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { type: "unknown", rawType: "location_invalid" };
    }
    const name = typeof loc.name === "string" ? loc.name.trim() : "";
    const address = typeof loc.address === "string" ? loc.address.trim() : "";
    const addressText = [name, address].filter(Boolean).join(" — ").slice(0, 400) || undefined;
    return {
      type: "location",
      latitude: lat,
      longitude: lng,
      addressText,
      name: name || undefined,
    };
  }

  if (type === "image") {
    const image = msg.image && typeof msg.image === "object" ? msg.image : {};
    const mediaId = typeof image.id === "string" ? image.id.trim() : "";
    if (!mediaId) {
      return { type: "unknown", rawType: "image_missing_id" };
    }
    const mimeType =
      typeof image.mime_type === "string" ? image.mime_type.trim().toLowerCase() : undefined;
    const caption =
      typeof image.caption === "string" ? image.caption.trim().slice(0, 500) : undefined;
    return { type: "image", mediaId, mimeType, caption };
  }

  if (type === "audio") {
    const audio = msg.audio && typeof msg.audio === "object" ? msg.audio : {};
    const mediaId = typeof audio.id === "string" ? audio.id.trim() : "";
    if (!mediaId) {
      return { type: "unknown", rawType: "audio_missing_id" };
    }
    const mimeType =
      typeof audio.mime_type === "string" ? audio.mime_type.trim().toLowerCase() : undefined;
    return { type: "audio", mediaId, mimeType };
  }

  if (type === "interactive") {
    const interactive =
      msg.interactive && typeof msg.interactive === "object" ? msg.interactive : {};
    const interactiveType =
      typeof interactive.type === "string" ? interactive.type.trim().toLowerCase() : "";

    if (interactiveType === "button_reply") {
      const br =
        interactive.button_reply && typeof interactive.button_reply === "object"
          ? interactive.button_reply
          : {};
      const id = typeof br.id === "string" ? br.id.trim() : undefined;
      const title = typeof br.title === "string" ? br.title.trim() : undefined;
      return { type: "interactive", id, title };
    }

    if (interactiveType === "list_reply") {
      const lr =
        interactive.list_reply && typeof interactive.list_reply === "object"
          ? interactive.list_reply
          : {};
      const id = typeof lr.id === "string" ? lr.id.trim() : undefined;
      const title = typeof lr.title === "string" ? lr.title.trim() : undefined;
      return { type: "interactive", id, title };
    }

    return { type: "interactive" };
  }

  if (type) {
    return { type: "unknown", rawType: type };
  }

  return { type: "unknown" };
}

/**
 * Maps an interactive payload to plain text so existing command parsing can run.
 * @param {Extract<NormalizedIncomingMessage, { type: 'interactive' }>} interactive
 * @returns {string}
 */
export function interactiveMessageToCommandText(interactive) {
  const id = interactive.id ? interactive.id.toLowerCase() : "";
  const title = interactive.title ? interactive.title.toLowerCase() : "";

  if (id === "skip_photo" || id === "omitir_foto") {
    return "omitir foto";
  }
  if (id === "set_photo_pending" || id === "adjuntar_foto") {
    return "adjuntar foto";
  }
  if (title.includes("omitir") && title.includes("foto")) {
    return "omitir foto";
  }
  if (title.includes("adjuntar") && title.includes("foto")) {
    return "adjuntar foto";
  }

  return interactive.title || interactive.id || "";
}

/**
 * @param {unknown} payload
 * @returns {Array<{
 *   waId: string,
 *   messageId: string,
 *   phoneNumberId: string | null,
 *   normalized: NormalizedIncomingMessage
 * }>}
 */
export function extractInboundNormalizedMessages(payload) {
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
        const waId = typeof msg.from === "string" ? msg.from.trim() : "";
        const messageId = typeof msg.id === "string" ? msg.id.trim() : "";
        if (!waId || !messageId) {
          return;
        }
        const normalized = normalizeCloudApiInboundMessage(msg);
        if (!normalized) {
          return;
        }
        out.push({
          waId,
          messageId,
          phoneNumberId,
          normalized,
        });
      });
    });
  });

  return out;
}

/**
 * @deprecated Prefer {@link extractInboundNormalizedMessages}. Kept for compatibility.
 * @returns {Array<{ waId: string, messageId: string, text: string, phoneNumberId: string | null }>}
 */
export function extractInboundTextMessages(payload) {
  return extractInboundNormalizedMessages(payload)
    .filter((row) => row.normalized.type === "text")
    .map((row) => ({
      waId: row.waId,
      messageId: row.messageId,
      phoneNumberId: row.phoneNumberId,
      text: row.normalized.text,
    }));
}

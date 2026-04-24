import { describe, expect, it } from "vitest";
import {
  extractInboundNormalizedMessages,
  extractInboundTextMessages,
  interactiveMessageToCommandText,
  normalizeCloudApiInboundMessage,
} from "./normalizeInboundMessage";

describe("normalizeCloudApiInboundMessage", () => {
  it("parses location messages", () => {
    const msg = {
      from: "59170000000",
      id: "wamid.loc",
      type: "location",
      location: {
        latitude: -34.9011,
        longitude: -56.1645,
        name: "Parque Rodó",
        address: "Montevideo",
      },
    };
    const n = normalizeCloudApiInboundMessage(msg);
    expect(n).toEqual({
      type: "location",
      latitude: -34.9011,
      longitude: -56.1645,
      addressText: "Parque Rodó — Montevideo",
      name: "Parque Rodó",
    });
  });

  it("parses voice messages as audio for STT pipeline", () => {
    const msg = {
      from: "59170000000",
      id: "wamid.voice",
      type: "voice",
      voice: {
        id: "MEDIA_VOICE",
        mime_type: "audio/ogg; codecs=opus",
      },
    };
    const n = normalizeCloudApiInboundMessage(msg);
    expect(n).toEqual({
      type: "audio",
      mediaId: "MEDIA_VOICE",
      mimeType: "audio/ogg; codecs=opus",
      voiceNote: true,
    });
  });

  it("parses image messages", () => {
    const msg = {
      from: "59170000000",
      id: "wamid.img",
      type: "image",
      image: {
        id: "MEDIA123",
        mime_type: "image/jpeg",
        caption: "bache",
      },
    };
    const n = normalizeCloudApiInboundMessage(msg);
    expect(n).toEqual({
      type: "image",
      mediaId: "MEDIA123",
      mimeType: "image/jpeg",
      caption: "bache",
    });
  });

  it("parses image documents as image messages", () => {
    const msg = {
      from: "59170000000",
      id: "wamid.docimg",
      type: "document",
      document: {
        id: "MEDIA_DOC_IMG",
        mime_type: "image/png",
        caption: "evidencia en documento",
        filename: "evidencia.png",
      },
    };
    const n = normalizeCloudApiInboundMessage(msg);
    expect(n).toEqual({
      type: "image",
      mediaId: "MEDIA_DOC_IMG",
      mimeType: "image/png",
      caption: "evidencia en documento",
      sourceType: "document",
    });
  });

  it("keeps non-image documents as unknown", () => {
    const msg = {
      from: "59170000000",
      id: "wamid.docpdf",
      type: "document",
      document: {
        id: "MEDIA_DOC_PDF",
        mime_type: "application/pdf",
        filename: "archivo.pdf",
      },
    };
    const n = normalizeCloudApiInboundMessage(msg);
    expect(n).toEqual({
      type: "unknown",
      rawType: "document_non_image",
    });
  });
});

describe("extractInboundNormalizedMessages", () => {
  it("returns rows for non-text types", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "987" },
                messages: [
                  {
                    from: "59170000000",
                    id: "wamid.1",
                    type: "location",
                    location: { latitude: -1, longitude: -2 },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const rows = extractInboundNormalizedMessages(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].normalized.type).toBe("location");
    expect(rows[0].timestamp).toBeNull();
  });

  it("includes message timestamp when present", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "987" },
                messages: [
                  {
                    from: "59170000000",
                    id: "wamid.ts",
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const rows = extractInboundNormalizedMessages(payload);
    expect(rows[0].timestamp).toBe("1710000000");
  });
});

describe("interactiveMessageToCommandText", () => {
  it("mapea id skip_photo a texto de comando", () => {
    expect(
      interactiveMessageToCommandText({ type: "interactive", id: "skip_photo", title: "Omitir" })
    ).toBe("omitir foto");
  });

  it("mapea título de botón a omitir", () => {
    expect(
      interactiveMessageToCommandText({
        type: "interactive",
        id: "x",
        title: "Omitir foto",
      })
    ).toBe("omitir foto");
  });
});

describe("extractInboundTextMessages (compat)", () => {
  it("still filters to text only", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "987" },
                messages: [
                  {
                    from: "59170000000",
                    id: "wamid.t",
                    type: "text",
                    text: { body: "Hola" },
                  },
                  {
                    from: "59170000000",
                    id: "wamid.l",
                    type: "location",
                    location: { latitude: 1, longitude: 2 },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const rows = extractInboundTextMessages(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Hola");
  });
});

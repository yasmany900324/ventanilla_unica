import { describe, expect, it } from "vitest";
import { extractInboundTextMessages } from "./whatsappInboundAdapter";

describe("extractInboundTextMessages", () => {
  it("extracts text messages from a typical Cloud API payload", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "123",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550000000",
                  phone_number_id: "987654321",
                },
                contacts: [{ profile: { name: "Test" }, wa_id: "59170000000" }],
                messages: [
                  {
                    from: "59170000000",
                    id: "wamid.1",
                    timestamp: "1234567890",
                    type: "text",
                    text: { body: "Hola" },
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
    expect(rows[0]).toMatchObject({
      waId: "59170000000",
      messageId: "wamid.1",
      text: "Hola",
      phoneNumberId: "987654321",
    });
  });

  it("returns empty array for status-only payloads", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.1", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(extractInboundTextMessages(payload)).toEqual([]);
  });
});

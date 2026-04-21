import { describe, expect, it } from "vitest";
import { buildWhatsAppAssistantSessionId } from "./whatsappSessionId";

describe("buildWhatsAppAssistantSessionId", () => {
  it("produces ids that match session id rules (length and charset)", () => {
    const id = buildWhatsAppAssistantSessionId("5917123456789");
    expect(id).toMatch(/^[a-zA-Z0-9_-]{6,80}$/);
    expect(id.startsWith("wa_")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildWhatsAppAssistantSessionId,
  inferWhatsAppWaIdFromAssistantSessionId,
} from "./whatsappSessionId";

describe("buildWhatsAppAssistantSessionId", () => {
  it("produces ids that match session id rules (length and charset)", () => {
    const id = buildWhatsAppAssistantSessionId("5917123456789");
    expect(id).toMatch(/^[a-zA-Z0-9_-]{6,80}$/);
    expect(id.startsWith("wa_")).toBe(true);
  });
});

describe("inferWhatsAppWaIdFromAssistantSessionId", () => {
  it("recupera dígitos desde un session id generado por buildWhatsAppAssistantSessionId", () => {
    const wa = "59891234567";
    const sessionId = buildWhatsAppAssistantSessionId(wa);
    expect(inferWhatsAppWaIdFromAssistantSessionId(sessionId)).toBe(wa.replace(/\D/g, ""));
  });

  it("devuelve null si no hay patrón claro", () => {
    expect(inferWhatsAppWaIdFromAssistantSessionId("wa_xyz")).toBe(null);
    expect(inferWhatsAppWaIdFromAssistantSessionId("cliente-web-1")).toBe(null);
  });
});

import { describe, expect, it } from "vitest";
import { sanitizeForLogs } from "../logging/sanitizeForLogs";

describe("sanitizeForLogs", () => {
  it("redacta claves sensibles", () => {
    const out = sanitizeForLogs({
      apiKey: "sk-secret",
      nested: { Authorization: "Bearer x" },
      safe: "ok",
    });
    expect(out.apiKey).toBe("[redacted]");
    expect(out.nested.Authorization).toBe("[redacted]");
    expect(out.safe).toBe("ok");
  });

  it("trunca strings largos", () => {
    const s = "nope,".repeat(400);
    const out = sanitizeForLogs(s, { maxStringLength: 50 });
    expect(String(out).includes(`[truncated_${s.length}_chars]`)).toBe(true);
    expect(String(out).length).toBeLessThan(s.length);
  });

  it("detecta referencias circulares", () => {
    const a = { x: 1 };
    a.self = a;
    const out = sanitizeForLogs(a);
    expect(out.self).toBe("[circular]");
  });

  it("omite buffers y base64 largo", () => {
    const buf = Buffer.from("hello");
    const b64 = `${"A".repeat(120)}${"B".repeat(120)}`;
    const out = sanitizeForLogs({ buf, b64 });
    expect(out.buf._type).toBe("Buffer");
    expect(out.b64).toBe("[omitted_large_content]");
  });

  it("limita items de array", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = sanitizeForLogs(arr, { maxArrayItems: 5 });
    expect(out.length).toBe(6);
    expect(out[5]).toContain("truncated_array");
  });
});

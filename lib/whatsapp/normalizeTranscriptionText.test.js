import { describe, expect, it } from "vitest";
import { normalizeTranscriptionText } from "./normalizeTranscriptionText";

describe("normalizeTranscriptionText", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeTranscriptionText("  hola   mundo  ")).toBe("hola mundo");
  });

  it("normalizes newlines conservatively", () => {
    expect(normalizeTranscriptionText("a\n\n\nb")).toBe("a\n\nb");
  });

  it("returns empty for non-string", () => {
    expect(normalizeTranscriptionText(null)).toBe("");
  });
});

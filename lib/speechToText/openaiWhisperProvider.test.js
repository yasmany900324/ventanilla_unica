import { describe, expect, it } from "vitest";
import { extractWhisperTranscriptionText } from "./openaiWhisperProvider";

describe("extractWhisperTranscriptionText", () => {
  it("lee result.text", () => {
    expect(extractWhisperTranscriptionText({ text: "  hola  " })).toBe("  hola  ");
  });

  it("concatena segments si text falta", () => {
    expect(
      extractWhisperTranscriptionText({
        segments: [{ text: "Hola," }, { text: " mundo" }],
      })
    ).toBe("Hola, mundo");
  });

  it("parsea JSON string con text", () => {
    expect(extractWhisperTranscriptionText('{"text":"hola"}')).toBe("hola");
  });
});

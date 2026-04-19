import { describe, expect, it } from "vitest";
import { hasProcedureSpecificSignals, normalizeIntentLookup } from "./chatbotIntentUtils";

describe("normalizeIntentLookup", () => {
  it("normalizes accents, punctuation and spacing", () => {
    expect(normalizeIntentLookup("  Quisiera iniciar un trámite!!!  ")).toBe(
      "quisiera iniciar un tramite"
    );
  });
});

describe("hasProcedureSpecificSignals", () => {
  it("returns false for generic start-procedure phrases", () => {
    const genericInputs = [
      "Quiero iniciar un trámite",
      "quisiera iniciar un trámite",
      "me gustaría iniciar un trámite",
      "deseo iniciar un trámite",
      "necesito hacer un trámite",
      "quisiera realizar una gestión",
      "quiero gestionar un trámite",
    ];

    genericInputs.forEach((text) => {
      expect(hasProcedureSpecificSignals(text)).toBe(false);
    });
  });

  it("returns true for specific procedure descriptions", () => {
    const specificInputs = [
      "Quiero iniciar habilitación comercial",
      "Necesito sacar permiso de construcción",
      "Quiero tramitar libreta de conducir por primera vez",
    ];

    specificInputs.forEach((text) => {
      expect(hasProcedureSpecificSignals(text)).toBe(true);
    });
  });
});

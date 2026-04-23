import { describe, expect, it } from "vitest";
import {
  assessSttCriticalIncidentTurn,
  formatSttCriticalEchoUserReply,
  textSignalsHardCriticalStt,
  textSignalsSoftCriticalStt,
} from "./sttCriticalData";

describe("textSignalsHardCriticalStt", () => {
  it("detecta calle con número y esquina", () => {
    expect(
      textSignalsHardCriticalStt(
        "Quiero reportar un árbol caído en Daniel Fernández Crespo 2118 esquina Lima"
      )
    ).toBe(true);
  });

  it("no marca texto trivial", () => {
    expect(textSignalsHardCriticalStt("hola")).toBe(false);
  });
});

describe("textSignalsSoftCriticalStt", () => {
  it("marca relato largo sin dato duro", () => {
    const long = "a".repeat(150);
    expect(textSignalsSoftCriticalStt(long)).toBe(true);
    expect(textSignalsHardCriticalStt(long)).toBe(false);
  });
});

describe("assessSttCriticalIncidentTurn", () => {
  it("requiere eco con ubicación aceptada concreta (hard)", () => {
    const r = assessSttCriticalIncidentTurn({
      inboundUserTextSource: "speech_to_text",
      channel: "whatsapp",
      text: "caído en calle X 1234",
      acceptedEntities: ["location"],
      mergedData: { location: "Calle X 1234", description: "", risk: "" },
    });
    expect(r.requiresEcho).toBe(true);
    expect(r.echoLines.some((l) => l.includes("Ubicación"))).toBe(true);
  });

  it("no fuerza eco solo por descripción larga sin señales duras", () => {
    const longDesc = "pasó algo muy largo " + "x".repeat(120);
    const r = assessSttCriticalIncidentTurn({
      inboundUserTextSource: "speech_to_text",
      channel: "whatsapp",
      text: longDesc,
      acceptedEntities: ["description"],
      mergedData: { location: "", description: longDesc, risk: "bajo" },
    });
    expect(r.requiresEcho).toBe(false);
  });

  it("no fuerza eco con ubicación vaga sin número ni esquina", () => {
    const r = assessSttCriticalIncidentTurn({
      inboundUserTextSource: "speech_to_text",
      channel: "whatsapp",
      text: "en el barrio sur",
      acceptedEntities: ["location"],
      mergedData: { location: "barrio sur", description: "", risk: "" },
    });
    expect(r.requiresEcho).toBe(false);
  });

  it("skips echo when not STT", () => {
    const r = assessSttCriticalIncidentTurn({
      inboundUserTextSource: null,
      channel: "whatsapp",
      text: "calle 123",
      acceptedEntities: ["location"],
      mergedData: { location: "Calle 123", description: "", risk: "" },
    });
    expect(r.requiresEcho).toBe(false);
  });
});

describe("formatSttCriticalEchoUserReply", () => {
  it("usa intro humana y el dato", () => {
    const msg = formatSttCriticalEchoUserReply(["Ubicación: Daniel Fernández Crespo 2118, esquina Lima"]);
    expect(msg).toContain("Esto fue lo que entendí de tu audio");
    expect(msg).toContain("Daniel Fernández");
    expect(msg).toMatch(/¿Es correcto\?/);
  });

  it("puede incluir preview del audio si no repite el detalle", () => {
    const msg = formatSttCriticalEchoUserReply(["Ubicación: X 1"], {
      transcriptPreview: "Quiero reportar algo en la calle",
    });
    expect(msg).toContain("Quiero reportar");
  });
});

import { describe, expect, it } from "vitest";
import { coerceIncidentGeoCoords } from "./incidents";

describe("coerceIncidentGeoCoords", () => {
  it("acepta pares válidos", () => {
    expect(coerceIncidentGeoCoords(-34.9, -56.16)).toEqual({
      locationLatitude: -34.9,
      locationLongitude: -56.16,
    });
  });

  it("rechaza latitud fuera de rango", () => {
    expect(coerceIncidentGeoCoords(95, 0)).toEqual({
      locationLatitude: null,
      locationLongitude: null,
    });
  });

  it("rechaza longitud fuera de rango", () => {
    expect(coerceIncidentGeoCoords(0, 200)).toEqual({
      locationLatitude: null,
      locationLongitude: null,
    });
  });

  it("rechaza no numéricos", () => {
    expect(coerceIncidentGeoCoords("x", "y")).toEqual({
      locationLatitude: null,
      locationLongitude: null,
    });
  });
});

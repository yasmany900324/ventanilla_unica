import { describe, expect, it } from "vitest";
import { buildCitizenGeocodeLabel } from "./formatCitizenGeocodeLabel";

describe("buildCitizenGeocodeLabel", () => {
  it("builds a short citizen line from structured address (es)", () => {
    const payload = {
      display_name: "1993, 1995, Calle Defensa, Reus, Villa Muñoz, Montevideo, Uruguay",
      address: {
        road: "Calle Defensa",
        suburb: "Villa Muñoz",
        city: "Montevideo",
        country: "Uruguay",
      },
    };
    const label = buildCitizenGeocodeLabel(payload, "es");
    expect(label).toContain("Defensa");
    expect(label).toContain("Villa Muñoz");
    expect(label).toContain("Montevideo");
    expect(label).not.toMatch(/^1993/);
  });

  it("uses English phrasing when locale is en", () => {
    const payload = {
      display_name: "Somewhere",
      address: { road: "Main Street", city: "Springfield", country: "United States" },
    };
    expect(buildCitizenGeocodeLabel(payload, "en")).toMatch(/^Near Main Street,/);
  });
});

import { NextResponse } from "next/server";
import { buildCitizenGeocodeLabel } from "../../../../lib/formatCitizenGeocodeLabel";

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

function clampLabel(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
}

function normalizeLocaleParam(raw) {
  const s = typeof raw === "string" ? raw.trim().slice(0, 8).toLowerCase() : "";
  if (s.startsWith("en")) {
    return "en";
  }
  if (s.startsWith("pt")) {
    return "pt";
  }
  return "es";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const locale = normalizeLocaleParam(searchParams.get("locale"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: "Coordinates out of range" }, { status: 400 });
  }

  try {
    const nominatimUrl = new URL(NOMINATIM_REVERSE);
    nominatimUrl.searchParams.set("format", "jsonv2");
    nominatimUrl.searchParams.set("lat", String(lat));
    nominatimUrl.searchParams.set("lon", String(lon));

    const upstream = await fetch(nominatimUrl.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "VentanillaUnica/1.0 (reverse geocode for citizen chatbot)",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json({ label: "" });
    }

    const payload = await upstream.json();
    const friendly = buildCitizenGeocodeLabel(payload, locale);
    const label = clampLabel(friendly, 130);

    return NextResponse.json({ label });
  } catch {
    return NextResponse.json({ label: "" });
  }
}

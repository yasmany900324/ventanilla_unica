import { NextResponse } from "next/server";

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

function clampDisplayName(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1).trimEnd()}…` : trimmed;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

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
    const label = clampDisplayName(payload?.display_name, 120);

    return NextResponse.json({ label });
  } catch {
    return NextResponse.json({ label: "" });
  }
}

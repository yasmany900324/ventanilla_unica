"use client";

import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function MiniMapResize() {
  const map = useMap();
  useEffect(() => {
    const run = () => map.invalidateSize({ animate: false });
    run();
    const timeouts = [40, 160, 320].map((ms) => window.setTimeout(run, ms));
    return () => timeouts.forEach((id) => window.clearTimeout(id));
  }, [map]);
  return null;
}

export default function LocationMapPreview({ latitude, longitude, ariaLabel }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return (
    <div className="assistant-location-preview-map" role="img" aria-label={ariaLabel || undefined}>
      <MapContainer
        center={[lat, lng]}
        zoom={16}
        className="assistant-location-preview-map__leaflet"
        dragging={false}
        touchZoom={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        zoomControl={false}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[lat, lng]}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: "#dc2626",
            fillOpacity: 1,
            opacity: 1,
          }}
        />
        <MiniMapResize />
      </MapContainer>
    </div>
  );
}

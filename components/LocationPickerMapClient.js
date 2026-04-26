"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function MapResizeController() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (!container) {
      return undefined;
    }

    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };

    invalidate();
    const timeouts = [0, 50, 150, 320, 600].map((ms) => window.setTimeout(invalidate, ms));

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        invalidate();
      });
      resizeObserver.observe(container);
      if (container.parentElement) {
        resizeObserver.observe(container.parentElement);
      }
    }

    window.addEventListener("resize", invalidate);

    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
      resizeObserver?.disconnect();
      window.removeEventListener("resize", invalidate);
    };
  }, [map]);

  return null;
}

function MapCenterTracker({ onCenterChange }) {
  useMapEvents({
    load(event) {
      const map = event.target;
      const c = map.getCenter();
      onCenterChange({ lat: c.lat, lng: c.lng });
    },
    moveend(event) {
      const map = event.target;
      const c = map.getCenter();
      onCenterChange({ lat: c.lat, lng: c.lng });
    },
  });
  return null;
}

export default function LocationPickerMapClient({ initialCenter, onCenterChange }) {
  return (
    <MapContainer
      key={`${initialCenter.lat}-${initialCenter.lng}`}
      center={[initialCenter.lat, initialCenter.lng]}
      zoom={16}
      scrollWheelZoom
      className="assistant-location-dialog__leaflet-root"
      style={{ width: "100%", height: "100%", minHeight: "inherit" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapResizeController />
      <MapCenterTracker onCenterChange={onCenterChange} />
    </MapContainer>
  );
}

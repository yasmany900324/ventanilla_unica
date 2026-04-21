"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = {
  lat: -34.9011,
  lng: -56.1645,
};

function normalizeCenter(center) {
  if (
    center &&
    Number.isFinite(Number(center.lat)) &&
    Number.isFinite(Number(center.lng))
  ) {
    return {
      lat: Number(center.lat),
      lng: Number(center.lng),
    };
  }
  return DEFAULT_CENTER;
}

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

function LocationPickerModalDialog({
  initialCenter,
  copy,
  disabled = false,
  onConfirm,
  onCancel,
}) {
  const locationMapCopy = copy?.locationMap || {};
  const normalizedInitialCenter = useMemo(() => normalizeCenter(initialCenter), [initialCenter]);
  const centerRef = useRef(normalizedInitialCenter);
  const syncCenter = useCallback((next) => {
    centerRef.current = normalizeCenter(next);
  }, []);

  useEffect(() => {
    centerRef.current = normalizedInitialCenter;
  }, [normalizedInitialCenter]);

  const title = locationMapCopy.mapTitle || locationMapCopy.modalTitle || "Elegir ubicación en mapa";
  const hint =
    locationMapCopy.mapInstruction ||
    locationMapCopy.mapHint ||
    "Mové el mapa: el pin indica el punto que se va a confirmar.";
  const confirmLabel = locationMapCopy.mapConfirm || locationMapCopy.confirmMapSelection || "Confirmar ubicación";
  const cancelLabel = locationMapCopy.mapCancel || locationMapCopy.cancel || "Cancelar";

  const handleConfirmClick = useCallback(() => {
    const { lat, lng } = normalizeCenter(centerRef.current);
    onConfirm({ latitude: lat, longitude: lng });
  }, [onConfirm]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="assistant-location-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-location-dialog-title"
      onClick={disabled ? undefined : onCancel}
    >
      <section className="assistant-location-dialog__panel" onClick={(event) => event.stopPropagation()}>
        <header className="assistant-location-dialog__header">
          <h3 id="assistant-location-dialog-title">{title}</h3>
          <button
            type="button"
            className="assistant-location-dialog__close"
            onClick={onCancel}
            disabled={disabled}
            aria-label={cancelLabel}
          >
            ×
          </button>
        </header>

        <p className="assistant-location-dialog__hint">{hint}</p>

        <div className="assistant-location-dialog__map-shell">
          <MapContainer
            key={`${normalizedInitialCenter.lat}-${normalizedInitialCenter.lng}`}
            center={[normalizedInitialCenter.lat, normalizedInitialCenter.lng]}
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
            <MapCenterTracker onCenterChange={syncCenter} />
          </MapContainer>
          <div className="assistant-location-dialog__pin" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M12 2c-4.06 0-7.35 3.2-7.35 7.15 0 5.7 7.35 12.7 7.35 12.7s7.35-7 7.35-12.7C19.35 5.2 16.06 2 12 2Z" />
              <circle cx="12" cy="9" r="2.6" />
            </svg>
          </div>
        </div>

        <div className="assistant-location-dialog__actions">
          <button
            type="button"
            className="assistant-location-dialog__button"
            onClick={handleConfirmClick}
            disabled={disabled}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="assistant-location-dialog__button assistant-location-dialog__button--ghost"
            onClick={onCancel}
            disabled={disabled}
          >
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function LocationPickerModal({
  isOpen,
  initialCenter,
  copy,
  disabled = false,
  onConfirm,
  onCancel,
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!mounted || !isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <LocationPickerModalDialog
      initialCenter={initialCenter}
      copy={copy}
      disabled={disabled}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
    document.body
  );
}

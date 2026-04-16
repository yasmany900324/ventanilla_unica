"use client";

import Link from "next/link";
import {
  STATUS_LABELS,
  formatDate,
  formatIncidentCode,
  shortenText,
} from "../lib/incidentDisplay";

export default function IncidentListItem({
  incident,
  className = "",
  isSelected = false,
  onSelect = null,
  actionLabel = "Ver detalle",
  actionHref = "",
  descriptionLimit = 120,
}) {
  const rootClassName = `incident-card ${className}`.trim();
  const badgeClassName = `badge badge--${incident.status.replace(" ", "-")}`;

  return (
    <li className={rootClassName}>
      <div className="incident-card__header">
        <h3>{incident.category}</h3>
        <div className="incident-card__badges">
          <span className={badgeClassName}>
            {STATUS_LABELS[incident.status] || incident.status}
          </span>
          {isSelected ? <span className="selected-indicator">Seleccionada</span> : null}
        </div>
      </div>
      <p className="small">
        <strong>Codigo:</strong> {formatIncidentCode(incident.id)}
      </p>
      <p className="small">
        <strong>Descripcion breve:</strong> {shortenText(incident.description, descriptionLimit)}
      </p>
      <p className="small">
        <strong>Ubicacion:</strong> {incident.location}
      </p>
      <p className="small">
        <strong>Fecha de registro:</strong> {formatDate(incident.createdAt)}
      </p>
      <p className="small">
        <strong>Estado actual:</strong> {STATUS_LABELS[incident.status] || incident.status}
      </p>
      {onSelect ? (
        <button
          type="button"
          className={`button-inline${isSelected ? " button-inline--selected" : ""}`}
          aria-pressed={isSelected}
          onClick={() => onSelect(incident.id)}
        >
          {actionLabel}
        </button>
      ) : (
        <Link href={actionHref} className="button-link button-link--secondary button-link--compact">
          {actionLabel}
        </Link>
      )}
    </li>
  );
}

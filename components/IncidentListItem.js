"use client";

import Link from "next/link";
import {
  getStatusLabels,
  formatDate,
  formatIncidentCode,
  shortenText,
} from "../lib/incidentDisplay";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

export default function IncidentListItem({
  incident,
  className = "",
  isSelected = false,
  onSelect = null,
  actionLabel = "",
  actionHref = "",
  descriptionLimit = 120,
  actionButtonRef = null,
  isActionDisabled = false,
  actionAriaControls = undefined,
  actionAriaExpanded = undefined,
}) {
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const statusLabels = getStatusLabels(locale);
  const rootClassName = `incident-card ${className}`.trim();
  const badgeClassName = `badge badge--${incident.status.replace(" ", "-")}`;

  return (
    <li className={rootClassName}>
      <div className="incident-card__header">
        <h3>{incident.category}</h3>
        <div className="incident-card__badges">
          <span className={badgeClassName}>
            {statusLabels[incident.status] || incident.status}
          </span>
          {isSelected ? <span className="selected-indicator">{copy.incident.selected}</span> : null}
        </div>
      </div>
      <p className="small">
        <strong>{copy.incident.code}:</strong> {formatIncidentCode(incident.id)}
      </p>
      <p className="small">
        <strong>{copy.incident.briefDescription}:</strong>{" "}
        {shortenText(incident.description, descriptionLimit)}
      </p>
      <p className="small">
        <strong>{copy.incident.location}:</strong> {incident.location}
      </p>
      <p className="small">
        <strong>{copy.incident.createdAt}:</strong> {formatDate(incident.createdAt, locale)}
      </p>
      <p className="small">
        <strong>{copy.incident.currentStatus}:</strong>{" "}
        {statusLabels[incident.status] || incident.status}
      </p>
      {onSelect ? (
        <button
          type="button"
          className={`button-inline${isSelected ? " button-inline--selected" : ""}`}
          aria-pressed={isSelected}
          aria-controls={actionAriaControls}
          aria-expanded={actionAriaExpanded}
          ref={actionButtonRef}
          onClick={() => onSelect(incident.id)}
          disabled={isActionDisabled}
        >
          {actionLabel || copy.incident.detailsAction}
        </button>
      ) : (
        <Link href={actionHref} className="button-link button-link--secondary button-link--compact">
          {actionLabel || copy.incident.detailsAction}
        </Link>
      )}
    </li>
  );
}

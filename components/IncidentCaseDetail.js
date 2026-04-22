"use client";

import {
  buildHistoryEntries,
  formatDate,
  formatIncidentCode,
  getStatusLabels,
  getStatusSteps,
} from "../lib/incidentDisplay";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

export default function IncidentCaseDetail({
  incident = null,
  headingRef = null,
  headingId = undefined,
  headingLevel = 2,
  title = "Detalle y seguimiento del caso",
  description = "Aquí se muestra la información del caso seleccionado.",
  backButtonLabel = "",
  onBackButtonClick = null,
  isBackButtonDisabled = false,
  emptyStateMessage = "Selecciona una incidencia reciente para ver su información detallada.",
}) {
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const statusLabels = getStatusLabels(locale);
  const statusSteps = getStatusSteps(locale);
  const shouldRenderLevelThreeHeading = headingLevel === 3;
  const selectedStatusIndex = statusSteps.findIndex(
    (status) => status.value === incident?.status
  );
  const historyEntries = buildHistoryEntries(incident, locale);

  return (
    <>
      {shouldRenderLevelThreeHeading ? (
        <h3 id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </h3>
      ) : (
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
      )}
      <p className="small">{description}</p>

      {onBackButtonClick ? (
        <button
          type="button"
          className="button-link button-link--secondary button-link--compact button-link--button case-detail-back-button"
          onClick={onBackButtonClick}
          disabled={isBackButtonDisabled}
        >
          {backButtonLabel || copy.incident.backToList}
        </button>
      ) : null}

      {!incident ? (
        <p className="empty-message">
          {emptyStateMessage}
        </p>
      ) : (
        <>
          <p className="small detail-selected-hint">
            {copy.incident.caseSelected}: <strong>{formatIncidentCode(incident.id)}</strong>
          </p>
          <div className="case-detail-grid">
            <p className="small">
              <strong>{copy.incident.code}:</strong> {formatIncidentCode(incident.id)}
            </p>
            <p className="small">
              <strong>{copy.incident.category}:</strong> {incident.category}
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
            <p className="small">
              <strong>{copy.incident.lastUpdate}:</strong>{" "}
              {formatDate(incident.updatedAt || incident.createdAt, locale)}
            </p>
          </div>
          <p className="small">
            <strong>{copy.incident.fullDescription}:</strong> {incident.description}
          </p>

          {incident.hasAttachment && incident.attachmentImageUrl ? (
            <div className="incident-detail-attachment">
              <h3>{copy.incident.attachmentSectionTitle}</h3>
              {incident.attachmentOriginalName ? (
                <p className="small">
                  <strong>{copy.incident.attachmentFileName}:</strong> {incident.attachmentOriginalName}
                </p>
              ) : null}
              {incident.attachmentUploadedAt ? (
                <p className="small">
                  <strong>{copy.incident.attachmentUploadedLabel}:</strong>{" "}
                  {formatDate(incident.attachmentUploadedAt, locale)}
                </p>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element -- URL autenticada por cookie en el mismo sitio */}
              <img
                src={incident.attachmentImageUrl}
                alt={copy.incident.attachmentImageAlt}
                className="incident-detail-attachment__image"
              />
            </div>
          ) : incident.hasAttachment ? (
            <p className="small" role="status">
              {copy.incident.attachmentUnavailable}
            </p>
          ) : null}

          <div className="timeline-section">
            <h3>{copy.incident.caseProgress}</h3>
            <ol className="timeline-steps" aria-label={copy.incident.caseTimelineAria}>
              {statusSteps.map((step, index) => {
                const stepState =
                  index < selectedStatusIndex
                    ? "done"
                    : index === selectedStatusIndex
                    ? "current"
                    : "pending";

                return (
                  <li
                    key={step.value}
                    className={`timeline-step timeline-step--${stepState}`}
                  >
                    {step.label}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="updates-section">
            <h3>{copy.incident.updatesHistory}</h3>
            <ul className="updates-list">
              {historyEntries.map((entry) => (
                <li key={entry.id} className="updates-item">
                  <p>
                    <strong>{entry.title}</strong>
                  </p>
                  <p className="small">{entry.date}</p>
                  <p className="small">{entry.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

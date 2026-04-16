"use client";

import {
  STATUS_LABELS,
  STATUS_STEPS,
  buildHistoryEntries,
  formatDate,
  formatIncidentCode,
} from "../lib/incidentDisplay";

export default function IncidentCaseDetail({
  incident = null,
  headingRef = null,
  headingId = undefined,
  headingLevel = 2,
  title = "Detalle y seguimiento del caso",
  description = "Aqui se muestra la informacion del caso seleccionado.",
  backButtonLabel = "",
  onBackButtonClick = null,
  isBackButtonDisabled = false,
}) {
  const shouldRenderLevelThreeHeading = headingLevel === 3;
  const selectedStatusIndex = STATUS_STEPS.findIndex(
    (status) => status.value === incident?.status
  );
  const historyEntries = buildHistoryEntries(incident);

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
          {backButtonLabel || "Volver al listado"}
        </button>
      ) : null}

      {!incident ? (
        <p className="empty-message">
          Selecciona una incidencia reciente para ver su informacion detallada.
        </p>
      ) : (
        <>
          <p className="small detail-selected-hint">
            Caso seleccionado: <strong>{formatIncidentCode(incident.id)}</strong>
          </p>
          <div className="case-detail-grid">
            <p className="small">
              <strong>Codigo:</strong> {formatIncidentCode(incident.id)}
            </p>
            <p className="small">
              <strong>Categoria:</strong> {incident.category}
            </p>
            <p className="small">
              <strong>Ubicacion:</strong> {incident.location}
            </p>
            <p className="small">
              <strong>Fecha de registro:</strong> {formatDate(incident.createdAt)}
            </p>
            <p className="small">
              <strong>Estado actual:</strong>{" "}
              {STATUS_LABELS[incident.status] || incident.status}
            </p>
            <p className="small">
              <strong>Ultima actualizacion:</strong>{" "}
              {formatDate(incident.updatedAt || incident.createdAt)}
            </p>
          </div>
          <p className="small">
            <strong>Descripcion completa:</strong> {incident.description}
          </p>

          <div className="timeline-section">
            <h3>Progreso del caso</h3>
            <ol className="timeline-steps" aria-label="Timeline del caso">
              {STATUS_STEPS.map((step, index) => {
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
            <h3>Historial de actualizaciones</h3>
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

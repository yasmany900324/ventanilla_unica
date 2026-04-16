"use client";

const STATUS_FLOW = ["recibido", "en proceso", "resuelto"];

export default function IncidentPanel({ incidents, onAdvanceStatus }) {
  if (!incidents.length) {
    return (
      <section className="panel">
        <p className="empty-message">
          No hay casos todavía. Envía una solicitud para verla aquí.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <ul className="incident-list">
        {incidents.map((incident) => {
          const currentStatusIndex = STATUS_FLOW.indexOf(incident.status);
          const isResolved = incident.status === "resuelto";

          return (
            <li key={incident.id} className="incident-card">
              <div className="incident-card__header">
                <h3>{incident.category}</h3>
                <span className={`badge badge--${incident.status.replace(" ", "-")}`}>
                  {incident.status}
                </span>
              </div>
              <p>{incident.description}</p>
              <p className="location">
                <strong>Ubicación:</strong> {incident.location}
              </p>
              <p className="progress">
                Estado {currentStatusIndex + 1} de {STATUS_FLOW.length}
              </p>
              <button
                type="button"
                onClick={() => onAdvanceStatus(incident.id)}
                disabled={isResolved}
                aria-label={`Avanzar estado del caso ${incident.category}`}
              >
                {isResolved ? "Caso resuelto" : "Avanzar estado"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

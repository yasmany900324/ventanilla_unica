"use client";

const STATUS_FLOW = ["recibido", "en revision", "en proceso", "resuelto"];

const STATUS_LABELS = {
  recibido: "Recibido",
  "en revision": "En revision",
  "en proceso": "En proceso",
  resuelto: "Resuelto",
};

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
          const currentProgress =
            currentStatusIndex >= 0 ? currentStatusIndex + 1 : 1;

          return (
            <li key={incident.id} className="incident-card">
              <div className="incident-card__header">
                <h3>{incident.category}</h3>
                <span className={`badge badge--${incident.status.replace(" ", "-")}`}>
                  {STATUS_LABELS[incident.status] || incident.status}
                </span>
              </div>
              <p>{incident.description}</p>
              <p className="location">
                <strong>Ubicación:</strong> {incident.location}
              </p>
              <p className="progress">
                Estado {currentProgress} de {STATUS_FLOW.length}
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

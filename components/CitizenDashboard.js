"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import IncidentForm from "./IncidentForm";

const STATUS_STEPS = [
  { value: "recibido", label: "Recibido" },
  { value: "en revision", label: "En revisión" },
  { value: "en proceso", label: "En proceso" },
  { value: "resuelto", label: "Resuelto" },
];

const STATUS_LABELS = STATUS_STEPS.reduce((accumulator, status) => {
  return { ...accumulator, [status.value]: status.label };
}, {});

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatIncidentCode(id) {
  return `INC-${String(id).slice(0, 8).toUpperCase()}`;
}

function formatCategory(value) {
  if (!value) {
    return "Sin categoría";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortenText(value, limit = 120) {
  if (!value) {
    return "";
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}...`;
}

function buildHistoryEntries(incident) {
  if (!incident) {
    return [];
  }

  const currentStatusIndex = STATUS_STEPS.findIndex(
    (step) => step.value === incident.status
  );
  const reachedSteps = STATUS_STEPS.slice(
    0,
    currentStatusIndex >= 0 ? currentStatusIndex + 1 : 1
  );

  return reachedSteps.map((step, index) => ({
    id: `${incident.id}-${step.value}`,
    title:
      index === 0 ? "Incidencia registrada" : `Estado actualizado: ${step.label}`,
    date:
      index === 0
        ? formatDate(incident.createdAt)
        : formatDate(incident.updatedAt || incident.createdAt),
    description:
      index === 0
        ? "La incidencia fue registrada correctamente en la plataforma."
        : "El caso avanzó dentro del flujo institucional de atención.",
  }));
}

export default function CitizenDashboard() {
  const [incidents, setIncidents] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadIncidents = async () => {
      try {
        const response = await fetch("/api/incidents");
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "No se pudieron cargar las incidencias.");
        }

        const loadedIncidents = data.incidents ?? [];
        setIncidents(loadedIncidents);
        if (loadedIncidents.length > 0) {
          setSelectedIncidentId(loadedIncidents[0].id);
        }
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadIncidents();
  }, []);

  const selectedIncident = useMemo(() => {
    if (!incidents.length) {
      return null;
    }

    return (
      incidents.find((incident) => incident.id === selectedIncidentId) ??
      incidents[0]
    );
  }, [incidents, selectedIncidentId]);

  const summary = useMemo(() => {
    const initialSummary = {
      total: incidents.length,
      recibido: 0,
      enRevision: 0,
      enProceso: 0,
      resuelto: 0,
    };

    incidents.forEach((incident) => {
      if (incident.status === "recibido") {
        initialSummary.recibido += 1;
      } else if (incident.status === "en revision") {
        initialSummary.enRevision += 1;
      } else if (incident.status === "en proceso") {
        initialSummary.enProceso += 1;
      } else if (incident.status === "resuelto") {
        initialSummary.resuelto += 1;
      }
    });

    return initialSummary;
  }, [incidents]);

  const handleCreateIncident = async (newIncidentData) => {
    setErrorMessage("");

    const response = await fetch("/api/incidents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newIncidentData),
    });
    const data = await response.json();

    if (!response.ok) {
      const message = data.error || "No se pudo registrar la incidencia.";
      setErrorMessage(message);
      throw new Error(message);
    }

    setIncidents((previousIncidents) => [data.incident, ...previousIncidents]);
    setSelectedIncidentId(data.incident.id);
  };

  const selectedStatusIndex = STATUS_STEPS.findIndex(
    (status) => status.value === selectedIncident?.status
  );
  const historyEntries = buildHistoryEntries(selectedIncident);
  const summaryCards = [
    { label: "Total de incidencias", value: summary.total, tone: "total" },
    { label: "Recibidas", value: summary.recibido, tone: "recibido" },
    { label: "En revisión", value: summary.enRevision, tone: "revision" },
    { label: "En proceso", value: summary.enProceso, tone: "proceso" },
    { label: "Resueltas", value: summary.resuelto, tone: "resuelto" },
  ];

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">Panel ciudadano</p>
          <h1>Bienvenido a tu espacio ciudadano</h1>
          <p className="description">
            Tu sesión está activa. Desde aquí puedes registrar incidencias y
            consultar su seguimiento en un entorno privado.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/" className="button-link button-link--secondary">
            Volver al inicio
          </Link>
          <Link href="/login" className="button-link">
            Cerrar sesión
          </Link>
        </div>
      </section>

      <section className="summary-grid" aria-label="Resumen de incidencias">
        {summaryCards.map((item) => (
          <article
            key={item.label}
            className={`card summary-card summary-card--${item.tone}`}
          >
            <p className="summary-card__label">{item.label}</p>
            <p className="summary-card__value">{item.value}</p>
          </article>
        ))}
      </section>

      <div className="layout layout--dashboard">
        <section id="nueva-incidencia" className="card">
          <h2>Registrar nueva incidencia</h2>
          <p className="small">
            Ingresa la información del caso para iniciar su atención.
          </p>
          <IncidentForm
            onSubmit={handleCreateIncident}
            submitLabel="Registrar incidencia"
          />
        </section>

        <section id="mis-incidencias" className="card">
          <h2>Mis incidencias</h2>
          <p className="small">
            Revisa tus incidencias y selecciona un caso para consultar su
            detalle.
          </p>
          {isLoading ? (
            <p className="info-message">Cargando incidencias...</p>
          ) : null}
          {!isLoading && incidents.length === 0 ? (
            <p className="empty-message">
              Aún no tienes incidencias registradas en tu espacio ciudadano.
            </p>
          ) : null}
          {incidents.length > 0 ? (
            <ul className="incident-list citizen-incident-list">
              {incidents.map((incident) => (
                <li
                  key={incident.id}
                  className={`incident-card ${
                    incident.id === selectedIncident?.id ? "incident-card--active" : ""
                  }`}
                >
                  <div className="incident-card__header">
                    <h3 className="incident-card__title">
                      {formatCategory(incident.category)}
                    </h3>
                    <span
                      className={`badge badge--${incident.status.replace(
                        " ",
                        "-"
                      )}`}
                    >
                      {STATUS_LABELS[incident.status] || incident.status}
                    </span>
                  </div>
                  <dl className="incident-meta-grid">
                    <div>
                      <dt>Código</dt>
                      <dd>{formatIncidentCode(incident.id)}</dd>
                    </div>
                    <div>
                      <dt>Ubicación</dt>
                      <dd>{incident.location}</dd>
                    </div>
                    <div>
                      <dt>Fecha</dt>
                      <dd>{formatDate(incident.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Estado actual</dt>
                      <dd>{STATUS_LABELS[incident.status] || incident.status}</dd>
                    </div>
                    <div>
                      <dt>Última actualización</dt>
                      <dd>{formatDate(incident.updatedAt || incident.createdAt)}</dd>
                    </div>
                  </dl>
                  <p className="small incident-description">
                    <strong>Descripción breve:</strong>{" "}
                    {shortenText(incident.description)}
                  </p>
                  <button
                    type="button"
                    className="button-inline"
                    onClick={() => setSelectedIncidentId(incident.id)}
                  >
                    Ver seguimiento del caso
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section id="detalle-caso" className="card case-detail-card">
        <h2>Detalle y seguimiento del caso</h2>
        {!selectedIncident ? (
          <p className="empty-message">
            Selecciona una incidencia para consultar su información detallada.
          </p>
        ) : (
          <>
            <div className="case-detail-section">
              <h3>Información general del caso</h3>
              <dl className="case-facts-grid">
                <div>
                  <dt>Código</dt>
                  <dd>{formatIncidentCode(selectedIncident.id)}</dd>
                </div>
                <div>
                  <dt>Categoría</dt>
                  <dd>{formatCategory(selectedIncident.category)}</dd>
                </div>
                <div>
                  <dt>Ubicación</dt>
                  <dd>{selectedIncident.location}</dd>
                </div>
                <div>
                  <dt>Fecha de registro</dt>
                  <dd>{formatDate(selectedIncident.createdAt)}</dd>
                </div>
                <div>
                  <dt>Estado actual</dt>
                  <dd>
                    {STATUS_LABELS[selectedIncident.status] ||
                      selectedIncident.status}
                  </dd>
                </div>
                <div>
                  <dt>Última actualización</dt>
                  <dd>
                    {formatDate(
                      selectedIncident.updatedAt || selectedIncident.createdAt
                    )}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="case-detail-section">
              <h3>Descripción del caso</h3>
              <p className="small case-description">{selectedIncident.description}</p>
            </div>

            <div className="timeline-section">
              <h3>Progreso del caso</h3>
              <ol className="timeline-steps" aria-label="Barra de progreso del caso">
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
                    <p className="updates-item__title">{entry.title}</p>
                    <p className="updates-item__date">{entry.date}</p>
                    <p className="updates-item__description">{entry.description}</p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

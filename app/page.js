"use client";

import { useEffect, useState } from "react";
import IncidentForm from "../components/IncidentForm";
import IncidentPanel from "../components/IncidentPanel";

const FEATURE_SUMMARY = [
  {
    title: "Registro simple",
    description:
      "Ingresa una solicitud con la información necesaria para iniciar su atención.",
  },
  {
    title: "Seguimiento claro",
    description:
      "Visualiza el estado de cada caso y su avance dentro del proceso de atención.",
  },
  {
    title: "Atención organizada",
    description:
      "Facilita la gestión y resolución de solicitudes ciudadanas en un solo flujo.",
  },
];

const ATTENTION_FLOW = ["Recibido", "En revisión", "En proceso", "Resuelto"];

export default function HomePage() {
  const [incidents, setIncidents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadIncidents = async () => {
      try {
        const response = await fetch("/api/incidents");
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "No se pudieron cargar los casos.");
        }

        setIncidents(data.incidents ?? []);
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadIncidents();
  }, []);

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
      const message = data.error || "No se pudo registrar la solicitud.";
      setErrorMessage(message);
      throw new Error(message);
    }

    setIncidents((prev) => [data.incident, ...prev]);
  };

  const handleAdvanceStatus = async (incidentId) => {
    setErrorMessage("");
    try {
      const response = await fetch(`/api/incidents/${incidentId}/advance`, {
        method: "PATCH",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo actualizar el estado.");
      }

      setIncidents((prev) =>
        prev.map((incident) =>
          incident.id === incidentId ? data.incident : incident
        )
      );
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  return (
    <main className="page">
      <section className="card card--hero">
        <p className="eyebrow">Atención ciudadana digital</p>
        <h1>Sistema de Atención Ciudadana</h1>
        <p className="description">
          Registra solicitudes, reclamos o incidencias y consulta su estado
          dentro de un flujo simple de atención.
        </p>
        <div className="hero-actions">
          <a href="#registro" className="button-link">
            Registrar solicitud
          </a>
          <a href="#seguimiento" className="button-link button-link--secondary">
            Ver seguimiento
          </a>
        </div>
      </section>

      <section className="feature-grid" aria-label="Funcionalidades principales">
        {FEATURE_SUMMARY.map((feature) => (
          <article key={feature.title} className="card feature-card">
            <h2>{feature.title}</h2>
            <p className="small">{feature.description}</p>
          </article>
        ))}
      </section>

      <section className="card flow-section">
        <h2>Flujo de atención</h2>
        <p className="small">Cada caso avanza por etapas claras y visibles.</p>
        <ul className="flow-steps" aria-label="Etapas del flujo de atención">
          {ATTENTION_FLOW.map((step) => (
            <li key={step} className="flow-step">
              {step}
            </li>
          ))}
        </ul>
      </section>

      <div className="layout">
        <section id="registro" className="card">
          <h2>Registrar solicitud</h2>
          <IncidentForm onSubmit={handleCreateIncident} />
        </section>

        <section id="seguimiento" className="card">
          <h2>Seguimiento de casos</h2>
          <IncidentPanel
            incidents={incidents}
            onAdvanceStatus={handleAdvanceStatus}
          />
        </section>
      </div>

      {isLoading && <p className="info-message">Cargando casos...</p>}
      {!isLoading && incidents.length === 0 && (
        <p className="info-message">
          Aún no hay casos registrados. Crea una solicitud para comenzar.
        </p>
      )}
      {errorMessage && <p className="error-message">{errorMessage}</p>}
    </main>
  );
}

"use client";

import { useState } from "react";
import IncidentForm from "../components/IncidentForm";
import IncidentPanel from "../components/IncidentPanel";

const STATUS_FLOW = ["recibido", "en proceso", "resuelto"];

function buildNewIncident(formData) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category: formData.category,
    description: formData.description,
    location: formData.location,
    status: "recibido",
  };
}

export default function HomePage() {
  const [incidents, setIncidents] = useState([]);

  const handleCreateIncident = (newIncidentData) => {
    const newIncident = buildNewIncident(newIncidentData);
    setIncidents((prev) => [newIncident, ...prev]);
  };

  const handleAdvanceStatus = (incidentId) => {
    setIncidents((prev) =>
      prev.map((incident) => {
        if (incident.id !== incidentId) {
          return incident;
        }

        const currentIndex = STATUS_FLOW.indexOf(incident.status);
        const nextIndex = Math.min(currentIndex + 1, STATUS_FLOW.length - 1);

        return {
          ...incident,
          status: STATUS_FLOW[nextIndex],
        };
      })
    );
  };

  return (
    <main className="page">
      <h1>MVP de Reporte de Incidencias</h1>
      <p className="description">
        Registra incidencias y simula su avance de estado con un flujo simple.
      </p>

      <div className="layout">
        <section className="card">
          <h2>Nueva incidencia</h2>
          <IncidentForm onSubmit={handleCreateIncident} />
        </section>

        <section className="card">
          <h2>Panel de estado</h2>
          <IncidentPanel
            incidents={incidents}
            onAdvanceStatus={handleAdvanceStatus}
          />
        </section>
      </div>
    </main>
  );
}

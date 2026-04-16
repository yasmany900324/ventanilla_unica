"use client";

import { useEffect, useState } from "react";
import IncidentForm from "../components/IncidentForm";
import IncidentPanel from "../components/IncidentPanel";

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
          throw new Error(data.error || "No se pudieron cargar las incidencias.");
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
      const message = data.error || "No se pudo registrar la incidencia.";
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

      {isLoading && <p className="info-message">Cargando incidencias...</p>}
      {!isLoading && incidents.length === 0 && (
        <p className="info-message">
          Todavía no hay incidencias guardadas. Crea una para comenzar.
        </p>
      )}
      {errorMessage && <p className="error-message">{errorMessage}</p>}
    </main>
  );
}

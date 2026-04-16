"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import IncidentForm from "./IncidentForm";
import IncidentListItem from "./IncidentListItem";
import IncidentCaseDetail from "./IncidentCaseDetail";
import { useAuth } from "./AuthProvider";
import {
  getIncidentCreationValue,
  getIncidentRecencyValue,
} from "../lib/incidentDisplay";

export default function CitizenDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshSession } = useAuth();
  const requestedIncidentId = searchParams.get("incidentId");
  const [incidents, setIncidents] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadIncidents = async () => {
      try {
        const sessionUser = await refreshSession({ silent: true });
        if (!sessionUser) {
          router.replace("/login");
          return;
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info("[auth] Dashboard synchronized with refreshed session.");

        const response = await fetch("/api/incidents");
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(data.error || "No se pudieron cargar las incidencias.");
        }

        const loadedIncidents = data.incidents ?? [];
        setIncidents(loadedIncidents);
        if (loadedIncidents.length > 0) {
          const requestedIncident = loadedIncidents.find(
            (incident) => incident.id === requestedIncidentId
          );
          const mostRecentIncident = [...loadedIncidents].sort(
            (firstIncident, secondIncident) =>
              getIncidentRecencyValue(secondIncident) -
              getIncidentRecencyValue(firstIncident)
          )[0];
          setSelectedIncidentId(
            requestedIncident?.id || mostRecentIncident?.id || loadedIncidents[0].id
          );
        }
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadIncidents();
  }, [requestedIncidentId, refreshSession, router]);

  const recentIncidents = useMemo(() => {
    return [...incidents]
      .sort(
        (firstIncident, secondIncident) =>
          getIncidentCreationValue(secondIncident) -
          getIncidentCreationValue(firstIncident)
      )
      .slice(0, 6);
  }, [incidents]);

  const selectedIncident = useMemo(() => {
    if (!incidents.length) {
      return null;
    }

    return (
      incidents.find((incident) => incident.id === selectedIncidentId) ??
      recentIncidents[0] ??
      incidents[0]
    );
  }, [incidents, recentIncidents, selectedIncidentId]);

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
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const message = data.error || "No se pudo registrar la incidencia.";
      setErrorMessage(message);
      throw new Error(message);
    }

    setIncidents((previousIncidents) => [data.incident, ...previousIncidents]);
    setSelectedIncidentId(data.incident.id);
  };

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">Espacio privado ciudadano</p>
          <h1>
            Hola, {user?.fullName || "ciudadano"}
          </h1>
          <p className="description">
            Gestiona tus incidencias, revisa sus estados y consulta el detalle
            de seguimiento en un mismo panel.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="#nueva-incidencia" className="button-link">
            Nueva incidencia
          </Link>
        </div>
      </section>

      <section className="summary-grid" aria-label="Resumen de incidencias">
        <article className="card summary-card">
          <p className="summary-card__label">Total de incidencias</p>
          <p className="summary-card__value">{summary.total}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">Recibidas</p>
          <p className="summary-card__value">{summary.recibido}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">En revision</p>
          <p className="summary-card__value">{summary.enRevision}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">En proceso</p>
          <p className="summary-card__value">{summary.enProceso}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">Resueltas</p>
          <p className="summary-card__value">{summary.resuelto}</p>
        </article>
      </section>

      <section id="nueva-incidencia" className="card dashboard-section">
        <h2>Registrar nueva incidencia</h2>
        <p className="small">
          Completa los datos del caso para iniciar su atencion institucional.
        </p>
        <IncidentForm
          onSubmit={handleCreateIncident}
          submitLabel="Registrar incidencia"
        />
      </section>

      <section id="mis-incidencias-recientes" className="card recent-incidents-card">
        <h2>Mis incidencias recientes</h2>
        <p className="small">
          Consulta tus casos mas recientes y selecciona uno para ver su detalle.
        </p>
        {isLoading ? <p className="info-message">Cargando incidencias...</p> : null}
        {!isLoading && incidents.length === 0 ? (
          <p className="empty-message">
            Aun no tienes incidencias registradas en tu espacio ciudadano.
          </p>
        ) : null}
        {recentIncidents.length > 0 ? (
          <ul
            className="incident-carousel"
            aria-label="Carrusel de incidencias recientes"
          >
            {recentIncidents.map((incident) => {
              const isSelected = selectedIncident?.id === incident.id;

              return (
                <IncidentListItem
                  key={incident.id}
                  incident={incident}
                  className={`incident-card--carousel${
                    isSelected ? " incident-card--selected" : ""
                  }`}
                  isSelected={isSelected}
                  onSelect={setSelectedIncidentId}
                  actionLabel="Ver detalle"
                />
              );
            })}
          </ul>
        ) : null}
        <div className="recent-incidents-footer">
          <Link href="/mis-incidencias" className="button-link button-link--secondary">
            Ver todas mis incidencias
          </Link>
        </div>
      </section>

      <section id="detalle-caso" className="card case-detail-card">
        <IncidentCaseDetail incident={selectedIncident} />
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

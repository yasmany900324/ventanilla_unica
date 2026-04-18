"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import IncidentListItem from "./IncidentListItem";
import IncidentCaseDetail from "./IncidentCaseDetail";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import {
  getIncidentCreationValue,
  getIncidentRecencyValue,
} from "../lib/incidentDisplay";

export default function CitizenDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshSession } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const dashboardCopy = copy.dashboard;
  const assistantHref = "/asistente";
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
        console.info(dashboardCopy.authTraceLog);

        const response = await fetch("/api/incidents");
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(data.error || dashboardCopy.loadIncidentsError);
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
  }, [dashboardCopy.authTraceLog, dashboardCopy.loadIncidentsError, requestedIncidentId, refreshSession, router]);

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

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">{dashboardCopy.privateSpaceEyebrow}</p>
          <h1>
            {dashboardCopy.hello}, {user?.fullName || dashboardCopy.greetingFallback}
          </h1>
          <p className="description">{dashboardCopy.description}</p>
        </div>
        <div className="hero-actions">
          <Link href={assistantHref} className="button-link">
            {dashboardCopy.newIncident}
          </Link>
        </div>
      </section>

      <section className="summary-grid" aria-label={dashboardCopy.summaryLabel}>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.totalIncidents}</p>
          <p className="summary-card__value">{summary.total}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.received}</p>
          <p className="summary-card__value">{summary.recibido}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.inReview}</p>
          <p className="summary-card__value">{summary.enRevision}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.inProgress}</p>
          <p className="summary-card__value">{summary.enProceso}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.resolved}</p>
          <p className="summary-card__value">{summary.resuelto}</p>
        </article>
      </section>

      <section id="nueva-incidencia" className="card dashboard-section">
        <h2>{dashboardCopy.registerIncidentTitle}</h2>
        <p className="small">{dashboardCopy.registerIncidentDescription}</p>
        <div className="hero-actions">
          <Link href={assistantHref} className="button-link">
            {dashboardCopy.submitIncident}
          </Link>
          <Link href={assistantHref} className="button-link button-link--secondary">
            {copy.home.assistantCta}
          </Link>
        </div>
      </section>

      <section id="mis-incidencias-recientes" className="card recent-incidents-card">
        <h2>{dashboardCopy.recentIncidentsTitle}</h2>
        <p className="small">{dashboardCopy.recentIncidentsDescription}</p>
        {isLoading ? <p className="info-message">{dashboardCopy.loadingIncidents}</p> : null}
        {!isLoading && incidents.length === 0 ? (
          <p className="empty-message">{dashboardCopy.emptyRecentIncidents}</p>
        ) : null}
        {recentIncidents.length > 0 ? (
          <ul
            className="incident-carousel"
            aria-label={dashboardCopy.recentCarouselLabel}
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
                  actionLabel={copy.myIncidents.actionViewDetail}
                />
              );
            })}
          </ul>
        ) : null}
        <div className="recent-incidents-footer">
          <Link href="/mis-incidencias" className="button-link button-link--secondary">
            {dashboardCopy.goToAllIncidents}
          </Link>
        </div>
      </section>

      <section id="detalle-caso" className="card case-detail-card">
        <IncidentCaseDetail
          incident={selectedIncident}
          title={dashboardCopy.detailTitle}
          description={dashboardCopy.detailDescription}
          emptyStateMessage={dashboardCopy.emptyDetail}
        />
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

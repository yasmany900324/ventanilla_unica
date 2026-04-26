"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const TERMINAL_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function formatStatusLabel(status, statusLabels = {}) {
  const normalized = String(status || "").trim().toUpperCase();
  if (statusLabels[normalized]) {
    return statusLabels[normalized];
  }
  return normalized || "Sin estado";
}

function formatDateTime(value, locale = "es") {
  if (!value) {
    return "Sin fecha";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Sin fecha";
  }
  const localeMap = {
    es: "es-ES",
    en: "en-US",
    pt: "pt-BR",
  };
  return new Intl.DateTimeFormat(localeMap[locale] || "es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default function CitizenDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshSession } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const dashboardCopy = copy.dashboard;
  const statusLabels = dashboardCopy.procedureStatusLabels || {};
  const assistantHref = "/asistente";
  const requestedProcedureId = searchParams.get("procedureId") || searchParams.get("incidentId");
  const [procedures, setProcedures] = useState([]);
  const [selectedProcedureId, setSelectedProcedureId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadProcedures = async () => {
      try {
        const sessionUser = await refreshSession({ silent: true });
        if (!sessionUser) {
          router.replace("/login");
          return;
        }

        // Temporary trace log while validating auth synchronization flow.
        console.info(dashboardCopy.authTraceLog);

        const response = await fetch("/api/ciudadano/procedures/requests?limit=50");
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(data.error || dashboardCopy.loadIncidentsError);
        }

        const loadedProcedures = data.procedures ?? [];
        setProcedures(loadedProcedures);
        if (loadedProcedures.length > 0) {
          const requestedProcedure = loadedProcedures.find(
            (procedureRequest) => procedureRequest.id === requestedProcedureId
          );
          setSelectedProcedureId(
            requestedProcedure?.id || loadedProcedures[0].id
          );
        }
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadProcedures();
  }, [dashboardCopy.authTraceLog, requestedProcedureId, refreshSession, router]);

  const recentProcedures = useMemo(() => procedures.slice(0, 6), [procedures]);

  const selectedProcedure = useMemo(() => {
    if (!procedures.length) {
      return null;
    }
    return (
      procedures.find((procedureRequest) => procedureRequest.id === selectedProcedureId) ??
      recentProcedures[0] ??
      procedures[0]
    );
  }, [procedures, recentProcedures, selectedProcedureId]);

  const summary = useMemo(() => {
    const initialSummary = {
      total: procedures.length,
      abiertos: 0,
      enCurso: 0,
      esperandoDatos: 0,
      cerrados: 0,
    };

    procedures.forEach((procedureRequest) => {
      const status = String(procedureRequest.status || "").trim().toUpperCase();
      if (TERMINAL_STATUSES.has(status)) {
        initialSummary.cerrados += 1;
      } else {
        initialSummary.abiertos += 1;
      }
      if (status === "IN_PROGRESS" || status === "PENDING_BACKOFFICE_ACTION") {
        initialSummary.enCurso += 1;
      }
      if (status === "WAITING_CITIZEN_INFO") {
        initialSummary.esperandoDatos += 1;
      }
    });

    return initialSummary;
  }, [procedures]);

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
          <p className="summary-card__value">{summary.abiertos}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.inProgress}</p>
          <p className="summary-card__value">{summary.enCurso}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.inReview}</p>
          <p className="summary-card__value">{summary.esperandoDatos}</p>
        </article>
        <article className="card summary-card">
          <p className="summary-card__label">{dashboardCopy.resolved}</p>
          <p className="summary-card__value">{summary.cerrados}</p>
        </article>
      </section>

      <section className="card recent-incidents-card">
        <h2>{dashboardCopy.recentIncidentsTitle}</h2>
        <p className="small">{dashboardCopy.recentIncidentsDescription}</p>
        {isLoading ? <p className="info-message">{dashboardCopy.loadingIncidents}</p> : null}
        {!isLoading && procedures.length === 0 ? (
          <p className="empty-message">{dashboardCopy.emptyRecentIncidents}</p>
        ) : null}
        {recentProcedures.length > 0 ? (
          <ul className="incident-carousel" aria-label={dashboardCopy.recentCarouselLabel}>
            {recentProcedures.map((procedureRequest) => (
              <li
                key={procedureRequest.id}
                className={`incident-card incident-card--carousel${
                  selectedProcedure?.id === procedureRequest.id ? " incident-card--selected" : ""
                }`}
              >
                <div className="incident-card__header">
                  <h3>{procedureRequest.procedureName || "Tramite sin nombre"}</h3>
                  <span className="badge">
                    {formatStatusLabel(procedureRequest.status, statusLabels)}
                  </span>
                </div>
                <p className="small">
                  <strong>Codigo:</strong> {procedureRequest.requestCode || procedureRequest.id}
                </p>
                <p className="small">
                  <strong>Canal:</strong> {procedureRequest.channel || "WEB"}
                </p>
                <p className="small">
                  <strong>Actualizado:</strong>{" "}
                  {formatDateTime(procedureRequest.updatedAt || procedureRequest.createdAt, locale)}
                </p>
                <button
                  type="button"
                  className="button-inline"
                  onClick={() => setSelectedProcedureId(procedureRequest.id)}
                >
                  {copy.myIncidents.actionViewDetail}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="recent-incidents-footer">
          <Link href="/asistente" className="button-link button-link--secondary">
            {dashboardCopy.openAssistant}
          </Link>
        </div>
      </section>

      <section id="detalle-caso" className="card case-detail-card">
        <h2>{dashboardCopy.detailTitle}</h2>
        {!selectedProcedure ? (
          <p className="empty-message">{dashboardCopy.emptyDetail}</p>
        ) : (
          <>
            <p className="small">
              <strong>Codigo:</strong> {selectedProcedure.requestCode || selectedProcedure.id}
            </p>
            <p className="small">
              <strong>Tipo:</strong> {selectedProcedure.procedureName || "Sin nombre"}
            </p>
            <p className="small">
              <strong>Estado:</strong> {formatStatusLabel(selectedProcedure.status, statusLabels)}
            </p>
            <p className="small">
              <strong>Canal:</strong> {selectedProcedure.channel || "WEB"}
            </p>
            <p className="small">
              <strong>Creado:</strong> {formatDateTime(selectedProcedure.createdAt, locale)}
            </p>
            <p className="small">
              <strong>Ultima actualizacion:</strong>{" "}
              {formatDateTime(selectedProcedure.updatedAt, locale)}
            </p>
            <p className="small">
              <strong>Resumen:</strong> {selectedProcedure.summary || "Sin resumen disponible."}
            </p>
          </>
        )}
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import {
  DashboardIcon,
  TERMINAL_STATUSES,
  formatDateTime,
  getDashboardLocaleContent,
  StatusBadge,
} from "./citizenProcedureUi";

function MetricCard({ icon, label, value }) {
  return (
    <article className="dashboard-onify-metric-card">
      <span className="dashboard-onify-metric-card__icon" aria-hidden="true">
        <DashboardIcon name={icon} />
      </span>
      <div>
        <p className="dashboard-onify-metric-card__label">{label}</p>
        <p className="dashboard-onify-metric-card__value">{value}</p>
      </div>
    </article>
  );
}

export default function CitizenDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, refreshSession } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const dashboardCopy = copy.dashboard;
  const localeText = getDashboardLocaleContent(locale);
  const statusLabels = dashboardCopy.procedureStatusLabels || {};
  const requestedProcedureId = searchParams.get("procedureId") || searchParams.get("incidentId");
  const [procedures, setProcedures] = useState([]);
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

        if (requestedProcedureId && loadedProcedures.some((p) => p.id === requestedProcedureId)) {
          router.replace(`/ciudadano/dashboard/${requestedProcedureId}`);
        }
      } catch (error) {
        setErrorMessage(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadProcedures();
  }, [dashboardCopy.authTraceLog, dashboardCopy.loadIncidentsError, refreshSession, requestedProcedureId, router]);

  const recentProcedures = useMemo(() => procedures.slice(0, 6), [procedures]);

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

  const metricCards = useMemo(
    () => [
      { key: "total", icon: "total", label: dashboardCopy.totalIncidents, value: summary.total },
      { key: "abiertos", icon: "open", label: dashboardCopy.received, value: summary.abiertos },
      { key: "enCurso", icon: "progress", label: dashboardCopy.inProgress, value: summary.enCurso },
      {
        key: "esperando",
        icon: "waiting",
        label: dashboardCopy.inReview,
        value: summary.esperandoDatos,
      },
      { key: "cerrados", icon: "closed", label: dashboardCopy.resolved, value: summary.cerrados },
    ],
    [
      dashboardCopy.inProgress,
      dashboardCopy.inReview,
      dashboardCopy.received,
      dashboardCopy.resolved,
      dashboardCopy.totalIncidents,
      summary.abiertos,
      summary.cerrados,
      summary.enCurso,
      summary.esperandoDatos,
      summary.total,
    ]
  );

  return (
    <main className="page page--dashboard dashboard-onify">
      <section className="dashboard-onify-card dashboard-onify-hero" aria-labelledby="dashboard-main-title">
        <div className="dashboard-onify-hero__content">
          <p className="dashboard-onify-hero__eyebrow">{dashboardCopy.privateSpaceEyebrow}</p>
          <h1 id="dashboard-main-title">
            {dashboardCopy.hello}, {user?.fullName || dashboardCopy.greetingFallback}
          </h1>
          <p>{dashboardCopy.description}</p>
        </div>
      </section>

      <section className="dashboard-onify-metrics" aria-label={dashboardCopy.summaryLabel}>
        {metricCards.map((metric) => (
          <MetricCard key={metric.key} icon={metric.icon} label={metric.label} value={metric.value} />
        ))}
      </section>

      <section className="dashboard-onify-card dashboard-onify-section" aria-labelledby="dashboard-recent-title">
        <header className="dashboard-onify-section__head">
          <div>
            <h2 id="dashboard-recent-title">{dashboardCopy.recentIncidentsTitle}</h2>
            <p>{dashboardCopy.recentIncidentsDescription}</p>
          </div>
          <Link href="/asistente" className="home-onify-btn home-onify-btn--secondary dashboard-onify-btn">
            <span className="dashboard-onify-btn__icon" aria-hidden="true">
              <DashboardIcon name="chat" />
            </span>
            {dashboardCopy.openAssistant}
          </Link>
        </header>

        {isLoading ? <p className="info-message">{dashboardCopy.loadingIncidents}</p> : null}
        {!isLoading && procedures.length === 0 ? (
          <p className="dashboard-onify-empty">{dashboardCopy.emptyRecentIncidents}</p>
        ) : null}

        {!isLoading && procedures.length > 0 ? (
          <p className="dashboard-onify-list-hint">{localeText.listHint}</p>
        ) : null}

        {recentProcedures.length > 0 ? (
          <ul className="dashboard-onify-procedure-list" aria-label={dashboardCopy.recentCarouselLabel}>
            {recentProcedures.map((procedureRequest) => (
              <li key={procedureRequest.id} className="dashboard-onify-procedure-card">
                <div className="dashboard-onify-procedure-card__header">
                  <h3>{procedureRequest.procedureName || localeText.unnamedProcedure}</h3>
                  <StatusBadge
                    status={procedureRequest.status}
                    statusLabels={statusLabels}
                    localeText={localeText}
                  />
                </div>

                <ul className="dashboard-onify-meta-list">
                  <li>
                    <span aria-hidden="true">
                      <DashboardIcon name="code" />
                    </span>
                    <span>
                      <strong>{localeText.codeLabel}:</strong>{" "}
                      {procedureRequest.requestCode || procedureRequest.id || localeText.unknownCode}
                    </span>
                  </li>
                  <li>
                    <span aria-hidden="true">
                      <DashboardIcon name="channel" />
                    </span>
                    <span>
                      <strong>{localeText.channelLabel}:</strong>{" "}
                      {procedureRequest.channel || localeText.unknownChannel}
                    </span>
                  </li>
                  <li>
                    <span aria-hidden="true">
                      <DashboardIcon name="updated" />
                    </span>
                    <span>
                      <strong>{localeText.updatedAtLabel}:</strong>{" "}
                      {formatDateTime(procedureRequest.updatedAt || procedureRequest.createdAt, locale)}
                    </span>
                  </li>
                </ul>

                <Link
                  href={`/ciudadano/dashboard/${procedureRequest.id}`}
                  className="dashboard-onify-detail-btn"
                  aria-label={localeText.recentActionAria}
                >
                  {copy.myIncidents.actionViewDetail}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const WINDOW_DAY_OPTIONS = [7, 14, 30];

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function MetricCard({ label, value }) {
  return (
    <article className="card summary-card">
      <p className="summary-card__label">{label}</p>
      <p className="summary-card__value">{value}</p>
    </article>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const [windowDays, setWindowDays] = useState(7);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [metrics, setMetrics] = useState(null);

  const isAdministrator = user?.role === "administrador";
  const funnel = metrics?.funnel || null;

  useEffect(() => {
    if (user && !isAdministrator) {
      router.replace("/");
    }
  }, [isAdministrator, router, user]);

  useEffect(() => {
    if (!user || !isAdministrator) {
      return;
    }

    const abortController = new AbortController();
    const loadMetrics = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch(`/api/chatbot/metrics?windowDays=${windowDays}`, {
          signal: abortController.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 403) {
            router.replace("/");
            return;
          }

          throw new Error(data?.error || "No se pudieron cargar metricas.");
        }

        setMetrics(data);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setErrorMessage(error.message || "No se pudieron cargar metricas.");
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadMetrics();
    return () => {
      abortController.abort();
    };
  }, [isAdministrator, router, user, windowDays]);

  const orderedEventCounts = useMemo(() => {
    const counts = metrics?.eventCounts || {};
    return Object.entries(counts).sort((firstEntry, secondEntry) => secondEntry[1] - firstEntry[1]);
  }, [metrics?.eventCounts]);

  if (user && !isAdministrator) {
    return null;
  }

  return (
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">{copy.portal.adminDashboard}</p>
          <h1>Embudo conversacional del chatbot</h1>
          <p className="description">
            Metricas agregadas del flujo de incidencias para monitorear conversion y friccion.
          </p>
        </div>
      </section>

      <section className="card dashboard-section">
        <label htmlFor="admin-window-days">Ventana de analisis</label>
        <select
          id="admin-window-days"
          value={windowDays}
          onChange={(event) => setWindowDays(Number.parseInt(event.target.value, 10) || 7)}
          disabled={isLoading}
        >
          {WINDOW_DAY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              Ultimos {option} dias
            </option>
          ))}
        </select>
      </section>

      {isLoading ? (
        <section className="card">
          <p className="info-message">Cargando metricas...</p>
        </section>
      ) : null}

      {!isLoading && errorMessage ? (
        <section className="card">
          <p className="error-message">{errorMessage}</p>
        </section>
      ) : null}

      {!isLoading && !errorMessage && funnel ? (
        <>
          <section className="summary-grid" aria-label="Resumen del embudo">
            <MetricCard label="Sesiones en flujo incidencia" value={funnel.enteredIncidentFlow} />
            <MetricCard label="Solicitudes con campo faltante" value={funnel.askedField} />
            <MetricCard label="Listas para confirmar" value={funnel.readyForConfirmation} />
            <MetricCard label="Requieren autenticacion" value={funnel.authRequired} />
            <MetricCard label="Confirmadas por usuario" value={funnel.confirmed} />
            <MetricCard label="Incidencias creadas" value={funnel.incidentCreated} />
            <MetricCard label="Conversion a incidencia" value={formatPercent(funnel.incidentCreationConversion)} />
            <MetricCard label="Borradores cancelados" value={funnel.cancelled} />
          </section>

          <section className="card dashboard-section">
            <h2>Totales de actividad</h2>
            <p className="small">Eventos: {metrics?.totals?.events || 0}</p>
            <p className="small">Sesiones unicas: {metrics?.totals?.uniqueSessions || 0}</p>
          </section>

          <section className="card dashboard-section">
            <h2>Eventos mas frecuentes</h2>
            {orderedEventCounts.length ? (
              <ul className="incident-list incident-list--full" aria-label="Eventos de telemetria">
                {orderedEventCounts.map(([eventName, count]) => (
                  <li key={eventName} className="incident-card incident-card--list">
                    <div className="incident-card__main">
                      <p className="incident-card__meta">{eventName}</p>
                      <p className="incident-card__description">{count} ocurrencias</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-message">No hay eventos en la ventana seleccionada.</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

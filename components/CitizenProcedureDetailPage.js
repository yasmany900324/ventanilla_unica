"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import {
  DashboardIcon,
  DetailField,
  TERMINAL_STATUSES,
  formatDateTime,
  formatStatusLabel,
  getDashboardLocaleContent,
  resolveLocation,
  resolvePhotoData,
  StatusBadge,
} from "./citizenProcedureUi";

function getProcedureDetailLocale(locale = "es") {
  const by = {
    en: {
      descriptionLabel: "Description",
      backToDashboard: "Back to My managements",
      trackingTitle: "Tracking",
      trackingSubtitle: "Approximate progress of your procedure in the institutional flow.",
      stepReceived: "Received",
      stepReceivedDesc: "Your request was registered.",
      stepReview: "Under review",
      stepReviewDesc: "Waiting for information or internal attention.",
      stepProgress: "In progress",
      stepProgressDesc: "The team is working on your case.",
      stepClosed: "Closed",
      stepClosedDesc: "Resolved, rejected or archived.",
      summarySectionTitle: "Summary",
      historyTitle: "History and events",
      historyEmpty: "There is no recorded history for this procedure yet.",
      eventType: "Event",
      eventStatus: "Status change",
      loadError: "Could not load this procedure.",
      notFound: "Procedure not found.",
      actionsTitle: "Available actions",
      consultStatus: "Check status (list)",
      continueInfo: "Continue or provide information",
      backToList: "Back to list",
      currentStatusLine: "Current status",
    },
    pt: {
      descriptionLabel: "Descricao",
      backToDashboard: "Voltar para Minhas gestoes",
      trackingTitle: "Acompanhamento",
      trackingSubtitle: "Progresso aproximado do seu tramite no fluxo institucional.",
      stepReceived: "Recebido",
      stepReceivedDesc: "Sua solicitacao foi registrada.",
      stepReview: "Em revisao",
      stepReviewDesc: "Aguardando informacao ou atencao interna.",
      stepProgress: "Em andamento",
      stepProgressDesc: "A equipe esta trabalhando no caso.",
      stepClosed: "Encerrado",
      stepClosedDesc: "Resolvido, rejeitado ou arquivado.",
      summarySectionTitle: "Resumo",
      historyTitle: "Historico e eventos",
      historyEmpty: "Ainda nao ha historico registrado para este tramite.",
      eventType: "Evento",
      eventStatus: "Mudanca de estado",
      loadError: "Nao foi possivel carregar este tramite.",
      notFound: "Tramite nao encontrado.",
      actionsTitle: "Acoes disponiveis",
      consultStatus: "Consultar estado (lista)",
      continueInfo: "Continuar ou enviar informacao",
      backToList: "Voltar ao listado",
      currentStatusLine: "Estado atual",
    },
    es: {
      descriptionLabel: "Descripcion",
      backToDashboard: "Volver a Mis gestiones",
      trackingTitle: "Seguimiento",
      trackingSubtitle: "Progreso aproximado de tu tramite en el flujo institucional.",
      stepReceived: "Recibido",
      stepReceivedDesc: "Tu solicitud fue registrada.",
      stepReview: "En revision",
      stepReviewDesc: "Esperando informacion o atencion interna.",
      stepProgress: "En curso",
      stepProgressDesc: "El equipo esta trabajando en tu caso.",
      stepClosed: "Cerrado",
      stepClosedDesc: "Resuelto, rechazado o archivado.",
      summarySectionTitle: "Resumen",
      historyTitle: "Historial y eventos",
      historyEmpty: "Todavia no hay historial registrado para este tramite.",
      eventType: "Evento",
      eventStatus: "Cambio de estado",
      loadError: "No se pudo cargar este tramite.",
      notFound: "Tramite no encontrado.",
      actionsTitle: "Acciones disponibles",
      consultStatus: "Consultar estado (listado)",
      continueInfo: "Continuar o aportar informacion",
      backToList: "Volver al listado",
      currentStatusLine: "Estado actual",
    },
  };
  return by[locale] || by.es;
}

function getProcedureTrackingStepIndex(status) {
  const s = String(status || "").trim().toUpperCase();
  if (TERMINAL_STATUSES.has(s)) {
    return 3;
  }
  if (s === "IN_PROGRESS") {
    return 2;
  }
  if (s === "WAITING_CITIZEN_INFO" || s === "PENDING_BACKOFFICE_ACTION") {
    return 1;
  }
  return 0;
}

function humanizeEventType(type) {
  const t = String(type || "").trim();
  if (!t) return "—";
  return t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function CitizenProcedureDetailPage() {
  const params = useParams();
  const router = useRouter();
  const procedureId = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";

  const { refreshSession } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const dashboardCopy = copy.dashboard;
  const localeText = getDashboardLocaleContent(locale);
  const detailLocale = getProcedureDetailLocale(locale);
  const statusLabels = dashboardCopy.procedureStatusLabels || {};

  const [procedure, setProcedure] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const sessionUser = await refreshSession({ silent: true });
        if (!sessionUser) {
          router.replace("/login");
          return;
        }
        if (!procedureId) {
          setErrorMessage(detailLocale.notFound);
          return;
        }
        const response = await fetch(`/api/ciudadano/procedures/requests/${encodeURIComponent(procedureId)}`);
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }
          throw new Error(data.error || detailLocale.loadError);
        }
        if (cancelled) return;
        setProcedure(data.procedure || null);
        setHistory(Array.isArray(data.history) ? data.history : []);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error.message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [detailLocale.loadError, detailLocale.notFound, procedureId, refreshSession, router]);

  const locationText = useMemo(
    () => resolveLocation(procedure, localeText.unknownLocation),
    [localeText.unknownLocation, procedure]
  );
  const photo = useMemo(() => resolvePhotoData(procedure), [procedure]);

  const trackingSteps = useMemo(
    () => [
      { label: detailLocale.stepReceived, description: detailLocale.stepReceivedDesc },
      { label: detailLocale.stepReview, description: detailLocale.stepReviewDesc },
      { label: detailLocale.stepProgress, description: detailLocale.stepProgressDesc },
      { label: detailLocale.stepClosed, description: detailLocale.stepClosedDesc },
    ],
    [
      detailLocale.stepClosed,
      detailLocale.stepClosedDesc,
      detailLocale.stepProgress,
      detailLocale.stepProgressDesc,
      detailLocale.stepReceived,
      detailLocale.stepReceivedDesc,
      detailLocale.stepReview,
      detailLocale.stepReviewDesc,
    ]
  );

  const currentStepIndex = useMemo(() => getProcedureTrackingStepIndex(procedure?.status), [procedure?.status]);

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return tb - ta;
    });
  }, [history]);

  const showContinueInfo = String(procedure?.status || "").trim().toUpperCase() === "WAITING_CITIZEN_INFO";

  return (
    <main className="page page--dashboard dashboard-onify citizen-detail-page">
      <nav className="citizen-detail-page__nav" aria-label={detailLocale.backToDashboard}>
        <Link href="/ciudadano/dashboard" className="citizen-detail-page__back">
          <span className="citizen-detail-page__back-icon" aria-hidden="true">
            <DashboardIcon name="arrowLeft" />
          </span>
          {detailLocale.backToDashboard}
        </Link>
      </nav>

      {isLoading ? <p className="info-message">{dashboardCopy.loadingIncidents}</p> : null}

      {!isLoading && errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      {!isLoading && !errorMessage && !procedure ? <p className="dashboard-onify-empty">{detailLocale.notFound}</p> : null}

      {procedure ? (
        <>
          <section className="dashboard-onify-card dashboard-onify-section citizen-detail-page__hero" aria-labelledby="procedure-detail-title">
            <div className="citizen-detail-page__hero-head">
              <div>
                <p className="dashboard-onify-hero__eyebrow">{dashboardCopy.privateSpaceEyebrow}</p>
                <h1 id="procedure-detail-title">{procedure.procedureName || localeText.unnamedProcedure}</h1>
                <p className="citizen-detail-page__hero-meta-line">
                  <span>
                    <strong>{localeText.codeLabel}:</strong> {procedure.requestCode || procedure.id || localeText.unknownCode}
                  </span>
                  <span className="citizen-detail-page__hero-meta-sep" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    <strong>{localeText.channelLabel}:</strong> {procedure.channel || localeText.unknownChannel}
                  </span>
                </p>
              </div>
              <StatusBadge status={procedure.status} statusLabels={statusLabels} localeText={localeText} />
            </div>
            <ul className="citizen-detail-page__hero-grid">
              <li>
                <span className="citizen-detail-page__hero-grid-icon" aria-hidden="true">
                  <DashboardIcon name="created" />
                </span>
                <span className="citizen-detail-page__hero-grid-label">{localeText.createdAtLabel}</span>
                <span className="citizen-detail-page__hero-grid-value">{formatDateTime(procedure.createdAt, locale)}</span>
              </li>
              <li>
                <span className="citizen-detail-page__hero-grid-icon" aria-hidden="true">
                  <DashboardIcon name="updated" />
                </span>
                <span className="citizen-detail-page__hero-grid-label">{localeText.updatedAtLabel}</span>
                <span className="citizen-detail-page__hero-grid-value">{formatDateTime(procedure.updatedAt, locale)}</span>
              </li>
            </ul>
          </section>

          <section className="dashboard-onify-card dashboard-onify-section" aria-labelledby="procedure-summary-title">
            <header className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
              <h2 id="procedure-summary-title">{detailLocale.summarySectionTitle}</h2>
            </header>
            <div className="citizen-detail-page__summary-grid">
              <DetailField
                icon="summary"
                label={detailLocale.descriptionLabel}
                value={procedure.summary || localeText.noSummary}
              />
              <DetailField icon="location" label={localeText.locationLabel} value={locationText} />
            </div>
            {photo.hasPhoto ? (
              <div className="dashboard-onify-summary-media citizen-detail-page__summary-media">
                {photo.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external blob URLs; avoid next/image domain config here
                  <img src={photo.url} alt={localeText.summaryImageAlt} loading="lazy" />
                ) : (
                  <div className="dashboard-onify-summary-media__placeholder" aria-hidden="true">
                    <DashboardIcon name="file" />
                  </div>
                )}
                {photo.fileName ? (
                  <div className="dashboard-onify-summary-media__caption">
                    <span aria-hidden="true">
                      <DashboardIcon name="file" />
                    </span>
                    <span>
                      <strong>{localeText.photoReferenceLabel}:</strong> {photo.fileName}
                    </span>
                  </div>
                ) : null}
                {photo.caption ? <p className="dashboard-onify-summary-media__note">{photo.caption}</p> : null}
              </div>
            ) : (
              <p className="dashboard-onify-summary-card__empty">{localeText.noPhotoLabel}</p>
            )}
          </section>

          <section className="dashboard-onify-card dashboard-onify-section" aria-labelledby="procedure-tracking-title">
            <header className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
              <h2 id="procedure-tracking-title">{detailLocale.trackingTitle}</h2>
              <p>{detailLocale.trackingSubtitle}</p>
            </header>
            <p className="citizen-detail-page__current-status">
              <strong>{detailLocale.currentStatusLine}:</strong>{" "}
              <StatusBadge status={procedure.status} statusLabels={statusLabels} localeText={localeText} />
            </p>
            <ol className="citizen-detail-timeline" aria-label={detailLocale.trackingTitle}>
              {trackingSteps.map((step, index) => {
                const stateClass =
                  index < currentStepIndex
                    ? "citizen-detail-timeline__step--done"
                    : index === currentStepIndex
                      ? "citizen-detail-timeline__step--current"
                      : "citizen-detail-timeline__step--pending";
                return (
                  <li key={step.label} className={`citizen-detail-timeline__step ${stateClass}`}>
                    <span className="citizen-detail-timeline__marker" aria-hidden="true">
                      {index < currentStepIndex ? "✓" : index + 1}
                    </span>
                    <div>
                      <h3>{step.label}</h3>
                      <p>{step.description}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="dashboard-onify-card dashboard-onify-section" aria-labelledby="procedure-history-title">
            <header className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
              <h2 id="procedure-history-title">
                <span className="citizen-detail-page__section-icon" aria-hidden="true">
                  <DashboardIcon name="history" />
                </span>
                {detailLocale.historyTitle}
              </h2>
            </header>
            {sortedHistory.length === 0 ? (
              <p className="dashboard-onify-empty">{detailLocale.historyEmpty}</p>
            ) : (
              <ul className="citizen-detail-history">
                {sortedHistory.map((event) => (
                  <li key={event.id} className="citizen-detail-history__item">
                    <div className="citizen-detail-history__head">
                      <span className="citizen-detail-history__type">{humanizeEventType(event.type)}</span>
                      <time className="citizen-detail-history__time" dateTime={event.createdAt || undefined}>
                        {formatDateTime(event.createdAt, locale)}
                      </time>
                    </div>
                    {event.newStatus ? (
                      <p className="citizen-detail-history__meta">
                        {detailLocale.eventStatus}: {formatStatusLabel(event.newStatus, statusLabels)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dashboard-onify-card dashboard-onify-section citizen-detail-page__actions" aria-labelledby="procedure-actions-title">
            <h2 id="procedure-actions-title">{detailLocale.actionsTitle}</h2>
            <div className="citizen-detail-page__action-buttons">
              <Link href="/ciudadano/dashboard" className="home-onify-btn home-onify-btn--secondary dashboard-onify-btn">
                {detailLocale.consultStatus}
              </Link>
              {showContinueInfo ? (
                <Link href="/asistente" className="home-onify-btn home-onify-btn--primary dashboard-onify-btn">
                  <span className="dashboard-onify-btn__icon" aria-hidden="true">
                    <DashboardIcon name="chat" />
                  </span>
                  {detailLocale.continueInfo}
                </Link>
              ) : null}
              <Link href="/ciudadano/dashboard" className="citizen-detail-page__ghost-link">
                {detailLocale.backToList}
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}

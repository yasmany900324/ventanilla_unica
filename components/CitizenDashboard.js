"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const TERMINAL_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);
const STATUS_TONE_BY_CODE = {
  DRAFT: "received",
  PENDING_CONFIRMATION: "received",
  PENDING_CAMUNDA_SYNC: "received",
  WAITING_CITIZEN_INFO: "waiting",
  PENDING_BACKOFFICE_ACTION: "review",
  IN_PROGRESS: "progress",
  ERROR_CAMUNDA_SYNC: "warning",
  RESOLVED: "resolved",
  REJECTED: "resolved",
  CLOSED: "resolved",
  ARCHIVED: "resolved",
};

function getDashboardLocaleContent(locale = "es") {
  const contentByLocale = {
    en: {
      unnamedProcedure: "Citizen procedure",
      unknownCode: "No code",
      unknownChannel: "WEB",
      unknownLocation: "No location",
      noSummary: "No summary available.",
      summaryTitle: "Procedure summary",
      detailSupportText: "Review all key data for the selected procedure.",
      codeLabel: "Code",
      typeLabel: "Type",
      statusLabel: "Status",
      channelLabel: "Channel",
      createdAtLabel: "Created",
      updatedAtLabel: "Last update",
      locationLabel: "Location",
      statusAriaPrefix: "Current status",
      photoReferenceLabel: "Photo reference",
      noPhotoLabel: "No image attached",
      summaryImageAlt: "Image attached to the procedure",
      recentActionAria: "See procedure detail",
      summarySubtext:
        "This block groups the essential context to quickly understand your management progress.",
    },
    pt: {
      unnamedProcedure: "Tramite cidadao",
      unknownCode: "Sem codigo",
      unknownChannel: "WEB",
      unknownLocation: "Sem localizacao",
      noSummary: "Sem resumo disponivel.",
      summaryTitle: "Resumo do tramite",
      detailSupportText: "Revise aqui os dados principais do tramite selecionado.",
      codeLabel: "Codigo",
      typeLabel: "Tipo",
      statusLabel: "Estado",
      channelLabel: "Canal",
      createdAtLabel: "Criado",
      updatedAtLabel: "Ultima atualizacao",
      locationLabel: "Localizacao",
      statusAriaPrefix: "Estado atual",
      photoReferenceLabel: "Referencia da foto",
      noPhotoLabel: "Sem imagem anexada",
      summaryImageAlt: "Imagem anexada ao tramite",
      recentActionAria: "Ver detalhe do tramite",
      summarySubtext:
        "Este bloco resume o contexto essencial para entender rapidamente o andamento da sua gestao.",
    },
    es: {
      unnamedProcedure: "Gestion ciudadana",
      unknownCode: "Sin codigo",
      unknownChannel: "WEB",
      unknownLocation: "Sin ubicacion",
      noSummary: "Sin resumen disponible.",
      summaryTitle: "Resumen del tramite",
      detailSupportText: "Revisa aqui los datos clave del tramite seleccionado.",
      codeLabel: "Codigo",
      typeLabel: "Tipo",
      statusLabel: "Estado",
      channelLabel: "Canal",
      createdAtLabel: "Creado",
      updatedAtLabel: "Ultima actualizacion",
      locationLabel: "Ubicacion",
      statusAriaPrefix: "Estado actual",
      photoReferenceLabel: "Referencia de foto",
      noPhotoLabel: "Sin imagen adjunta",
      summaryImageAlt: "Imagen adjunta al tramite",
      recentActionAria: "Ver detalle del tramite",
      summarySubtext:
        "Este bloque resume el contexto esencial para entender rapidamente el avance de tu gestion.",
    },
  };
  return contentByLocale[locale] || contentByLocale.es;
}

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

function getStatusTone(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return STATUS_TONE_BY_CODE[normalized] || "neutral";
}

function resolveLocation(procedureRequest, fallback = "Sin ubicacion") {
  const collectedData =
    procedureRequest?.collectedData && typeof procedureRequest.collectedData === "object"
      ? procedureRequest.collectedData
      : {};
  const possibleKeys = [
    "location",
    "ubicacion",
    "address",
    "direccion",
    "locationReference",
    "location_reference",
    "locationLabel",
  ];
  for (const key of possibleKeys) {
    const value = collectedData[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function resolvePhotoData(procedureRequest) {
  const collectedData =
    procedureRequest?.collectedData && typeof procedureRequest.collectedData === "object"
      ? procedureRequest.collectedData
      : {};
  const publicUrl =
    typeof collectedData.photoAttachmentPublicUrl === "string"
      ? collectedData.photoAttachmentPublicUrl.trim()
      : "";
  const fileName =
    (typeof collectedData.photoAttachmentOriginalName === "string" &&
      collectedData.photoAttachmentOriginalName.trim()) ||
    (typeof collectedData.photoAttachmentStoredFilename === "string" &&
      collectedData.photoAttachmentStoredFilename.trim()) ||
    "";
  const caption = typeof collectedData.photoCaption === "string" ? collectedData.photoCaption.trim() : "";

  return {
    url: publicUrl,
    fileName,
    caption,
    hasPhoto: Boolean(publicUrl || fileName),
  };
}

function DashboardIcon({ name, className = "" }) {
  const classes = ["dashboard-onify-icon", className].filter(Boolean).join(" ");
  if (name === "total") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "open") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3.5 12.5 12 4l8.5 8.5v6a2 2 0 0 1-2 2h-3.5v-5h-6v5H5.5a2 2 0 0 1-2-2v-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "progress") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 7v5l3.6 2.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "waiting") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 4h10M7 20h10M8.5 4v4.5l2.8 3.5-2.8 3.5V20M15.5 4v4.5l-2.8 3.5 2.8 3.5V20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "closed") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "code") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m8.5 8-3 4 3 4M15.5 8l3 4-3 4M13.5 6l-3 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "channel") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6.5h16v11H9l-5 3V6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "updated") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 12a8 8 0 1 1-2.35-5.65" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M20 5.5V10h-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "type") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 4.5h12v15H6zM9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "status") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="2.7" fill="currentColor" />
      </svg>
    );
  }
  if (name === "created") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="5.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 3.5v4M16 3.5v4M4 10h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "location") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 21s6-5.45 6-10a6 6 0 1 0-12 0c0 4.55 6 10 6 10Z" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="11" r="2.3" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === "summary") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="4.5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
        <path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "file") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 3.5h6l4 4V20a.5.5 0 0 1-.5.5h-9A2.5 2.5 0 0 1 6 18V6a2.5 2.5 0 0 1 2.5-2.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-4.5 3v-3H7a3 3 0 0 1-3-3v-8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M9 10h6M9 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  return null;
}

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

function StatusBadge({ status, statusLabels, localeText }) {
  const label = formatStatusLabel(status, statusLabels);
  const tone = getStatusTone(status);
  return (
    <span
      className={`dashboard-onify-status-badge dashboard-onify-status-badge--${tone}`}
      aria-label={`${localeText.statusAriaPrefix}: ${label}`}
    >
      {label}
    </span>
  );
}

function DetailField({ icon, label, value, children }) {
  return (
    <div className="dashboard-onify-detail-field">
      <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
        <DashboardIcon name={icon} />
      </span>
      <div className="dashboard-onify-detail-field__content">
        <p className="dashboard-onify-detail-field__label">{label}</p>
        {children || <p className="dashboard-onify-detail-field__value">{value}</p>}
      </div>
    </div>
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

  const selectedLocation = useMemo(
    () => resolveLocation(selectedProcedure, localeText.unknownLocation),
    [localeText.unknownLocation, selectedProcedure]
  );
  const selectedPhoto = useMemo(() => resolvePhotoData(selectedProcedure), [selectedProcedure]);

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
    [dashboardCopy.inProgress, dashboardCopy.inReview, dashboardCopy.received, dashboardCopy.resolved, dashboardCopy.totalIncidents, summary.abiertos, summary.cerrados, summary.enCurso, summary.esperandoDatos, summary.total]
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

        {recentProcedures.length > 0 ? (
          <ul className="dashboard-onify-procedure-list" aria-label={dashboardCopy.recentCarouselLabel}>
            {recentProcedures.map((procedureRequest) => (
              <li
                key={procedureRequest.id}
                className={`dashboard-onify-procedure-card${
                  selectedProcedure?.id === procedureRequest.id ? " dashboard-onify-procedure-card--selected" : ""
                }`}
              >
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

                <button
                  type="button"
                  className="dashboard-onify-detail-btn"
                  onClick={() => setSelectedProcedureId(procedureRequest.id)}
                  aria-label={localeText.recentActionAria}
                >
                  {copy.myIncidents.actionViewDetail}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section id="detalle-caso" className="dashboard-onify-card dashboard-onify-section" aria-labelledby="dashboard-detail-title">
        <header className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
          <h2 id="dashboard-detail-title">{dashboardCopy.detailTitle}</h2>
          <p>{localeText.detailSupportText}</p>
        </header>

        {!selectedProcedure ? (
          <p className="dashboard-onify-empty">{dashboardCopy.emptyDetail}</p>
        ) : (
          <div className="dashboard-onify-detail-layout">
            <div className="dashboard-onify-detail-columns">
              <div className="dashboard-onify-detail-group">
                <DetailField
                  icon="code"
                  label={localeText.codeLabel}
                  value={selectedProcedure.requestCode || selectedProcedure.id || localeText.unknownCode}
                />
                <DetailField
                  icon="type"
                  label={localeText.typeLabel}
                  value={selectedProcedure.procedureName || localeText.unnamedProcedure}
                />
                <DetailField icon="status" label={localeText.statusLabel}>
                  <StatusBadge
                    status={selectedProcedure.status}
                    statusLabels={statusLabels}
                    localeText={localeText}
                  />
                </DetailField>
                <DetailField
                  icon="channel"
                  label={localeText.channelLabel}
                  value={selectedProcedure.channel || localeText.unknownChannel}
                />
              </div>

              <div className="dashboard-onify-detail-group">
                <DetailField
                  icon="created"
                  label={localeText.createdAtLabel}
                  value={formatDateTime(selectedProcedure.createdAt, locale)}
                />
                <DetailField
                  icon="updated"
                  label={localeText.updatedAtLabel}
                  value={formatDateTime(selectedProcedure.updatedAt, locale)}
                />
                <DetailField
                  icon="location"
                  label={localeText.locationLabel}
                  value={selectedLocation}
                />
              </div>
            </div>

            <aside className="dashboard-onify-summary-card" aria-label={localeText.summaryTitle}>
              <div className="dashboard-onify-summary-card__head">
                <span aria-hidden="true">
                  <DashboardIcon name="summary" />
                </span>
                <h3>{localeText.summaryTitle}</h3>
              </div>
              <p>{selectedProcedure.summary || localeText.noSummary}</p>
              <p className="dashboard-onify-summary-card__subtext">{localeText.summarySubtext}</p>

              {selectedPhoto.hasPhoto ? (
                <div className="dashboard-onify-summary-media">
                  {selectedPhoto.url ? (
                    <img src={selectedPhoto.url} alt={localeText.summaryImageAlt} loading="lazy" />
                  ) : (
                    <div className="dashboard-onify-summary-media__placeholder" aria-hidden="true">
                      <DashboardIcon name="file" />
                    </div>
                  )}
                  {selectedPhoto.fileName ? (
                    <div className="dashboard-onify-summary-media__caption">
                      <span aria-hidden="true">
                        <DashboardIcon name="file" />
                      </span>
                      <span>
                        <strong>{localeText.photoReferenceLabel}:</strong> {selectedPhoto.fileName}
                      </span>
                    </div>
                  ) : null}
                  {selectedPhoto.caption ? (
                    <p className="dashboard-onify-summary-media__note">{selectedPhoto.caption}</p>
                  ) : null}
                </div>
              ) : (
                <p className="dashboard-onify-summary-card__empty">{localeText.noPhotoLabel}</p>
              )}
            </aside>
          </div>
        )}
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </main>
  );
}

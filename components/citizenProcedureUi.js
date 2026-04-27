import React from "react";

export const TERMINAL_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

export const STATUS_TONE_BY_CODE = {
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

export function getDashboardLocaleContent(locale = "es") {
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
      listHint:
        "Open each procedure with View detail to see full tracking, history and attachments on its own page.",
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
      listHint:
        "Abra cada tramite em Ver detalhe para ver o acompanhamento completo, historico e anexos na pagina dedicada.",
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
      listHint:
        "Abri cada tramite con Ver detalle para ver el seguimiento completo, historial y adjuntos en su pagina dedicada.",
    },
  };
  return contentByLocale[locale] || contentByLocale.es;
}

export function formatStatusLabel(status, statusLabels = {}) {
  const normalized = String(status || "").trim().toUpperCase();
  if (statusLabels[normalized]) {
    return statusLabels[normalized];
  }
  return normalized || "Sin estado";
}

export function formatDateTime(value, locale = "es") {
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

export function getStatusTone(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return STATUS_TONE_BY_CODE[normalized] || "neutral";
}

export function resolveLocation(procedureRequest, fallback = "Sin ubicacion") {
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

export function resolvePhotoData(procedureRequest) {
  const collectedData =
    procedureRequest?.collectedData && typeof procedureRequest.collectedData === "object"
      ? procedureRequest.collectedData
      : {};
  const catalogPhoto = collectedData.photo && typeof collectedData.photo === "object" ? collectedData.photo : null;
  const catalogUrl =
    catalogPhoto && typeof catalogPhoto.url === "string" ? catalogPhoto.url.trim() : "";
  const catalogFileName =
    catalogPhoto && typeof catalogPhoto.filename === "string" ? catalogPhoto.filename.trim() : "";
  const publicUrl =
    catalogUrl ||
    (typeof collectedData.photoAttachmentPublicUrl === "string"
      ? collectedData.photoAttachmentPublicUrl.trim()
      : "");
  const fileName =
    catalogFileName ||
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

export function DashboardIcon({ name, className = "" }) {
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
        <path
          d="M3.5 12.5 12 4l8.5 8.5v6a2 2 0 0 1-2 2h-3.5v-5h-6v5H5.5a2 2 0 0 1-2-2v-6Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
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
        <path
          d="M7 4h10M7 20h10M8.5 4v4.5l2.8 3.5-2.8 3.5V20M15.5 4v4.5l-2.8 3.5 2.8 3.5V20"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        <path
          d="M8 3.5h6l4 4V20a.5.5 0 0 1-.5.5h-9A2.5 2.5 0 0 1 6 18V6a2.5 2.5 0 0 1 2.5-2.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M14 3.5V8h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 6.5a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-4.5 3v-3H7a3 3 0 0 1-3-3v-8Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M9 10h6M9 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "arrowLeft") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "history") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 5h14v14H5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8 9h8M8 12.5h6M8 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "track") {
    return (
      <svg className={classes} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 8v4.2l2.8 1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

export function StatusBadge({ status, statusLabels, localeText }) {
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

export function DetailField({ icon, label, value, children }) {
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

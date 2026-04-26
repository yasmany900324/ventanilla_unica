"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";

const TERMINAL_PROCEDURE_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function hasRole(user, targetRole) {
  const normalizedTarget = String(targetRole || "").trim().toLowerCase();
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role];
  return roles.map((role) => String(role || "").trim().toLowerCase()).includes(normalizedTarget);
}

function formatDateTime(value, locale) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(locale || "es");
}

const LOCAL_STATUS_LABELS = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de sincronización",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

const CAMUNDA_STATUS_LABELS = {
  ERROR_SYNC: "Error de sincronización",
  TASK_ACTIVE: "Pendiente de revisión",
  PROCESS_RUNNING: "En proceso",
  NOT_SYNCED: "Sin tarea activa",
};

function getLocalStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  return LOCAL_STATUS_LABELS[key] || value || "-";
}

function getCamundaStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  return CAMUNDA_STATUS_LABELS[key] || value || "-";
}

function buildPendingLabel(item) {
  if (!item) {
    return "-";
  }
  if (item.assignmentScope === "available") {
    return "Tomar expediente";
  }
  if (item.hasCamundaError || item.camundaStatus === "ERROR_SYNC") {
    return "Error de sincronización";
  }
  if (item.activeTask?.taskDefinitionKey || item.camundaStatus === "TASK_ACTIVE") {
    return "Pendiente de revisión";
  }
  if (item.camundaStatus === "PROCESS_RUNNING") {
    return "En proceso";
  }
  return "Sin tarea activa";
}

function isPendingItem(item) {
  if (!item) {
    return false;
  }
  if (item.assignmentScope === "available") {
    return true;
  }
  return Boolean(
    item.hasCamundaError ||
      item.camundaStatus === "ERROR_SYNC" ||
      item.camundaStatus === "TASK_ACTIVE" ||
      item.activeTask?.taskDefinitionKey
  );
}

function isTerminalStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return TERMINAL_PROCEDURE_STATUSES.has(key);
}

function getAssignmentScopeLabel(item) {
  if (item?.assignmentScope === "assigned_to_me") {
    return "Asignado a mí";
  }
  if (item?.assignmentScope === "available") {
    return "Disponible";
  }
  return "Sin relación";
}

function filterOptionsFromList(list, selector) {
  const values = Array.from(new Set(list.map(selector).filter(Boolean)));
  return values.sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function getRelationBadgeClass(item) {
  if (item?.assignmentScope === "assigned_to_me") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--relation-assigned";
  }
  if (item?.assignmentScope === "available") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--relation-available";
  }
  return "funcionario-bandeja-badge funcionario-bandeja-badge--neutral";
}

function getChannelBadgeClass(channel) {
  const key = String(channel || "").trim().toUpperCase();
  if (key === "WHATSAPP") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--channel-wa";
  }
  if (key === "WEB") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--channel-web";
  }
  return "funcionario-bandeja-badge funcionario-bandeja-badge--neutral";
}

function getLocalStatusBadgeClass(status) {
  const key = String(status || "").trim().toUpperCase();
  if (key === "ERROR_CAMUNDA_SYNC") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--sync-error";
  }
  if (key === "RESOLVED" || key === "REJECTED" || key === "CLOSED" || key === "ARCHIVED") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--finished";
  }
  if (
    key === "PENDING_CONFIRMATION" ||
    key === "PENDING_CAMUNDA_SYNC" ||
    key === "PENDING_BACKOFFICE_ACTION"
  ) {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--pending";
  }
  if (key === "IN_PROGRESS") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--follow-up";
  }
  if (key === "WAITING_CITIZEN_INFO") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--info-wait";
  }
  if (key === "DRAFT") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--neutral";
  }
  return "funcionario-bandeja-badge funcionario-bandeja-badge--follow-up";
}

function getCamundaBadgeClass(camundaStatus) {
  const key = String(camundaStatus || "").trim().toUpperCase();
  if (key === "ERROR_SYNC") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--sync-error";
  }
  if (key === "TASK_ACTIVE") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--pending";
  }
  if (key === "PROCESS_RUNNING") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--follow-up";
  }
  if (key === "NOT_SYNCED") {
    return "funcionario-bandeja-badge funcionario-bandeja-badge--neutral";
  }
  return "funcionario-bandeja-badge funcionario-bandeja-badge--neutral";
}

const WORK_FILTER_OPTIONS = [
  { id: "all", label: "Todos" },
  { id: "assigned_to_me", label: "Asignados a mí" },
  { id: "available", label: "Disponibles" },
  { id: "pending", label: "Pendientes de acción" },
  { id: "follow_up", label: "En seguimiento" },
  { id: "finished", label: "Finalizados" },
];

function IconFolderExpediente() {
  return (
    <svg className="funcionario-bandeja__hero-icon-svg" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 14h9l3 3h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path
        d="M10 14h9l3 3h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M17 22h22M17 28h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconMetricCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 6V4m8 2V4M5 10h14M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMetricDoc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6M10 13h4M10 17h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconMetricChecklist() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 11l2 2 4-4M5 5h4M5 12h4M5 19h4M13 5h6M13 12h6M13 19h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMetricClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconMetricCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 10v6M12 7h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function FuncionarioBandejaExpedientesPage() {
  const router = useRouter();
  const { user, isLoadingAuth } = useAuth();
  const { locale } = useLocale();
  const [workFilter, setWorkFilter] = useState("all");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [localStatusFilter, setLocalStatusFilter] = useState("all");
  const [camundaStatusFilter, setCamundaStatusFilter] = useState("all");

  const isFuncionario = hasRole(user, "agente");

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }
    if (!user || !isFuncionario) {
      router.replace("/");
    }
  }, [isFuncionario, isLoadingAuth, router, user]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/funcionario/procedures/requests?limit=200`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          router.replace("/");
          return;
        }
        throw new Error(data?.error || "No se pudo cargar la bandeja.");
      }
      setList(Array.isArray(data?.procedures) ? data.procedures : []);
    } catch (requestError) {
      setError(requestError.message || "No se pudo cargar la bandeja.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (isLoadingAuth || !user || !isFuncionario) {
      return;
    }
    loadList();
  }, [isFuncionario, isLoadingAuth, loadList, user]);

  const channelOptions = useMemo(() => filterOptionsFromList(list, (item) => item.channel), [list]);
  const localStatusOptions = useMemo(() => filterOptionsFromList(list, (item) => item.status), [list]);
  const camundaStatusOptions = useMemo(
    () => filterOptionsFromList(list, (item) => item.camundaStatus),
    [list]
  );

  const filteredList = useMemo(() => {
    return list.filter((item) => {
      const matchesChannel = channelFilter === "all" || item.channel === channelFilter;
      const matchesLocalStatus = localStatusFilter === "all" || item.status === localStatusFilter;
      const matchesCamundaStatus = camundaStatusFilter === "all" || item.camundaStatus === camundaStatusFilter;
      if (!matchesChannel || !matchesLocalStatus || !matchesCamundaStatus) {
        return false;
      }
      if (workFilter === "assigned_to_me") {
        return item.assignmentScope === "assigned_to_me";
      }
      if (workFilter === "available") {
        return item.assignmentScope === "available";
      }
      if (workFilter === "pending") {
        return isPendingItem(item);
      }
      if (workFilter === "finished") {
        return isTerminalStatus(item.status);
      }
      if (workFilter === "follow_up") {
        return !isTerminalStatus(item.status) && !isPendingItem(item);
      }
      return true;
    });
  }, [camundaStatusFilter, channelFilter, list, localStatusFilter, workFilter]);

  const pendingCount = useMemo(() => filteredList.filter((item) => isPendingItem(item)).length, [filteredList]);

  const workMetrics = useMemo(() => {
    const total = filteredList.length;
    const disponibles = filteredList.filter((item) => item.assignmentScope === "available").length;
    const pendientes = filteredList.filter((item) => isPendingItem(item)).length;
    const seguimiento = filteredList.filter(
      (item) => !isTerminalStatus(item.status) && !isPendingItem(item)
    ).length;
    const finalizados = filteredList.filter((item) => isTerminalStatus(item.status)).length;
    return { total, disponibles, pendientes, seguimiento, finalizados };
  }, [filteredList]);

  const goToExpedienteDetail = (item) => {
    const internalId = item?.procedureRequestId || item?.id;
    if (!internalId) {
      return;
    }
    router.push(`/funcionario/expedientes/${encodeURIComponent(internalId)}`);
  };

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard funcionario-bandeja" lang={locale}>
        <section className="card funcionario-bandeja__hero funcionario-bandeja__hero--loading">
          <p className="funcionario-bandeja__loading-text">Cargando…</p>
        </section>
      </main>
    );
  }

  if (!user || !isFuncionario) {
    return null;
  }

  return (
    <main className="page page--dashboard funcionario-bandeja" lang={locale}>
      <section className="card funcionario-bandeja__hero" aria-labelledby="funcionario-bandeja-title">
        <div className="funcionario-bandeja__hero-main">
          <div className="funcionario-bandeja__hero-icon-wrap" aria-hidden="true">
            <IconFolderExpediente />
          </div>
          <div className="funcionario-bandeja__hero-copy">
            <p className="funcionario-bandeja__hero-badge">Área del funcionario</p>
            <h1 id="funcionario-bandeja-title" className="funcionario-bandeja__hero-title">
              Bandeja de expedientes
            </h1>
            <p className="funcionario-bandeja__hero-description">
              Consulta los expedientes asignados a ti y los disponibles para tomar. Abre el detalle en una página
              dedicada.
            </p>
          </div>
        </div>
        <div className="funcionario-bandeja__hero-wave" aria-hidden="true" />
      </section>

      <section className="card funcionario-bandeja__pill-card">
        <div className="funcionario-bandeja__pills-scroll">
          <div
            className="funcionario-bandeja__pills"
            role="group"
            aria-label="Filtrar expedientes por relación y estado de trabajo"
          >
            {WORK_FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`funcionario-bandeja__pill${workFilter === option.id ? " funcionario-bandeja__pill--active" : ""}`}
                aria-pressed={workFilter === option.id}
                onClick={() => setWorkFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="funcionario-bandeja__pills-hint">
          Mostrando expedientes asignados a ti y expedientes disponibles para tomar.
        </p>
      </section>

      {error ? (
        <section className="card funcionario-bandeja__error-card">
          <p className="error-message">{error}</p>
        </section>
      ) : null}

      <section className="card funcionario-bandeja__work-card">
        <header className="funcionario-bandeja__work-head">
          <div>
            <h2 className="funcionario-bandeja__work-title">Bandeja de trabajo</h2>
            <p className="funcionario-bandeja__work-sub">
              <strong>{pendingCount}</strong> expediente{pendingCount === 1 ? "" : "s"} con acción pendiente en esta
              vista.
            </p>
          </div>
        </header>

        <div className="funcionario-bandeja__metrics" aria-label="Resumen de la vista actual">
          <div className="funcionario-bandeja__metric">
            <span className="funcionario-bandeja__metric-icon funcionario-bandeja__metric-icon--primary">
              <IconMetricCalendar />
            </span>
            <span className="funcionario-bandeja__metric-label">Total filtrado</span>
            <span className="funcionario-bandeja__metric-value">{workMetrics.total}</span>
            <span className="funcionario-bandeja__metric-unit">expedientes</span>
          </div>
          <div className="funcionario-bandeja__metric">
            <span className="funcionario-bandeja__metric-icon">
              <IconMetricDoc />
            </span>
            <span className="funcionario-bandeja__metric-label">Disponibles</span>
            <span className="funcionario-bandeja__metric-value">{workMetrics.disponibles}</span>
            <span className="funcionario-bandeja__metric-unit">expedientes</span>
          </div>
          <div className="funcionario-bandeja__metric">
            <span className="funcionario-bandeja__metric-icon">
              <IconMetricChecklist />
            </span>
            <span className="funcionario-bandeja__metric-label">Pendientes de acción</span>
            <span className="funcionario-bandeja__metric-value">{workMetrics.pendientes}</span>
            <span className="funcionario-bandeja__metric-unit">expedientes</span>
          </div>
          <div className="funcionario-bandeja__metric">
            <span className="funcionario-bandeja__metric-icon">
              <IconMetricClock />
            </span>
            <span className="funcionario-bandeja__metric-label">En seguimiento</span>
            <span className="funcionario-bandeja__metric-value">{workMetrics.seguimiento}</span>
            <span className="funcionario-bandeja__metric-unit">expedientes</span>
          </div>
          <div className="funcionario-bandeja__metric">
            <span className="funcionario-bandeja__metric-icon">
              <IconMetricCheck />
            </span>
            <span className="funcionario-bandeja__metric-label">Finalizados</span>
            <span className="funcionario-bandeja__metric-value">{workMetrics.finalizados}</span>
            <span className="funcionario-bandeja__metric-unit">expedientes</span>
          </div>
        </div>

        <div className="funcionario-bandeja__filters">
          <div className="funcionario-bandeja__field">
            <label htmlFor="funcionario-inbox-channel-filter">Canal</label>
            <select
              id="funcionario-inbox-channel-filter"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {channelOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="funcionario-bandeja__field">
            <label htmlFor="funcionario-inbox-local-status-filter">Estado local</label>
            <select
              id="funcionario-inbox-local-status-filter"
              value={localStatusFilter}
              onChange={(event) => setLocalStatusFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {localStatusOptions.map((item) => (
                <option key={item} value={item}>
                  {getLocalStatusLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="funcionario-bandeja__field">
            <label htmlFor="funcionario-inbox-camunda-status-filter">Estado Camunda</label>
            <select
              id="funcionario-inbox-camunda-status-filter"
              value={camundaStatusFilter}
              onChange={(event) => setCamundaStatusFilter(event.target.value)}
            >
              <option value="all">Todos</option>
              {camundaStatusOptions.map((item) => (
                <option key={item} value={item}>
                  {getCamundaStatusLabel(item)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <p className="funcionario-bandeja__table-status">Cargando expedientes…</p>
        ) : filteredList.length === 0 ? (
          <p className="funcionario-bandeja__table-status funcionario-bandeja__table-status--muted">
            No hay expedientes para los filtros seleccionados.
          </p>
        ) : (
          <div className="funcionario-bandeja__table-wrap">
            <table className="funcionario-bandeja__table">
              <thead>
                <tr>
                  <th scope="col">Nº de expediente</th>
                  <th scope="col">Tipo de procedimiento</th>
                  <th scope="col">Relación</th>
                  <th scope="col">Canal</th>
                  <th scope="col">Estado local</th>
                  <th scope="col">Estado Camunda</th>
                  <th scope="col">Fecha de creación</th>
                  <th scope="col">Acción pendiente</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((item) => {
                  const rowPending = isPendingItem(item);
                  const pendingLabel = buildPendingLabel(item);
                  const camundaDisplay = item.camundaStatusLabel || getCamundaStatusLabel(item.camundaStatus);
                  return (
                    <tr
                      key={item.id}
                      className={rowPending ? "funcionario-bandeja__row funcionario-bandeja__row--attention" : "funcionario-bandeja__row"}
                    >
                      <td className="funcionario-bandeja__cell funcionario-bandeja__cell--mono">
                        <span className="funcionario-bandeja__exp-code">{item.requestCode || "—"}</span>
                        <span className="funcionario-bandeja__exp-id">ID interno: {item.id}</span>
                      </td>
                      <td className="funcionario-bandeja__cell">{item.procedureName || item.procedureCode || "—"}</td>
                      <td className="funcionario-bandeja__cell">
                        <span className={getRelationBadgeClass(item)}>{getAssignmentScopeLabel(item)}</span>
                      </td>
                      <td className="funcionario-bandeja__cell">
                        {item.channel ? (
                          <span className={getChannelBadgeClass(item.channel)}>{item.channel}</span>
                        ) : (
                          <span className="funcionario-bandeja-badge funcionario-bandeja-badge--neutral">—</span>
                        )}
                      </td>
                      <td className="funcionario-bandeja__cell">
                        <span className={getLocalStatusBadgeClass(item.status)}>{getLocalStatusLabel(item.status)}</span>
                      </td>
                      <td className="funcionario-bandeja__cell">
                        <span className={getCamundaBadgeClass(item.camundaStatus)}>{camundaDisplay}</span>
                      </td>
                      <td className="funcionario-bandeja__cell funcionario-bandeja__cell--nowrap">
                        {formatDateTime(item.createdAt, locale)}
                      </td>
                      <td className="funcionario-bandeja__cell">
                        <span
                          className={
                            pendingLabel === "Tomar expediente"
                              ? "funcionario-bandeja__pending funcionario-bandeja__pending--take"
                              : "funcionario-bandeja__pending"
                          }
                        >
                          {pendingLabel}
                        </span>
                        <span className="funcionario-bandeja__pending-detail">{item.pendingAction || "—"}</span>
                      </td>
                      <td className="funcionario-bandeja__cell funcionario-bandeja__cell--actions">
                        <button
                          type="button"
                          className="funcionario-bandeja__btn-primary"
                          onClick={() => goToExpedienteDetail(item)}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="funcionario-bandeja__info-alert" role="status">
        <span className="funcionario-bandeja__info-alert-icon" aria-hidden="true">
          <IconInfo />
        </span>
        <p className="funcionario-bandeja__info-alert-text">
          Usa <strong className="funcionario-bandeja__kbd-strong">Ver detalle</strong> para abrir el expediente en
          una página aparte. Allí podrás tomar expedientes disponibles o gestionar los asignados a ti.
        </p>
      </div>
    </main>
  );
}

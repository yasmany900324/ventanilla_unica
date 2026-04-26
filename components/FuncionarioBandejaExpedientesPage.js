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

  const goToExpedienteDetail = (item) => {
    const internalId = item?.procedureRequestId || item?.id;
    if (!internalId) {
      return;
    }
    router.push(`/funcionario/expedientes/${encodeURIComponent(internalId)}`);
  };

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard" lang={locale}>
        <section className="card dashboard-header">
          <p className="info-message">Cargando…</p>
        </section>
      </main>
    );
  }

  if (!user || !isFuncionario) {
    return null;
  }

  return (
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">ÁREA DEL FUNCIONARIO</p>
          <h1>Bandeja de expedientes</h1>
          <p className="description">
            Consulta los expedientes asignados a ti y los disponibles para tomar. Abre el detalle en una página
            dedicada.
          </p>
        </div>
      </section>

      <section className="card dashboard-section">
        <div className="admin-procedure-toolbar__filters">
          <button
            type="button"
            className={`button-inline ${workFilter === "all" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("all")}
          >
            Todos
          </button>
          <button
            type="button"
            className={`button-inline ${workFilter === "assigned_to_me" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("assigned_to_me")}
          >
            Asignados a mí
          </button>
          <button
            type="button"
            className={`button-inline ${workFilter === "available" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("available")}
          >
            Disponibles
          </button>
          <button
            type="button"
            className={`button-inline ${workFilter === "pending" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("pending")}
          >
            Pendientes de acción
          </button>
          <button
            type="button"
            className={`button-inline ${workFilter === "follow_up" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("follow_up")}
          >
            En seguimiento
          </button>
          <button
            type="button"
            className={`button-inline ${workFilter === "finished" ? "button-inline--selected" : ""}`}
            onClick={() => setWorkFilter("finished")}
          >
            Finalizados
          </button>
        </div>
        <p className="small">Mostrando expedientes asignados a ti y expedientes disponibles para tomar.</p>
      </section>

      {error ? (
        <section className="card">
          <p className="error-message">{error}</p>
        </section>
      ) : null}

      <section className="card dashboard-section">
        <div className="admin-procedure-table__header">
          <h3>Bandeja de trabajo</h3>
          <p className="small">
            Total filtrado: {filteredList.length}. Con acción pendiente: {pendingCount}.
          </p>
        </div>
        <div className="admin-inbox-filters">
          <div>
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
          <div>
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
          <div>
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
          <p className="info-message">Cargando expedientes...</p>
        ) : filteredList.length === 0 ? (
          <p className="empty-message">No hay expedientes para los filtros seleccionados.</p>
        ) : (
          <div className="admin-procedure-table__container">
            <table className="admin-procedure-table">
              <thead>
                <tr>
                  <th>ID / número de expediente</th>
                  <th>Tipo de procedimiento</th>
                  <th>Relación</th>
                  <th>Canal</th>
                  <th>Estado local</th>
                  <th>Estado Camunda</th>
                  <th>Fecha de creación</th>
                  <th>Acción pendiente</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((item) => {
                  const rowPending = isPendingItem(item);
                  const pendingLabel = buildPendingLabel(item);
                  return (
                    <tr
                      key={item.id}
                      className={rowPending ? "admin-inbox-table__row--attention" : ""}
                    >
                      <td className="admin-procedure-table__mono">
                        <span className="admin-procedure-table__primary">{item.requestCode || "—"}</span>
                        <p className="admin-procedure-table__secondary">ID interno: {item.id}</p>
                      </td>
                      <td>{item.procedureName || item.procedureCode || "-"}</td>
                      <td>
                        <span
                          className={`badge ${
                            item.assignmentScope === "assigned_to_me" ? "badge--en-revision" : "badge--recibido"
                          }`}
                        >
                          {getAssignmentScopeLabel(item)}
                        </span>
                      </td>
                      <td>{item.channel || "-"}</td>
                      <td>
                        <span className="badge badge--en-revision">{getLocalStatusLabel(item.status)}</span>
                      </td>
                      <td>
                        <span className="badge badge--recibido">
                          {item.camundaStatusLabel || getCamundaStatusLabel(item.camundaStatus)}
                        </span>
                      </td>
                      <td>{formatDateTime(item.createdAt, locale)}</td>
                      <td>
                        <p className="admin-procedure-table__primary">{pendingLabel}</p>
                        <p className="admin-procedure-table__secondary">{item.pendingAction || "-"}</p>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button-inline"
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

      <section className="card dashboard-section">
        <p className="small">
          Usa <strong>Ver detalle</strong> para abrir el expediente en una página aparte. Allí podrás tomar
          expedientes disponibles o gestionar los asignados a ti.
        </p>
      </section>
    </main>
  );
}

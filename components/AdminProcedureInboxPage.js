"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import AdminPanelNav from "./AdminPanelNav";

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

function parseJsonInput(value, fallback = {}) {
  if (!value || !String(value).trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeScopeLabel(scope) {
  if (scope === "mine") {
    return "Asignados a mí";
  }
  if (scope === "unassigned") {
    return "Sin asignar";
  }
  return "Mi bandeja + sin asignar";
}

function humanizeTaskKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Sin tarea activa";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

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

function buildActionTitle(action) {
  if (action?.displayLabel) {
    return action.displayLabel;
  }
  if (action?.actionKey === "claim_task") {
    return "Reclamar tarea";
  }
  if (action?.actionKey === "complete_task") {
    return "Completar tarea";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reintentar sincronización";
  }
  return action?.label || "Acción";
}

function buildActionDescription(action) {
  if (typeof action?.description === "string" && action.description.trim()) {
    return action.description.trim();
  }
  if (action?.actionKey === "claim_task") {
    return "Toma la tarea activa para gestionarla desde esta bandeja.";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reenvía el expediente a Camunda cuando hubo error de sincronización.";
  }
  if (action?.actionKey === "complete_task") {
    return `Avanza el flujo de Camunda para: ${action.taskDisplayName || "tarea activa"}.`;
  }
  return action?.label || "";
}

function isPendingItem(item) {
  if (!item) {
    return false;
  }
  return Boolean(
    item.hasCamundaError ||
      item.camundaStatus === "ERROR_SYNC" ||
      item.camundaStatus === "TASK_ACTIVE" ||
      item.activeTask?.taskDefinitionKey
  );
}

function resolveAttachmentValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const candidates = [
    collectedData.photo,
    collectedData.photoUrl,
    collectedData.image,
    collectedData.imageUrl,
    collectedData.attachmentUrl,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || null;
}

function resolveLocationValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const location = collectedData.location ?? collectedData.address ?? null;
  if (!location) {
    return null;
  }
  if (typeof location === "string") {
    return location;
  }
  return JSON.stringify(location, null, 2);
}

function filterOptionsFromList(list, selector) {
  const values = Array.from(new Set(list.map(selector).filter(Boolean)));
  return values.sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function ProcedureFieldVariables({ requiredVariables }) {
  if (!Array.isArray(requiredVariables) || requiredVariables.length === 0) {
    return null;
  }
  return (
    <>
      <p className="small">Variables requeridas para esta tarea:</p>
      <ul className="admin-procedure-fields__list">
        {requiredVariables.map((item, index) => (
          <li key={`${item.procedureFieldKey || "field"}-${index}`} className="admin-procedure-fields__item">
            <p className="small">
              <strong>{item.fieldLabel || item.procedureFieldKey}</strong>
            </p>
            <p className="small">
              Variable Camunda: {item.camundaVariableName} ({item.camundaVariableType || "string"})
            </p>
            <p className="small">Obligatoria: {item.required ? "Sí" : "No"}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function AdminProcedureInboxPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const [scope, setScope] = useState("mine");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoadingKey, setActionLoadingKey] = useState("");
  const [completeVariablesJson, setCompleteVariablesJson] = useState("{}");
  const [internalObservation, setInternalObservation] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [localStatusFilter, setLocalStatusFilter] = useState("all");
  const [camundaStatusFilter, setCamundaStatusFilter] = useState("all");

  const isAdministrator = user?.role === "administrador";

  useEffect(() => {
    if (user && !isAdministrator) {
      router.replace("/");
    }
  }, [isAdministrator, router, user]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/procedures/requests?limit=200&scope=${encodeURIComponent(scope)}`,
        { cache: "no-store" }
      );
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
  }, [router, scope]);

  const loadDetail = useCallback(async (requestId) => {
    if (!requestId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/procedures/requests/${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No se pudo cargar el detalle del expediente.");
      }
      setDetail(data);
      setCompleteVariablesJson("{}");
      setInternalObservation("");
      setNextStatus("");
    } catch (requestError) {
      setError(requestError.message || "No se pudo cargar el detalle del expediente.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !isAdministrator) {
      return;
    }
    loadList();
  }, [isAdministrator, loadList, user]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const stillVisible = list.some((item) => item.id === selectedId);
    if (!stillVisible) {
      setSelectedId("");
      setDetail(null);
    }
  }, [list, selectedId]);

  const availableActions = useMemo(
    () => (Array.isArray(detail?.availableActions) ? detail.availableActions : []),
    [detail?.availableActions]
  );

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
      return matchesChannel && matchesLocalStatus && matchesCamundaStatus;
    });
  }, [camundaStatusFilter, channelFilter, list, localStatusFilter]);

  const pendingCount = useMemo(() => filteredList.filter((item) => isPendingItem(item)).length, [filteredList]);

  const handleSelectDetail = async (requestId) => {
    setSelectedId(requestId);
    await loadDetail(requestId);
  };

  const runAction = async (action) => {
    if (!action?.endpoint) {
      return;
    }
    const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
    setActionLoadingKey(actionKey);
    setError("");
    setSuccessMessage("");
    try {
      let body = undefined;
      if (action.actionKey === "complete_task") {
        const parsedVariables = parseJsonInput(completeVariablesJson, {});
        if (parsedVariables === null || typeof parsedVariables !== "object") {
          throw new Error("El JSON de variables no es válido.");
        }
        const observation = String(internalObservation || "").trim();
        const mergedVariables = { ...parsedVariables };
        if (observation) {
          mergedVariables.__internalObservation = observation;
        }
        body = {
          collectedData: mergedVariables,
          nextStatus: String(nextStatus || "").trim() || undefined,
          expectedTaskDefinitionKey: action.expectedTaskDefinitionKey || undefined,
          idempotencyKey: `backoffice-${Date.now()}`,
        };
      }
      const response = await fetch(action.endpoint, {
        method: action.method || "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No se pudo ejecutar la acción.");
      }
      setSuccessMessage("Acción ejecutada correctamente.");
      await loadList();
      if (selectedId) {
        await loadDetail(selectedId);
      }
    } catch (requestError) {
      setError(requestError.message || "No se pudo ejecutar la acción.");
    } finally {
      setActionLoadingKey("");
    }
  };

  if (user && !isAdministrator) {
    return null;
  }

  const procedureRequest = detail?.procedureRequest || null;
  const collectedData = procedureRequest?.collectedData || {};
  const attachmentValue = resolveAttachmentValue(collectedData);
  const locationValue = resolveLocationValue(collectedData);
  const activeTaskLabel =
    detail?.activeTaskDisplay?.title ||
    detail?.activeTask?.taskDefinitionName ||
    humanizeTaskKey(detail?.activeTask?.taskDefinitionKey);
  const activeTaskDescription = String(detail?.activeTaskDisplay?.description || "").trim();

  return (
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">{copy.portal.adminDashboard}</p>
          <h1>Bandeja de expedientes</h1>
          <p className="description">
            Gestiona expedientes asignados al funcionario autenticado con foco en acciones pendientes.
          </p>
        </div>
      </section>
      <AdminPanelNav />

      <section className="card dashboard-section">
        <div className="admin-procedure-toolbar__filters">
          <button
            type="button"
            className={`button-inline ${scope === "mine" ? "button-inline--selected" : ""}`}
            onClick={() => setScope("mine")}
          >
            Asignados a mí
          </button>
          <button
            type="button"
            className={`button-inline ${scope === "unassigned" ? "button-inline--selected" : ""}`}
            onClick={() => setScope("unassigned")}
          >
            Sin asignar
          </button>
          <button
            type="button"
            className={`button-inline ${scope === "all" ? "button-inline--selected" : ""}`}
            onClick={() => setScope("all")}
          >
            Mi bandeja + sin asignar
          </button>
        </div>
        <p className="small">Vista actual: {normalizeScopeLabel(scope)}</p>
      </section>

      {successMessage ? (
        <section className="card">
          <p className="info-message">{successMessage}</p>
        </section>
      ) : null}
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
            <label htmlFor="inbox-channel-filter">Canal</label>
            <select
              id="inbox-channel-filter"
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
            <label htmlFor="inbox-local-status-filter">Estado local</label>
            <select
              id="inbox-local-status-filter"
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
            <label htmlFor="inbox-camunda-status-filter">Estado Camunda</label>
            <select
              id="inbox-camunda-status-filter"
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
                      className={`${rowPending ? "admin-inbox-table__row--attention" : ""} ${
                        selectedId === item.id ? "admin-inbox-table__row--selected" : ""
                      }`}
                    >
                      <td className="admin-procedure-table__mono">{item.requestCode || item.id}</td>
                      <td>{item.procedureName || item.procedureCode || "-"}</td>
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
                          onClick={() => handleSelectDetail(item.id)}
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
        <h3>Detalle del expediente</h3>
        {detailLoading ? <p className="info-message">Cargando detalle...</p> : null}
        {!detailLoading && !procedureRequest ? (
          <p className="empty-message">Selecciona un expediente para ver el detalle completo.</p>
        ) : null}
        {!detailLoading && procedureRequest ? (
          <div className="admin-inbox-detail">
            <section className="admin-procedure-fields">
              <h4>Resumen del expediente</h4>
              <p className="small">
                <strong>Resumen:</strong> {procedureRequest.summary || "Sin resumen"}
              </p>
              <p className="small">
                <strong>Tipo de procedimiento:</strong>{" "}
                {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}
              </p>
              <p className="small">
                <strong>Canal de origen:</strong> {procedureRequest.channel || "-"}
              </p>
              <p className="small">
                <strong>Fecha de creación:</strong> {formatDateTime(procedureRequest.createdAt, locale)}
              </p>
              <p className="small">
                <strong>Estado local:</strong> {getLocalStatusLabel(procedureRequest.status)}
              </p>
              <p className="small">
                <strong>Responsable actual:</strong> {procedureRequest.assignedToUserId || "Sin asignar"}
              </p>
            </section>

            <section className="admin-procedure-fields">
              <h4>Datos del ciudadano / contacto</h4>
              <p className="small">
                <strong>Ciudadano asociado:</strong> {procedureRequest.userId || "-"}
              </p>
              <p className="small">
                <strong>Número de WhatsApp:</strong> {procedureRequest.whatsappPhone || "-"}
              </p>
            </section>

            <section className="admin-procedure-fields">
              <h4>Datos recibidos por chatbot</h4>
              <label className="small">Datos recolectados</label>
              <textarea readOnly rows={8} value={JSON.stringify(collectedData || {}, null, 2)} />
              <p className="small">
                <strong>Imagen adjunta:</strong> {attachmentValue || "-"}
              </p>
              <p className="small">
                <strong>Ubicación:</strong> {locationValue || "-"}
              </p>
            </section>

            <section className="admin-procedure-fields">
              <h4>Estado Camunda</h4>
              <p className="small">
                <strong>Estado Camunda:</strong>{" "}
                {getCamundaStatusLabel(procedureRequest.camundaStatus || detail?.activeTask?.taskState)}
              </p>
              <p className="small">
                <strong>Instancia:</strong> {procedureRequest.camundaProcessInstanceKey || "-"}
              </p>
              <p className="small">
                <strong>Definición:</strong> {procedureRequest.camundaProcessDefinitionId || "-"}
              </p>
              <p className="small">
                <strong>Tarea activa:</strong> {activeTaskLabel}
              </p>
              {activeTaskDescription ? (
                <p className="small">
                  <strong>Descripción funcional:</strong> {activeTaskDescription}
                </p>
              ) : null}
              <label className="small">Variables de Camunda</label>
              <textarea readOnly rows={6} value={JSON.stringify(procedureRequest.camundaMetadata || {}, null, 2)} />
              <p className="small">
                <strong>Errores de sincronización:</strong> {procedureRequest.camundaError || "Sin errores"}
              </p>
            </section>

            <section className="admin-procedure-fields">
              <h4>Acciones del funcionario</h4>
              <p className="small">
                Las acciones visibles se calculan por tarea activa y configuración del procedimiento.
              </p>
              {availableActions.length ? (
                availableActions.map((action) => {
                  const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
                  const actionTitle = buildActionTitle(action);
                  const actionDescription = buildActionDescription(action);
                  return (
                    <div key={actionKey} className="admin-procedure-fields__item">
                      <p className="small">
                        <strong>{actionTitle}</strong>
                      </p>
                      {actionDescription ? <p className="small">{actionDescription}</p> : null}
                      {action.actionKey === "complete_task" ? (
                        <>
                          <label className="small">Variables para avanzar (JSON)</label>
                          <textarea
                            rows={6}
                            value={completeVariablesJson}
                            onChange={(event) => setCompleteVariablesJson(event.target.value)}
                          />
                          <label className="small">Observaciones internas</label>
                          <textarea
                            rows={3}
                            value={internalObservation}
                            onChange={(event) => setInternalObservation(event.target.value)}
                          />
                          <label className="small">Cambio de estado local (opcional)</label>
                          <input
                            type="text"
                            value={nextStatus}
                            onChange={(event) => setNextStatus(event.target.value)}
                            placeholder="Ej: PENDING_BACKOFFICE_ACTION"
                          />
                          <ProcedureFieldVariables requiredVariables={action.requiredVariables} />
                        </>
                      ) : null}
                      <button
                        type="button"
                        className="button-inline"
                        onClick={() => runAction(action)}
                        disabled={actionLoadingKey === actionKey}
                      >
                        {actionLoadingKey === actionKey ? "Procesando..." : actionTitle}
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="empty-message">No hay acciones pendientes para este expediente.</p>
              )}
            </section>

            <section className="admin-procedure-fields">
              <h4>Historial / observaciones</h4>
              <textarea readOnly rows={8} value={JSON.stringify(detail.history || [], null, 2)} />
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}

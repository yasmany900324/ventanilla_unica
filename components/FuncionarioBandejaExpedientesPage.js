"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";

const TERMINAL_PROCEDURE_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function hasRole(user, targetRole) {
  const normalizedTarget = String(targetRole || "").trim().toLowerCase();
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role];
  return roles.map((role) => String(role || "").trim().toLowerCase()).includes(normalizedTarget);
}

/** @returns {{ date: string, time: string } | null} */
function formatCreatedAtParts(value, locale) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const loc = locale || "es";
  return {
    date: date.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: date.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }),
  };
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

function canClaimExpediente(item) {
  if (!item) {
    return false;
  }
  if (isTerminalStatus(item.status)) {
    return false;
  }
  if (item.assignmentScope === "assigned_to_me") {
    return false;
  }
  if (item.assignmentScope === "available" || item.isAvailableToClaim === true) {
    return true;
  }
  if (getAssignmentScopeLabel(item) === "Disponible") {
    return true;
  }
  const hasOwner = Boolean(item.assignedToUserId && String(item.assignedToUserId).trim() !== "");
  if (!hasOwner) {
    return String(item.pendingAction || "").trim() === "Tomar expediente";
  }
  return false;
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

const ACTIONS_MENU_PANEL_ID = "funcionario-bandeja-actions-menu";
const DELETE_MODAL_TITLE_ID = "funcionario-bandeja-delete-modal-title";

function computeActionsMenuPlacement(anchorEl) {
  if (!anchorEl || typeof window === "undefined") {
    return { top: 0, right: 0 };
  }
  const rect = anchorEl.getBoundingClientRect();
  const gap = 4;
  return {
    top: rect.bottom + gap,
    right: window.innerWidth - rect.right,
  };
}

function getRowActionsMenuId(item) {
  return String(item?.procedureRequestId || item?.id || "");
}

export default function FuncionarioBandejaExpedientesPage() {
  const router = useRouter();
  const { user, isLoadingAuth } = useAuth();
  const { locale } = useLocale();
  const [workFilter, setWorkFilter] = useState("all");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [openActionsMenuId, setOpenActionsMenuId] = useState(null);
  const [actionsMenuPlacement, setActionsMenuPlacement] = useState({ top: 0, right: 0 });
  const actionsMenuAnchorRef = useRef(null);
  const deleteRequestInFlightRef = useRef(false);
  const claimRequestInFlightRef = useRef(false);
  const [claimingId, setClaimingId] = useState("");
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

  const openActionsItem = useMemo(
    () =>
      openActionsMenuId
        ? filteredList.find((row) => getRowActionsMenuId(row) === openActionsMenuId) || null
        : null,
    [filteredList, openActionsMenuId]
  );

  useEffect(() => {
    if (openActionsMenuId && !openActionsItem) {
      setOpenActionsMenuId(null);
    }
  }, [openActionsMenuId, openActionsItem]);

  const syncActionsMenuPlacement = useCallback(() => {
    if (!openActionsMenuId) {
      return;
    }
    const el = actionsMenuAnchorRef.current;
    if (!el) {
      return;
    }
    setActionsMenuPlacement(computeActionsMenuPlacement(el));
  }, [openActionsMenuId]);

  useLayoutEffect(() => {
    if (!openActionsMenuId) {
      return undefined;
    }
    syncActionsMenuPlacement();
    window.addEventListener("scroll", syncActionsMenuPlacement, true);
    window.addEventListener("resize", syncActionsMenuPlacement);
    return () => {
      window.removeEventListener("scroll", syncActionsMenuPlacement, true);
      window.removeEventListener("resize", syncActionsMenuPlacement);
    };
  }, [openActionsMenuId, syncActionsMenuPlacement]);

  useEffect(() => {
    if (!openActionsMenuId) {
      return undefined;
    }
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (target.closest?.("[data-funcionario-actions-menu]")) {
        return;
      }
      const triggerEl = target.closest?.("[data-funcionario-actions-trigger]");
      if (triggerEl?.getAttribute("data-funcionario-actions-trigger") === openActionsMenuId) {
        return;
      }
      setOpenActionsMenuId(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenActionsMenuId(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openActionsMenuId]);

  useEffect(() => {
    if (!deleteCandidate || !isDeleteModalOpen) {
      return undefined;
    }
    const id = getRowActionsMenuId(deleteCandidate);
    const stillInView = filteredList.some((row) => getRowActionsMenuId(row) === id);
    if (!stillInView) {
      setDeleteCandidate(null);
      setIsDeleteModalOpen(false);
    }
  }, [deleteCandidate, filteredList, isDeleteModalOpen]);

  useEffect(() => {
    if (!isDeleteModalOpen || typeof document === "undefined") {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isDeleteModalOpen]);

  useEffect(() => {
    if (!isDeleteModalOpen || deletingId) {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteCandidate(null);
        setIsDeleteModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deletingId, isDeleteModalOpen]);

  const closeDeleteModal = useCallback(() => {
    if (deletingId) {
      return;
    }
    setDeleteCandidate(null);
    setIsDeleteModalOpen(false);
  }, [deletingId]);

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

  const handleClaimExpediente = useCallback(
    async (item) => {
      setOpenActionsMenuId(null);
      const internalId = item?.procedureRequestId || item?.id;
      if (!internalId || !canClaimExpediente(item) || claimRequestInFlightRef.current) {
        return;
      }
      claimRequestInFlightRef.current = true;
      setClaimingId(String(internalId));
      setError("");
      setSuccessMessage("");
      try {
        const response = await fetch(
          `/api/funcionario/procedures/requests/${encodeURIComponent(internalId)}/claim-expediente`,
          { method: "POST" }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          let message = data?.error || "No se pudo ejecutar la acción.";
          if (response.status === 409) {
            message = "Este expediente ya fue tomado por otro funcionario.";
          } else if (response.status === 404) {
            message = data?.error || "No se encontró el expediente solicitado.";
          } else if (response.status === 403) {
            message = data?.error || "No estás habilitado para tomar este tipo de procedimiento.";
          } else if (response.status >= 500) {
            message = data?.error || "No se pudo tomar el expediente.";
          }
          setError(message);
          return;
        }
        setSuccessMessage(
          data?.message || "Expediente tomado correctamente."
        );
        await loadList();
      } catch (_error) {
        setError("No se pudo tomar el expediente.");
      } finally {
        setClaimingId("");
        claimRequestInFlightRef.current = false;
      }
    },
    [loadList]
  );

  const executeDeleteExpediente = useCallback(async (item) => {
    const internalId = item?.procedureRequestId || item?.id;
    if (!internalId || deleteRequestInFlightRef.current) {
      return;
    }
    deleteRequestInFlightRef.current = true;
    setDeletingId(String(internalId));
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/funcionario/expedientes/${encodeURIComponent(internalId)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          response.status === 409 && String(data?.error || "").toLowerCase().includes("camunda")
            ? "No se pudo eliminar la instancia en Camunda. El expediente no fue eliminado."
            : data?.error || "No se pudo eliminar el expediente.";
        setError(message);
        setDeleteCandidate(null);
        setIsDeleteModalOpen(false);
        return;
      }
      setSuccessMessage(data?.message || "Expediente eliminado correctamente.");
      setDeleteCandidate(null);
      setIsDeleteModalOpen(false);
      await loadList();
    } catch (_error) {
      setError("No se pudo eliminar el expediente.");
      setDeleteCandidate(null);
      setIsDeleteModalOpen(false);
    } finally {
      setDeletingId("");
      deleteRequestInFlightRef.current = false;
    }
  }, [loadList]);

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard funcionario-bandeja" lang={locale}>
        <div className="funcionario-bandeja__inner">
          <section className="dashboard-onify-card dashboard-onify-hero" aria-busy="true">
            <div className="dashboard-onify-hero__content">
              <p className="info-message">Cargando…</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!user || !isFuncionario) {
    return null;
  }

  return (
    <main className="page page--dashboard funcionario-bandeja" lang={locale}>
      <div className="funcionario-bandeja__inner">
      <section
        className="dashboard-onify-card dashboard-onify-hero"
        aria-labelledby="funcionario-bandeja-title"
      >
        <div className="dashboard-onify-hero__content">
          <p className="dashboard-onify-hero__eyebrow">Área del funcionario</p>
          <h1 id="funcionario-bandeja-title">Bandeja de expedientes</h1>
          <p>
            Consulta los expedientes asignados a ti y los disponibles para tomar. Abre el detalle en una página
            dedicada.
          </p>
        </div>
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

        {successMessage ? <p className="status-message">{successMessage}</p> : null}

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
                  <th scope="col" className="funcionario-bandeja__th--multiline">
                    Tipo de
                    <br />
                    procedimiento
                  </th>
                  <th scope="col">Relación</th>
                  <th scope="col">Canal</th>
                  <th scope="col">Estado local</th>
                  <th scope="col">Estado Camunda</th>
                  <th scope="col" className="funcionario-bandeja__th--multiline">
                    Fecha de
                    <br />
                    creación
                  </th>
                  <th scope="col">Acción pendiente</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((item) => {
                  const rowPending = isPendingItem(item);
                  const camundaDisplay = item.camundaStatusLabel || getCamundaStatusLabel(item.camundaStatus);
                  const createdAtParts = formatCreatedAtParts(item.createdAt, locale);
                  const rowActionsId = getRowActionsMenuId(item);
                  const isActionsMenuOpen = openActionsMenuId === rowActionsId;
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
                      <td className="funcionario-bandeja__cell funcionario-bandeja__cell--created-at">
                        {createdAtParts ? (
                          <>
                            <span className="funcionario-bandeja__created-at-line">{createdAtParts.date}</span>
                            <span className="funcionario-bandeja__created-at-line funcionario-bandeja__created-at-line--time">
                              {createdAtParts.time}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="funcionario-bandeja__cell">
                        <div className="funcionario-bandeja__pending-wrap">
                          {canClaimExpediente(item) ? (
                            <button
                              type="button"
                              className="funcionario-bandeja__pending-take"
                              onClick={() => void handleClaimExpediente(item)}
                              disabled={claimingId === rowActionsId}
                            >
                              {claimingId === rowActionsId
                                ? "Tomando…"
                                : item.pendingAction || "Tomar expediente"}
                            </button>
                          ) : (
                            <span className="funcionario-bandeja__pending-detail">
                              {item.pendingAction || "—"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="funcionario-bandeja__cell funcionario-bandeja__cell--actions">
                        <div className="funcionario-bandeja__actions">
                          <button
                            type="button"
                            ref={isActionsMenuOpen ? actionsMenuAnchorRef : undefined}
                            className="funcionario-bandeja__menu-trigger"
                            data-funcionario-actions-trigger={rowActionsId}
                            aria-label={`Abrir acciones para expediente ${item.requestCode || item.id}`}
                            aria-haspopup="menu"
                            aria-expanded={isActionsMenuOpen}
                            aria-controls={isActionsMenuOpen ? ACTIONS_MENU_PANEL_ID : undefined}
                            id={`funcionario-bandeja-actions-trigger-${rowActionsId}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isActionsMenuOpen) {
                                setOpenActionsMenuId(null);
                                return;
                              }
                              setActionsMenuPlacement(computeActionsMenuPlacement(event.currentTarget));
                              setOpenActionsMenuId(rowActionsId);
                            }}
                          >
                            <span aria-hidden="true">⋮</span>
                          </button>
                        </div>
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
          En <strong className="funcionario-bandeja__kbd-strong">Acciones</strong>, abre el menú{" "}
          <strong className="funcionario-bandeja__kbd-strong">⋮</strong> y elige{" "}
          <strong className="funcionario-bandeja__kbd-strong">Ver detalle</strong> para abrir el expediente en una
          página aparte. Allí podrás tomar expedientes disponibles o gestionar los asignados a ti.
        </p>
      </div>
      </div>

      {openActionsMenuId && openActionsItem && typeof document !== "undefined"
        ? createPortal(
            <div
              id={ACTIONS_MENU_PANEL_ID}
              className="funcionario-bandeja funcionario-bandeja__actions-dropdown"
              data-funcionario-actions-menu
              role="menu"
              aria-labelledby={`funcionario-bandeja-actions-trigger-${openActionsMenuId}`}
              style={{
                top: actionsMenuPlacement.top,
                right: actionsMenuPlacement.right,
              }}
            >
              <button
                type="button"
                role="menuitem"
                className="funcionario-bandeja__menu-item"
                onClick={() => {
                  setOpenActionsMenuId(null);
                  goToExpedienteDetail(openActionsItem);
                }}
              >
                Ver detalle
              </button>
              {canClaimExpediente(openActionsItem) ? (
                <button
                  type="button"
                  role="menuitem"
                  className="funcionario-bandeja__menu-item"
                  disabled={claimingId === openActionsMenuId}
                  onClick={() => {
                    void handleClaimExpediente(openActionsItem);
                  }}
                >
                  {claimingId === openActionsMenuId ? "Tomando…" : "Tomar"}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="funcionario-bandeja__menu-item funcionario-bandeja__menu-item--danger"
                onClick={() => {
                  const row = openActionsItem;
                  setOpenActionsMenuId(null);
                  setDeleteCandidate(row);
                  setIsDeleteModalOpen(true);
                }}
              >
                Eliminar
              </button>
            </div>,
            document.body
          )
        : null}

      {isDeleteModalOpen && deleteCandidate && typeof document !== "undefined"
        ? createPortal(
            <div className="funcionario-bandeja-delete-modal" role="presentation" onClick={closeDeleteModal}>
              <div
                className="funcionario-bandeja-delete-modal__panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby={DELETE_MODAL_TITLE_ID}
                data-funcionario-delete-modal
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id={DELETE_MODAL_TITLE_ID} className="funcionario-bandeja-delete-modal__title">
                  Eliminar expediente
                </h2>
                <p className="funcionario-bandeja-delete-modal__lead">
                  ¿Confirma que desea eliminar el expediente{" "}
                  <strong className="funcionario-bandeja-delete-modal__strong">
                    {deleteCandidate.requestCode ||
                      deleteCandidate.procedureRequestId ||
                      deleteCandidate.id ||
                      "—"}
                  </strong>
                  ? Esta acción no se puede deshacer.
                </p>
                <p className="funcionario-bandeja-delete-modal__hint">
                  Si el trámite está sincronizado en Camunda, se eliminará primero en esa plataforma y luego en la base
                  de datos del sistema.
                </p>
                <div className="funcionario-bandeja-delete-modal__actions">
                  <button
                    type="button"
                    className="funcionario-bandeja-delete-modal__btn funcionario-bandeja-delete-modal__btn--ghost"
                    disabled={Boolean(deletingId)}
                    onClick={closeDeleteModal}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="funcionario-bandeja-delete-modal__btn funcionario-bandeja-delete-modal__btn--danger"
                    disabled={Boolean(deletingId)}
                    onClick={() => {
                      void executeDeleteExpediente(deleteCandidate);
                    }}
                  >
                    {deletingId ? "Eliminando..." : "Eliminar expediente"}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </main>
  );
}

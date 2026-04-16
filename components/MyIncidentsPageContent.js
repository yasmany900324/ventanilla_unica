"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IncidentListItem from "./IncidentListItem";
import IncidentCaseDetail from "./IncidentCaseDetail";

const DEFAULT_PAGE_SIZE = 6;
const VIEW_LIST = "list";
const VIEW_DETAIL = "detail";
const DETAIL_PANEL_ID = "mis-incidencias-inline-detail-panel";

const FALLBACK_PAGINATION = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

export default function MyIncidentsPageContent() {
  const router = useRouter();
  const [incidents, setIncidents] = useState([]);
  const [pagination, setPagination] = useState(FALLBACK_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [activeView, setActiveView] = useState(VIEW_LIST);
  const detailHeadingRef = useRef(null);
  const actionButtonRefs = useRef(new Map());
  const lastFocusedIncidentIdRef = useRef("");
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    const abortController = new AbortController();

    const loadIncidents = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch(
          `/api/incidents?page=${page}&pageSize=${DEFAULT_PAGE_SIZE}`,
          { signal: abortController.signal }
        );
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }

          throw new Error(data.error || "No se pudieron cargar tus incidencias.");
        }

        const loadedIncidents = data.incidents ?? [];
        const loadedPagination = data.pagination ?? FALLBACK_PAGINATION;
        setIncidents(loadedIncidents);
        setPagination({
          page: loadedPagination.page ?? page,
          pageSize: loadedPagination.pageSize ?? DEFAULT_PAGE_SIZE,
          total: loadedPagination.total ?? loadedIncidents.length,
          totalPages: loadedPagination.totalPages ?? 1,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setErrorMessage(error.message);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadIncidents();

    return () => {
      abortController.abort();
    };
  }, [page, router]);

  useEffect(() => {
    if (!selectedIncidentId) {
      return;
    }

    const selectedIncidentStillVisible = incidents.some(
      (incident) => incident.id === selectedIncidentId
    );

    if (selectedIncidentStillVisible) {
      return;
    }

    setSelectedIncidentId("");
    if (activeView === VIEW_DETAIL) {
      setActiveView(VIEW_LIST);
    }
  }, [activeView, incidents, selectedIncidentId]);

  useEffect(() => {
    if (activeView === VIEW_DETAIL) {
      detailHeadingRef.current?.focus();
    }
  }, [activeView, selectedIncidentId]);

  useEffect(() => {
    if (activeView !== VIEW_LIST || !shouldRestoreFocusRef.current) {
      return;
    }

    const lastFocusedButton = actionButtonRefs.current.get(
      lastFocusedIncidentIdRef.current
    );
    if (lastFocusedButton) {
      lastFocusedButton.focus();
    }
    shouldRestoreFocusRef.current = false;
  }, [activeView]);

  const hasPreviousPage = useMemo(() => pagination.page > 1, [pagination.page]);
  const hasNextPage = useMemo(
    () => pagination.page < pagination.totalPages,
    [pagination.page, pagination.totalPages]
  );
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) {
      return null;
    }

    return incidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  }, [incidents, selectedIncidentId]);
  const isShowingDetail = activeView === VIEW_DETAIL;

  const registerActionButtonRef = (incidentId) => (element) => {
    if (element) {
      actionButtonRefs.current.set(incidentId, element);
      return;
    }

    actionButtonRefs.current.delete(incidentId);
  };

  const handleOpenDetail = (incidentId) => {
    lastFocusedIncidentIdRef.current = incidentId;
    setSelectedIncidentId(incidentId);
    setActiveView(VIEW_DETAIL);
  };

  const handleBackToList = () => {
    shouldRestoreFocusRef.current = true;
    setActiveView(VIEW_LIST);
  };

  return (
    <section className="card my-incidents-inline" aria-live="polite">
      {isLoading ? (
        <p className="info-message" role="status" aria-live="polite">
          Cargando incidencias...
        </p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p className="error-message" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {!isLoading && !errorMessage && incidents.length === 0 ? (
        <p className="empty-message" role="status" aria-live="polite">
          Aun no tienes incidencias registradas.
        </p>
      ) : null}

      {!isLoading && !errorMessage && incidents.length > 0 ? (
        <div className="my-incidents-inline__viewport">
          <div
            className={`my-incidents-inline__track${
              isShowingDetail ? " my-incidents-inline__track--detail" : ""
            }`}
          >
            <section
              className="my-incidents-inline__panel my-incidents-inline__panel--list"
              aria-hidden={isShowingDetail}
              inert={isShowingDetail ? "" : undefined}
            >
              <ul
                className="incident-list incident-list--full"
                aria-label="Listado de mis incidencias"
              >
                {incidents.map((incident) => (
                  <IncidentListItem
                    key={incident.id}
                    incident={incident}
                    isSelected={selectedIncident?.id === incident.id}
                    onSelect={handleOpenDetail}
                    actionLabel="Ver detalle"
                    descriptionLimit={180}
                    actionButtonRef={registerActionButtonRef(incident.id)}
                    isActionDisabled={isShowingDetail}
                    actionAriaControls={DETAIL_PANEL_ID}
                    actionAriaExpanded={
                      isShowingDetail && selectedIncident?.id === incident.id
                    }
                  />
                ))}
              </ul>

              <nav className="pagination" aria-label="Paginacion de incidencias">
                <p className="small pagination__summary" aria-live="polite">
                  Pagina {pagination.page} de {pagination.totalPages || 1}. Total:{" "}
                  {pagination.total} incidencias.
                </p>
                <div className="pagination__actions">
                  <button
                    type="button"
                    className="button-link button-link--secondary button-link--compact"
                    onClick={() => setPage(Math.max(1, pagination.page - 1))}
                    disabled={!hasPreviousPage || isShowingDetail}
                    aria-label="Ir a la pagina anterior"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="button-link button-link--secondary button-link--compact"
                    onClick={() => setPage(pagination.page + 1)}
                    disabled={!hasNextPage || isShowingDetail}
                    aria-label="Ir a la pagina siguiente"
                  >
                    Siguiente
                  </button>
                </div>
              </nav>
            </section>

            <section
              id={DETAIL_PANEL_ID}
              className="my-incidents-inline__panel my-incidents-inline__panel--detail"
              aria-hidden={!isShowingDetail}
              inert={!isShowingDetail ? "" : undefined}
            >
              <IncidentCaseDetail
                incident={selectedIncident}
                headingRef={detailHeadingRef}
                headingId="mis-incidencias-detalle-heading"
                title="Detalle y seguimiento del caso"
                description="Revisa aqui toda la informacion del caso seleccionado, sin salir de Mis incidencias."
                backButtonLabel="Volver a mis incidencias"
                onBackButtonClick={handleBackToList}
                isBackButtonDisabled={!isShowingDetail}
              />
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}

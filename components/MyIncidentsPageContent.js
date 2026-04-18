"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import IncidentListItem from "./IncidentListItem";
import IncidentCaseDetail from "./IncidentCaseDetail";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

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
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const [incidents, setIncidents] = useState([]);
  const [pagination, setPagination] = useState(FALLBACK_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [activeView, setActiveView] = useState(VIEW_LIST);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const detailHeadingRef = useRef(null);
  const trackRef = useRef(null);
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

          throw new Error(data.error || copy.myIncidents.loadError);
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
  }, [copy.myIncidents.loadError, page, router]);

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
    const mediaQueryList = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleMotionPreferenceChange = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", handleMotionPreferenceChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleMotionPreferenceChange);
    };
  }, []);

  useEffect(() => {
    if (!prefersReducedMotion) {
      return;
    }

    if (activeView === VIEW_DETAIL) {
      detailHeadingRef.current?.focus();
      return;
    }

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
  }, [activeView, prefersReducedMotion]);

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
    shouldRestoreFocusRef.current = false;
    setSelectedIncidentId(incidentId);
    setActiveView(VIEW_DETAIL);
  };

  const handleBackToList = () => {
    shouldRestoreFocusRef.current = true;
    setActiveView(VIEW_LIST);
  };

  const handleTrackTransitionEnd = (event) => {
    if (event.target !== trackRef.current || event.propertyName !== "transform") {
      return;
    }

    if (activeView === VIEW_DETAIL) {
      detailHeadingRef.current?.focus();
      return;
    }

    if (!shouldRestoreFocusRef.current) {
      return;
    }

    const lastFocusedButton = actionButtonRefs.current.get(
      lastFocusedIncidentIdRef.current
    );
    if (lastFocusedButton) {
      lastFocusedButton.focus();
    }
    shouldRestoreFocusRef.current = false;
  };

  return (
    <section className="card my-incidents-inline" aria-live="polite">
      {isLoading ? (
        <p className="info-message" role="status" aria-live="polite">
          {copy.myIncidents.loading}
        </p>
      ) : null}

      {!isLoading && errorMessage ? (
        <p className="error-message" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {!isLoading && !errorMessage && incidents.length === 0 ? (
        <p className="empty-message" role="status" aria-live="polite">
          {copy.myIncidents.empty}
        </p>
      ) : null}

      {!isLoading && !errorMessage && incidents.length > 0 ? (
        <div className="my-incidents-inline__viewport">
          <div
            ref={trackRef}
            className={`my-incidents-inline__track${
              isShowingDetail ? " my-incidents-inline__track--detail" : ""
            }`}
            onTransitionEnd={handleTrackTransitionEnd}
          >
            <section
              className="my-incidents-inline__panel my-incidents-inline__panel--list"
              aria-hidden={isShowingDetail}
            >
              <ul
                className="incident-list incident-list--full"
                aria-label={copy.myIncidents.listAriaLabel}
              >
                {incidents.map((incident) => (
                  <IncidentListItem
                    key={incident.id}
                    incident={incident}
                    isSelected={selectedIncident?.id === incident.id}
                    onSelect={handleOpenDetail}
                    actionLabel={copy.myIncidents.actionViewDetail}
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

              <nav className="pagination" aria-label={copy.myIncidents.paginationAriaLabel}>
                <p className="small pagination__summary" aria-live="polite">
                  {copy.myIncidents.paginationSummary({
                    page: pagination.page,
                    totalPages: pagination.totalPages,
                    total: pagination.total,
                  })}
                </p>
                <div className="pagination__actions">
                  <button
                    type="button"
                    className="button-link button-link--secondary button-link--compact"
                    onClick={() => setPage(Math.max(1, pagination.page - 1))}
                    disabled={!hasPreviousPage || isShowingDetail}
                    aria-label={copy.myIncidents.prevPageAria}
                  >
                    {copy.myIncidents.prevPage}
                  </button>
                  <button
                    type="button"
                    className="button-link button-link--secondary button-link--compact"
                    onClick={() => setPage(pagination.page + 1)}
                    disabled={!hasNextPage || isShowingDetail}
                    aria-label={copy.myIncidents.nextPageAria}
                  >
                    {copy.myIncidents.nextPage}
                  </button>
                </div>
              </nav>
            </section>

            <section
              id={DETAIL_PANEL_ID}
              className="my-incidents-inline__panel my-incidents-inline__panel--detail"
              aria-hidden={!isShowingDetail}
            >
              <IncidentCaseDetail
                incident={selectedIncident}
                headingRef={detailHeadingRef}
                headingId="mis-incidencias-detalle-heading"
                title={copy.myIncidents.detailTitle}
                description={copy.myIncidents.detailDescription}
                backButtonLabel={copy.myIncidents.backToList}
                onBackButtonClick={handleBackToList}
                isBackButtonDisabled={!isShowingDetail}
                emptyStateMessage={copy.myIncidents.emptyDetail}
              />
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}

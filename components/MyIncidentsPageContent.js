"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import IncidentListItem from "./IncidentListItem";

const DEFAULT_PAGE_SIZE = 6;

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

  const hasPreviousPage = useMemo(() => pagination.page > 1, [pagination.page]);
  const hasNextPage = useMemo(
    () => pagination.page < pagination.totalPages,
    [pagination.page, pagination.totalPages]
  );

  return (
    <section className="card">
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
        <>
          <ul className="incident-list incident-list--full" aria-label="Listado de mis incidencias">
            {incidents.map((incident) => (
              <IncidentListItem
                key={incident.id}
                incident={incident}
                actionLabel="Ver detalle"
                actionHref={`/ciudadano/dashboard?incidentId=${incident.id}#detalle-caso`}
                descriptionLimit={180}
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
                disabled={!hasPreviousPage}
                aria-label="Ir a la pagina anterior"
              >
                Anterior
              </button>
              <button
                type="button"
                className="button-link button-link--secondary button-link--compact"
                onClick={() => setPage(pagination.page + 1)}
                disabled={!hasNextPage}
                aria-label="Ir a la pagina siguiente"
              >
                Siguiente
              </button>
            </div>
          </nav>
        </>
      ) : null}
    </section>
  );
}

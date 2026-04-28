"use client";

import { useState } from "react";
import BpmnProcessDiagramModal from "./BpmnProcessDiagramModal";

/**
 * Seguimiento operativo del trámite (BPMN + snapshot + historial local).
 * @param {{
 *   procedureRequestId: string,
 *   summary: Record<string, unknown>|null,
 *   summaryLoading: boolean,
 *   summaryError: string|null,
 *   camundaProcessState: string|null,
 * }} props
 */
export default function CaseProgressCard({
  procedureRequestId,
  summary,
  summaryLoading,
  summaryError,
  camundaProcessState,
}) {
  const [diagramOpen, setDiagramOpen] = useState(false);

  const visited = Array.isArray(summary?.visited) ? summary.visited : [];
  const current = summary?.current && typeof summary.current === "object" ? summary.current : null;
  const next = Array.isArray(summary?.next) ? summary.next : [];
  const hasFullHistory = summary?.hasFullHistory === true;
  const historyMessage = typeof summary?.message === "string" ? summary.message.trim() : "";

  const processStateUpper = String(camundaProcessState || "")
    .trim()
    .toUpperCase();
  const processFinished = ["COMPLETED", "TERMINATED", "CANCELED", "CANCELLED"].includes(processStateUpper);

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Seguimiento del trámite</h2>
          <p>Recorrido real del expediente según el proceso modelado.</p>
        </div>
      </div>

      {summaryLoading ? (
        <p className="funcionario-expediente-detail__flow-muted">Cargando resumen del proceso…</p>
      ) : null}

      {!summaryLoading && summaryError ? (
        <p className="funcionario-expediente-detail__flow-error">{summaryError}</p>
      ) : null}

      {!summaryLoading && !summaryError ? (
        <>
          <div className="funcionario-expediente-detail__flow-block">
            <h3 className="funcionario-expediente-detail__flow-heading">Recorrido registrado</h3>
            {visited.length === 0 ? (
              <p className="funcionario-expediente-detail__flow-muted">
                Todavía no hay historial suficiente para reconstruir pasos previos.
              </p>
            ) : (
              <ul className="funcionario-expediente-detail__flow-list">
                {visited.map((item) => (
                  <li key={String(item?.elementId || item?.label)} className="funcionario-expediente-detail__flow-item">
                    <span className="funcionario-expediente-detail__flow-check" aria-hidden="true">
                      ✓
                    </span>
                    <span>{String(item?.label || item?.elementId || "—")}</span>
                  </li>
                ))}
              </ul>
            )}
            {!hasFullHistory && historyMessage ? (
              <p className="funcionario-expediente-detail__flow-muted funcionario-expediente-detail__flow-note">
                {historyMessage}
              </p>
            ) : null}
          </div>

          <div className="funcionario-expediente-detail__flow-block">
            <h3 className="funcionario-expediente-detail__flow-heading">Paso actual</h3>
            {current?.label ? (
              <p className="funcionario-expediente-detail__flow-current">
                <span className="funcionario-expediente-detail__flow-bullet" aria-hidden="true">
                  ●
                </span>
                {String(current.label)}
              </p>
            ) : processFinished ? (
              <p className="funcionario-expediente-detail__flow-muted">El proceso en Camunda finalizó.</p>
            ) : (
              <p className="funcionario-expediente-detail__flow-muted">
                No hay una tarea activa visible en este momento para este expediente.
              </p>
            )}
          </div>

          <div className="funcionario-expediente-detail__flow-block">
            <h3 className="funcionario-expediente-detail__flow-heading">Siguiente paso</h3>
            {next.length === 0 ? (
              <p className="funcionario-expediente-detail__flow-muted">
                {current?.label
                  ? "No hay pasos siguientes modelados desde el nodo actual, o el proceso llegó a un punto final."
                  : "—"}
              </p>
            ) : next.length === 1 ? (
              <p className="funcionario-expediente-detail__flow-next-line">
                Siguiente:{" "}
                <strong>{String(next[0]?.targetLabel || next[0]?.targetElementId || "—")}</strong>
              </p>
            ) : (
              <>
                <p className="funcionario-expediente-detail__flow-next-intro">Posibles caminos:</p>
                <ul className="funcionario-expediente-detail__flow-alt-list">
                  {next.map((item, idx) => (
                    <li key={`${String(item?.targetElementId)}-${idx}`}>
                      <span className="funcionario-expediente-detail__flow-alt-cond">
                        {String(item?.conditionLabel || "Camino posible")}
                      </span>
                      <span className="funcionario-expediente-detail__flow-alt-arrow" aria-hidden="true">
                        {" "}
                        →{" "}
                      </span>
                      <strong>{String(item?.targetLabel || item?.targetElementId || "—")}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="funcionario-expediente-detail__flow-actions">
            <button
              type="button"
              className="dashboard-onify-btn dashboard-onify-btn--secondary funcionario-expediente-detail__flow-diagram-btn"
              onClick={() => setDiagramOpen(true)}
              disabled={!procedureRequestId}
            >
              Ver diagrama completo del proceso
            </button>
          </div>
        </>
      ) : null}

      <BpmnProcessDiagramModal
        isOpen={diagramOpen}
        onClose={() => setDiagramOpen(false)}
        procedureRequestId={procedureRequestId}
      />
    </section>
  );
}

import { DashboardIcon } from "../citizenProcedureUi";
import { humanizeProcedureEventLabel } from "../../lib/funcionarioExpedienteDetailWorkflow";

function formatEventTime(value, locale) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(locale || "es");
}

/**
 * Historial reciente legible (no técnico).
 */
export default function CaseRecentActivityCard({ events, locale, operativeStepLabel }) {
  const list = Array.isArray(events) ? events : [];
  const chronological = [...list]
    .sort((a, b) => {
      const ta = new Date(a?.createdAt || 0).getTime();
      const tb = new Date(b?.createdAt || 0).getTime();
      return ta - tb;
    })
    .slice(-8);

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Historial reciente</h2>
          <p>Últimos movimientos registrados en el expediente.</p>
        </div>
      </div>
      {chronological.length === 0 ? (
        <p className="dashboard-onify-empty">Todavía no hay eventos registrados en el historial.</p>
      ) : (
        <ul className="funcionario-expediente-detail__timeline">
          {chronological.map((event, index) => {
            const label = humanizeProcedureEventLabel(event?.type, event?.newStatus, event?.previousStatus);
            const time = formatEventTime(event?.createdAt, locale);
            return (
              <li key={event?.id || `${time}-${index}`} className="funcionario-expediente-detail__timeline-item">
                <span className="funcionario-expediente-detail__timeline-dot" aria-hidden="true" />
                <div>
                  <p className="funcionario-expediente-detail__timeline-time">{time || "—"}</p>
                  <p className="funcionario-expediente-detail__timeline-text">{label}</p>
                </div>
              </li>
            );
          })}
          {operativeStepLabel ? (
            <li className="funcionario-expediente-detail__timeline-item funcionario-expediente-detail__timeline-item--current">
              <span className="funcionario-expediente-detail__timeline-dot" aria-hidden="true" />
              <div>
                <p className="funcionario-expediente-detail__timeline-label">
                  <span className="funcionario-expediente-detail__timeline-label-icon" aria-hidden="true">
                    <DashboardIcon name="track" />
                  </span>
                  Paso actual
                </p>
                <p className="funcionario-expediente-detail__timeline-text">{operativeStepLabel}</p>
              </div>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

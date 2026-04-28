import Link from "next/link";
import { DashboardIcon } from "../citizenProcedureUi";

/**
 * Hero / encabezado del expediente (solo contenido interior de la página).
 */
export default function CaseHeader({
  trackingCode,
  procedureName,
  channel,
  createdAtLabel,
  expedienteStatusLabel,
  assignmentLabel,
  backHref = "/funcionario/dashboard",
}) {
  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__hero-card" aria-labelledby="func-expediente-detail-title">
      <div className="funcionario-expediente-detail__hero-top">
        <div className="funcionario-expediente-detail__hero-main">
          <p className="dashboard-onify-hero__eyebrow">Área del funcionario</p>
          <div className="funcionario-expediente-detail__hero-title-row">
            <h1 id="func-expediente-detail-title">Detalle del expediente</h1>
            {trackingCode ? (
              <>
                <span className="funcionario-expediente-detail__hero-sep" aria-hidden="true">
                  |
                </span>
                <span className="funcionario-expediente-detail__hero-code">{trackingCode}</span>
              </>
            ) : null}
          </div>
          <ul className="funcionario-expediente-detail__hero-meta dashboard-onify-meta-list" aria-label="Resumen del expediente">
            {procedureName ? (
              <li>
                <DashboardIcon name="type" />
                <span>
                  <strong>Tipo</strong> {procedureName}
                </span>
              </li>
            ) : null}
            {channel ? (
              <li>
                <DashboardIcon name="channel" />
                <span>
                  <strong>Canal</strong> {channel}
                </span>
              </li>
            ) : null}
            {createdAtLabel ? (
              <li>
                <DashboardIcon name="created" />
                <span>
                  <strong>Creado</strong> {createdAtLabel}
                </span>
              </li>
            ) : null}
            {expedienteStatusLabel ? (
              <li>
                <DashboardIcon name="status" />
                <span>
                  <strong>Estado</strong>{" "}
                  <span className="funcionario-expediente-detail__hero-status">{expedienteStatusLabel}</span>
                </span>
              </li>
            ) : null}
          </ul>
          {assignmentLabel ? (
            <div className="funcionario-expediente-detail__hero-badges">
              <span className="dashboard-onify-status-badge dashboard-onify-status-badge--progress">{assignmentLabel}</span>
            </div>
          ) : null}
        </div>
        <div className="funcionario-expediente-detail__hero-aside">
          <Link href={backHref} className="dashboard-onify-detail-btn funcionario-expediente-detail__back-btn">
            <span aria-hidden="true">←</span> Volver a la bandeja
          </Link>
        </div>
      </div>
    </section>
  );
}

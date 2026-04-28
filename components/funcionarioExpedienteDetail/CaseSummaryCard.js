import { DashboardIcon } from "../citizenProcedureUi";

/**
 * Ficha principal del caso con vista rápida integrada.
 */
export default function CaseSummaryCard({
  procedureName,
  caseDescription,
  locationValue,
  attachmentSummaryText,
  channel,
  createdAtLabel,
  quickImageSlot,
  quickLocationSlot,
}) {
  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Resumen del caso</h2>
          <p>Información enviada por la ciudadanía para tu gestión.</p>
        </div>
      </div>
      <div className="funcionario-expediente-detail__summary-body expediente-summary-layout">
        <div className="expediente-summary-layout__main funcionario-expediente-detail__summary-fields">
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="type" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Tipo de procedimiento</p>
              <p className="dashboard-onify-detail-field__value">{procedureName || "—"}</p>
            </div>
          </div>
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="summary" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Descripción</p>
              <p className="dashboard-onify-detail-field__value">{caseDescription || "Sin descripción informada."}</p>
            </div>
          </div>
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="location" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Ubicación</p>
              <p className="dashboard-onify-detail-field__value">{locationValue || "No informada"}</p>
            </div>
          </div>
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="file" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Imagen adjunta</p>
              <p className="dashboard-onify-detail-field__value">{attachmentSummaryText || "—"}</p>
            </div>
          </div>
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="channel" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Canal de origen</p>
              <p className="dashboard-onify-detail-field__value">{channel || "—"}</p>
            </div>
          </div>
          <div className="dashboard-onify-detail-field">
            <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
              <DashboardIcon name="created" />
            </span>
            <div className="dashboard-onify-detail-field__content">
              <p className="dashboard-onify-detail-field__label">Fecha de creación</p>
              <p className="dashboard-onify-detail-field__value">{createdAtLabel || "—"}</p>
            </div>
          </div>
        </div>
        {(quickImageSlot || quickLocationSlot) && (
          <aside className="expediente-summary-layout__quick funcionario-expediente-detail__summary-quick">
            <h3 className="funcionario-expediente-detail__summary-quick-title">Vista rápida</h3>
            <div className="expediente-summary-layout__quick-list">
              {quickImageSlot}
              {quickLocationSlot}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

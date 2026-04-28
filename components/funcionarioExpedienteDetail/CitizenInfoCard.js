import { DashboardIcon } from "../citizenProcedureUi";

function citizenLine(userId) {
  if (!userId) {
    return "No asociado";
  }
  return "Ciudadano con cuenta vinculada";
}

export default function CitizenInfoCard({ userId, whatsappPhone, email }) {
  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Datos del ciudadano / contacto</h2>
          <p>Canal de contacto registrado en el expediente.</p>
        </div>
      </div>
      <div className="funcionario-expediente-detail__citizen-grid">
        <div className="dashboard-onify-detail-field">
          <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
            <DashboardIcon name="open" />
          </span>
          <div className="dashboard-onify-detail-field__content">
            <p className="dashboard-onify-detail-field__label">Ciudadano asociado</p>
            <p className="dashboard-onify-detail-field__value">{citizenLine(userId)}</p>
          </div>
        </div>
        <div className="dashboard-onify-detail-field">
          <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
            <DashboardIcon name="channel" />
          </span>
          <div className="dashboard-onify-detail-field__content">
            <p className="dashboard-onify-detail-field__label">WhatsApp</p>
            <p className="dashboard-onify-detail-field__value">{whatsappPhone || "No informado"}</p>
          </div>
        </div>
        <div className="dashboard-onify-detail-field">
          <span className="dashboard-onify-detail-field__icon" aria-hidden="true">
            <DashboardIcon name="code" />
          </span>
          <div className="dashboard-onify-detail-field__content">
            <p className="dashboard-onify-detail-field__label">Correo electrónico</p>
            <p className="dashboard-onify-detail-field__value">{email || "No informado"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

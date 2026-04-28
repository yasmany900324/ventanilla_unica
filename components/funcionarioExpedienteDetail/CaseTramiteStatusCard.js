/**
 * Estado del trámite en lenguaje humano (panel lateral).
 */
export default function CaseTramiteStatusCard({
  currentStepLabel,
  operativeStepLabel,
  expedienteStatusLabel,
  taskAssigneeLabel,
  bandejaLabel,
  siguienteAccionLabel,
}) {
  const displayCurrent = String(currentStepLabel || operativeStepLabel || "").trim() || "—";

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__card--rail">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Estado del trámite</h2>
          <p>Lo esencial para ubicarte en el proceso.</p>
        </div>
      </div>
      <dl className="funcionario-expediente-detail__status-dl">
        <div className="funcionario-expediente-detail__status-row">
          <dt>Paso actual</dt>
          <dd>{operativeStepLabel || "—"}</dd>
        </div>
        <div className="funcionario-expediente-detail__status-row">
          <dt>Estado del expediente</dt>
          <dd>
            <span className="dashboard-onify-status-badge dashboard-onify-status-badge--received">
              {expedienteStatusLabel || "—"}
            </span>
          </dd>
        </div>
        <div className="funcionario-expediente-detail__status-row">
          <dt>Responsable de la tarea</dt>
          <dd>{taskAssigneeLabel || "—"}</dd>
        </div>
        <div className="funcionario-expediente-detail__status-row">
          <dt>Bandeja</dt>
          <dd>{bandejaLabel || "—"}</dd>
        </div>
        <div className="funcionario-expediente-detail__status-row funcionario-expediente-detail__status-row--accent">
          <dt>Siguiente acción</dt>
          <dd>{siguienteAccionLabel || "—"}</dd>
        </div>
      </dl>
      <p className="funcionario-expediente-detail__rail-current-step">Paso actual (proceso): {displayCurrent}</p>
    </section>
  );
}

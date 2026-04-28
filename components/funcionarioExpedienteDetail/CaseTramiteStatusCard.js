import { FUNCIONARIO_WORKFLOW_STEPS } from "../../lib/funcionarioExpedienteDetailWorkflow";

function MiniDots({ currentIndex }) {
  const safeIndex = Math.min(Math.max(Number(currentIndex) || 0, 0), FUNCIONARIO_WORKFLOW_STEPS.length - 1);
  return (
    <div className="funcionario-expediente-detail__mini-dots" aria-hidden="true">
      {FUNCIONARIO_WORKFLOW_STEPS.map((step, index) => (
        <span
          key={step.id}
          className={`funcionario-expediente-detail__mini-dot ${
            index < safeIndex
              ? "funcionario-expediente-detail__mini-dot--done"
              : index === safeIndex
                ? "funcionario-expediente-detail__mini-dot--current"
                : ""
          }`}
          title={step.label}
        />
      ))}
    </div>
  );
}

/**
 * Estado del trámite en lenguaje humano (panel lateral).
 */
export default function CaseTramiteStatusCard({
  currentStepIndex,
  operativeStepLabel,
  expedienteStatusLabel,
  taskAssigneeLabel,
  bandejaLabel,
  siguienteAccionLabel,
}) {
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
      <div className="funcionario-expediente-detail__mini-progress">
        <p className="funcionario-expediente-detail__mini-progress-label">Avance por etapas</p>
        <MiniDots currentIndex={currentStepIndex} />
      </div>
    </section>
  );
}

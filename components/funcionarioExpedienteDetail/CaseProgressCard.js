import { FUNCIONARIO_WORKFLOW_STEPS } from "../../lib/funcionarioExpedienteDetailWorkflow";
import { DashboardIcon } from "../citizenProcedureUi";

/**
 * Seguimiento visual del trámite (pasos institucionales, no BPMN).
 */
export default function CaseProgressCard({ currentIndex, instructionText }) {
  const safeIndex = Math.min(Math.max(Number(currentIndex) || 0, 0), FUNCIONARIO_WORKFLOW_STEPS.length - 1);

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Seguimiento del trámite</h2>
          <p>Recorrido aproximado del expediente en la gestión interna.</p>
        </div>
      </div>
      <ol className="funcionario-expediente-detail__stepper" aria-label="Etapas del trámite">
        {FUNCIONARIO_WORKFLOW_STEPS.map((step, index) => {
          const isComplete = index < safeIndex;
          const isCurrent = index === safeIndex;
          return (
            <li
              key={step.id}
              className={`funcionario-expediente-detail__step ${
                isCurrent
                  ? "funcionario-expediente-detail__step--current"
                  : isComplete
                    ? "funcionario-expediente-detail__step--done"
                    : "funcionario-expediente-detail__step--upcoming"
              }`}
            >
              <span className="funcionario-expediente-detail__step-index" aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span className="funcionario-expediente-detail__step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
      {instructionText ? (
        <p className="funcionario-expediente-detail__step-instruction">
          <span className="funcionario-expediente-detail__step-instruction-icon" aria-hidden="true">
            <DashboardIcon name="track" />
          </span>
          {instructionText}
        </p>
      ) : null}
    </section>
  );
}

import CompleteStepFormFields from "./CompleteStepFormFields";
import { buildActionDescription, buildActionTitle } from "../../lib/funcionarioExpedienteDetailActions";

/**
 * Formulario ancho para completar paso (debajo del seguimiento del trámite).
 */
export default function CompleteStepWideCard({
  action,
  onRunAction,
  actionLoadingKey,
  completeVariablesJson,
  setCompleteVariablesJson,
  internalObservation,
  setInternalObservation,
  nextStatus,
  setNextStatus,
}) {
  if (!action || action.actionKey !== "complete_task") {
    return null;
  }
  const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
  const title = buildActionTitle(action);
  const description = buildActionDescription(action);

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__complete-wide">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Completar este paso</h2>
          <p>Completá los datos y confirmá para avanzar el expediente en el proceso.</p>
        </div>
      </div>
      <div className="funcionario-expediente-detail__complete-wide-head">
        <h3 className="funcionario-expediente-detail__action-block-title">{title}</h3>
        {description ? <p className="funcionario-expediente-detail__action-block-desc">{description}</p> : null}
        {action.enabled === false && action.reason ? (
          <p className="funcionario-expediente-detail__action-block-muted">
            No disponible: {String(action.reason || "").replace(/_/g, " ").toLowerCase()}
          </p>
        ) : null}
      </div>
      <CompleteStepFormFields
        requiredVariables={action.requiredVariables}
        completeVariablesJson={completeVariablesJson}
        setCompleteVariablesJson={setCompleteVariablesJson}
        internalObservation={internalObservation}
        setInternalObservation={setInternalObservation}
        nextStatus={nextStatus}
        setNextStatus={setNextStatus}
        jsonTextareaId="func-exp-wide-complete-json"
        obsTextareaId="func-exp-wide-obs"
        nextStatusInputId="func-exp-wide-next-status"
      />
      <button
        type="button"
        className="dashboard-onify-btn funcionario-expediente-detail__cta"
        onClick={() => onRunAction(action)}
        disabled={action.enabled === false || actionLoadingKey === actionKey}
      >
        {actionLoadingKey === actionKey ? "Procesando…" : title}
      </button>
    </section>
  );
}

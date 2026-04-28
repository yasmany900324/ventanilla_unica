/**
 * Campos del formulario para completar paso (Camunda complete_task), reutilizable en rail o card ancha.
 */
export default function CompleteStepFormFields({
  requiredVariables,
  completeVariablesJson,
  setCompleteVariablesJson,
  internalObservation,
  setInternalObservation,
  nextStatus,
  setNextStatus,
  jsonTextareaId = "func-exp-complete-json",
  obsTextareaId = "func-exp-obs",
  nextStatusInputId = "func-exp-next-status",
}) {
  return (
    <div className="funcionario-expediente-detail__guided-form funcionario-expediente-detail__guided-form--wide">
      <ProcedureFieldChecklist requiredVariables={requiredVariables} />
      <label className="funcionario-expediente-detail__field-label" htmlFor={jsonTextareaId}>
        Valores adicionales (JSON, opcional)
      </label>
      <textarea
        id={jsonTextareaId}
        className="funcionario-expediente-detail__textarea"
        rows={5}
        value={completeVariablesJson}
        onChange={(event) => setCompleteVariablesJson(event.target.value)}
        spellCheck={false}
      />
      <label className="funcionario-expediente-detail__field-label" htmlFor={obsTextareaId}>
        Observaciones internas
      </label>
      <textarea
        id={obsTextareaId}
        className="funcionario-expediente-detail__textarea"
        rows={3}
        value={internalObservation}
        onChange={(event) => setInternalObservation(event.target.value)}
      />
      <label className="funcionario-expediente-detail__field-label" htmlFor={nextStatusInputId}>
        Cambio de estado local (opcional, uso avanzado)
      </label>
      <input
        id={nextStatusInputId}
        className="funcionario-expediente-detail__input"
        type="text"
        value={nextStatus}
        onChange={(event) => setNextStatus(event.target.value)}
        placeholder="Ej.: PENDING_BACKOFFICE_ACTION"
      />
    </div>
  );
}

function ProcedureFieldChecklist({ requiredVariables }) {
  if (!Array.isArray(requiredVariables) || requiredVariables.length === 0) {
    return null;
  }
  return (
    <div className="funcionario-expediente-detail__checklist-block">
      <p className="funcionario-expediente-detail__checklist-title">Datos que podés completar en este paso</p>
      <ul className="funcionario-expediente-detail__checklist">
        {requiredVariables.map((item, index) => (
          <li key={`${item.procedureFieldKey || "field"}-${index}`} className="funcionario-expediente-detail__checklist-item">
            <span className="funcionario-expediente-detail__checklist-bullet" aria-hidden="true">
              {item.required ? "●" : "○"}
            </span>
            <div>
              <p className="funcionario-expediente-detail__checklist-label">{item.fieldLabel || item.procedureFieldKey}</p>
              <details className="funcionario-expediente-detail__nested-details">
                <summary>Detalle técnico del campo</summary>
                <p className="funcionario-expediente-detail__nested-details-text">
                  Variable interna: <span className="admin-procedure-table__mono">{item.camundaVariableName}</span>
                  {item.camundaVariableType ? ` (${item.camundaVariableType})` : ""}
                </p>
              </details>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

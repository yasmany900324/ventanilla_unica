import CamundaTaskFormRenderer from "./CamundaTaskFormRenderer";

export default function CompleteStepFormFields({
  activeTaskForm,
  formValues,
  setFormValues,
  formValidationErrors,
  completeVariablesJson,
  setCompleteVariablesJson,
  internalObservation,
  setInternalObservation,
  nextStatus,
  setNextStatus,
  showAdvancedOptions = false,
  jsonTextareaId = "func-exp-complete-json",
  obsTextareaId = "func-exp-obs",
  nextStatusInputId = "func-exp-next-status",
}) {
  const formStatus = String(activeTaskForm?.status || "").trim().toLowerCase();
  const activeTaskName =
    String(activeTaskForm?.activeTask?.name || "").trim() ||
    String(activeTaskForm?.activeTask?.taskDefinitionKey || "").trim() ||
    "Tarea activa";
  return (
    <div className="funcionario-expediente-detail__guided-form funcionario-expediente-detail__guided-form--wide">
      <p className="funcionario-expediente-detail__checklist-title">{activeTaskName}</p>
      {formStatus === "ok" ? (
        <CamundaTaskFormRenderer
          schema={activeTaskForm?.form?.schema || null}
          values={formValues}
          onChange={(key, value) => setFormValues((prev) => ({ ...(prev || {}), [key]: value }))}
          validationErrors={formValidationErrors}
        />
      ) : null}
      {formStatus === "no_form" ? (
        <p className="funcionario-expediente-detail__action-block-muted">
          Esta tarea no tiene formulario asociado en Camunda.
        </p>
      ) : null}
      {formStatus === "error" ? (
        <p className="error-message">No se pudo obtener el formulario asociado a la tarea activa.</p>
      ) : null}

      {showAdvancedOptions ? (
        <details className="funcionario-expediente-detail__details">
          <summary>Opciones avanzadas / desarrollo</summary>
          <div className="funcionario-expediente-detail__details-body">
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
        </details>
      ) : null}
    </div>
  );
}

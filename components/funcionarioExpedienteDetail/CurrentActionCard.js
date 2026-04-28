import { buildActionDescription, buildActionTitle } from "../../lib/funcionarioExpedienteDetailActions";

function partitionPrimaryOperationalActions(actions) {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) {
    return { primary: null, secondary: [] };
  }
  const completeIdx = list.findIndex((a) => a?.actionKey === "complete_task");
  if (completeIdx >= 0) {
    const primary = list[completeIdx];
    const secondary = list.filter((_, i) => i !== completeIdx);
    return { primary, secondary };
  }
  return { primary: list[0], secondary: list.slice(1) };
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

function ActionBlock({
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
  const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
  const actionTitle = buildActionTitle(action);
  const actionDescription = buildActionDescription(action);
  const isPrimary = action.enabled !== false && (action.actionKey === "claim_task" || action.actionKey === "complete_task");
  const isSync = action.actionKey === "retry_camunda_sync";

  return (
    <div
      className={`funcionario-expediente-detail__action-block ${
        isPrimary ? "funcionario-expediente-detail__action-block--primary" : ""
      }`}
    >
      <div className="funcionario-expediente-detail__action-block-head">
        <h3 className="funcionario-expediente-detail__action-block-title">{actionTitle}</h3>
        {actionDescription ? <p className="funcionario-expediente-detail__action-block-desc">{actionDescription}</p> : null}
        {action.enabled === false && action.reason ? (
          <p className="funcionario-expediente-detail__action-block-muted">
            No disponible: {String(action.reason || "").replace(/_/g, " ").toLowerCase()}
          </p>
        ) : null}
      </div>
      {action.actionKey === "complete_task" ? (
        <div className="funcionario-expediente-detail__guided-form">
          <ProcedureFieldChecklist requiredVariables={action.requiredVariables} />
          <label className="funcionario-expediente-detail__field-label" htmlFor="func-exp-complete-json">
            Valores adicionales (JSON, opcional)
          </label>
          <textarea
            id="func-exp-complete-json"
            className="funcionario-expediente-detail__textarea"
            rows={5}
            value={completeVariablesJson}
            onChange={(event) => setCompleteVariablesJson(event.target.value)}
            spellCheck={false}
          />
          <label className="funcionario-expediente-detail__field-label" htmlFor="func-exp-obs">
            Observaciones internas
          </label>
          <textarea
            id="func-exp-obs"
            className="funcionario-expediente-detail__textarea"
            rows={3}
            value={internalObservation}
            onChange={(event) => setInternalObservation(event.target.value)}
          />
          <label className="funcionario-expediente-detail__field-label" htmlFor="func-exp-next-status">
            Cambio de estado local (opcional, uso avanzado)
          </label>
          <input
            id="func-exp-next-status"
            className="funcionario-expediente-detail__input"
            type="text"
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            placeholder="Ej.: PENDING_BACKOFFICE_ACTION"
          />
        </div>
      ) : null}
      <button
        type="button"
        className={`dashboard-onify-btn funcionario-expediente-detail__cta ${
          isPrimary ? "" : "funcionario-expediente-detail__cta--secondary"
        } ${isSync ? "funcionario-expediente-detail__cta--sync" : ""}`}
        onClick={() => onRunAction(action)}
        disabled={action.enabled === false || actionLoadingKey === actionKey}
      >
        {actionLoadingKey === actionKey ? "Procesando…" : actionTitle}
      </button>
    </div>
  );
}

/**
 * Tarjeta principal de acción y alertas operativas.
 */
export default function CurrentActionCard({
  headline,
  leadText,
  statusBadgeLabel,
  statusBadgeTone,
  primaryOperationalError,
  showActiveTaskApiMissBanner,
  activeTaskApiMissMessage,
  showCamundaSyncAlert,
  syncPrimaryButtonLabel,
  onRetryCamundaSync,
  isRetrySyncLoading,
  isAvailable,
  claimHint,
  claimAction,
  operationalActions,
  onRunAction,
  actionLoadingKey,
  completeVariablesJson,
  setCompleteVariablesJson,
  internalObservation,
  setInternalObservation,
  nextStatus,
  setNextStatus,
  emptyOperationalMessage,
}) {
  const { primary: primaryOperationalAction, secondary: secondaryOperationalActions } = partitionPrimaryOperationalActions(
    operationalActions
  );

  const toneClassMap = {
    warning: "dashboard-onify-status-badge--warning",
    review: "dashboard-onify-status-badge--review",
    progress: "dashboard-onify-status-badge--progress",
    waiting: "dashboard-onify-status-badge--waiting",
    resolved: "dashboard-onify-status-badge--resolved",
    neutral: "dashboard-onify-status-badge--neutral",
  };
  const toneClass = toneClassMap[statusBadgeTone] || toneClassMap.progress;

  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__card--action">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Qué tenés que hacer ahora</h2>
          <p>{leadText}</p>
        </div>
        {statusBadgeLabel ? (
          <span className={`dashboard-onify-status-badge ${toneClass}`}>{statusBadgeLabel}</span>
        ) : null}
      </div>

      {primaryOperationalError ? (
        <div className="funcionario-expediente-detail__alert funcionario-expediente-detail__alert--error" role="status">
          <p className="funcionario-expediente-detail__alert-title">Requiere atención</p>
          <p className="funcionario-expediente-detail__alert-body">{primaryOperationalError.message}</p>
        </div>
      ) : null}

      {showActiveTaskApiMissBanner ? (
        <div className="funcionario-expediente-detail__alert funcionario-expediente-detail__alert--info" role="status">
          <p className="funcionario-expediente-detail__alert-body">{activeTaskApiMissMessage}</p>
        </div>
      ) : null}

      {showCamundaSyncAlert ? (
        <div className="funcionario-expediente-detail__alert funcionario-expediente-detail__alert--warn" role="status">
          <p className="funcionario-expediente-detail__alert-title">Sincronización pendiente</p>
          <p className="funcionario-expediente-detail__alert-body">
            Este expediente necesita reenviarse al motor de procesos antes de continuar.
          </p>
          <button
            type="button"
            className="dashboard-onify-btn funcionario-expediente-detail__cta funcionario-expediente-detail__cta--sync"
            onClick={onRetryCamundaSync}
            disabled={isRetrySyncLoading}
          >
            {isRetrySyncLoading ? "Sincronizando…" : syncPrimaryButtonLabel}
          </button>
        </div>
      ) : null}

      <div className="funcionario-expediente-detail__action-headline">
        <p className="funcionario-expediente-detail__action-kicker">{headline}</p>
      </div>

      {isAvailable && claimHint ? (
        <p className="funcionario-expediente-detail__claim-hint">{claimHint}</p>
      ) : null}

      {claimAction && isAvailable ? (
        <ActionBlock
          action={claimAction}
          onRunAction={onRunAction}
          actionLoadingKey={actionLoadingKey}
          completeVariablesJson={completeVariablesJson}
          setCompleteVariablesJson={setCompleteVariablesJson}
          internalObservation={internalObservation}
          setInternalObservation={setInternalObservation}
          nextStatus={nextStatus}
          setNextStatus={setNextStatus}
        />
      ) : null}

      {!isAvailable && primaryOperationalAction ? (
        <div className="funcionario-expediente-detail__action-stack">
          <ActionBlock
            key={`${primaryOperationalAction.actionKey || "action"}:${primaryOperationalAction.endpoint}`}
            action={primaryOperationalAction}
            onRunAction={onRunAction}
            actionLoadingKey={actionLoadingKey}
            completeVariablesJson={completeVariablesJson}
            setCompleteVariablesJson={setCompleteVariablesJson}
            internalObservation={internalObservation}
            setInternalObservation={setInternalObservation}
            nextStatus={nextStatus}
            setNextStatus={setNextStatus}
          />
          {secondaryOperationalActions.length > 0 ? (
            <details className="funcionario-expediente-detail__details funcionario-expediente-detail__details--actions">
              <summary>Otras acciones disponibles</summary>
              <div className="funcionario-expediente-detail__details-body funcionario-expediente-detail__action-stack">
                {secondaryOperationalActions.map((action) => (
                  <ActionBlock
                    key={`${action.actionKey || "action"}:${action.endpoint}`}
                    action={action}
                    onRunAction={onRunAction}
                    actionLoadingKey={actionLoadingKey}
                    completeVariablesJson={completeVariablesJson}
                    setCompleteVariablesJson={setCompleteVariablesJson}
                    internalObservation={internalObservation}
                    setInternalObservation={setInternalObservation}
                    nextStatus={nextStatus}
                    setNextStatus={setNextStatus}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {!isAvailable && operationalActions.length === 0 && !showCamundaSyncAlert ? (
        <p className="dashboard-onify-empty">{emptyOperationalMessage}</p>
      ) : null}
    </section>
  );
}

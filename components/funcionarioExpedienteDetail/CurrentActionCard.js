import {
  buildActionDescription,
  buildActionTitle,
  partitionPrimaryOperationalActions,
} from "../../lib/funcionarioExpedienteDetailActions";
import CompleteStepFormFields from "./CompleteStepFormFields";

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
  titleOverride,
  descriptionOverride,
}) {
  const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
  const actionTitle = titleOverride != null && String(titleOverride).trim() ? String(titleOverride).trim() : buildActionTitle(action);
  const actionDescription =
    descriptionOverride != null && String(descriptionOverride).trim()
      ? String(descriptionOverride).trim()
      : buildActionDescription(action);
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
        <CompleteStepFormFields
          requiredVariables={action.requiredVariables}
          completeVariablesJson={completeVariablesJson}
          setCompleteVariablesJson={setCompleteVariablesJson}
          internalObservation={internalObservation}
          setInternalObservation={setInternalObservation}
          nextStatus={nextStatus}
          setNextStatus={setNextStatus}
        />
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
 * Tarjeta principal de acción y alertas operativas (columna derecha).
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
  railBlockMessage,
  railFinishedMessage,
  showExpedienteClaimSection = true,
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

      {railFinishedMessage ? (
        <div className="funcionario-expediente-detail__alert funcionario-expediente-detail__alert--info" role="status">
          <p className="funcionario-expediente-detail__alert-title">{railFinishedMessage}</p>
        </div>
      ) : null}

      {railBlockMessage ? (
        <div className="funcionario-expediente-detail__alert funcionario-expediente-detail__alert--warn" role="status">
          <p className="funcionario-expediente-detail__alert-body">{railBlockMessage}</p>
        </div>
      ) : null}

      <div className="funcionario-expediente-detail__action-headline">
        <p className="funcionario-expediente-detail__action-kicker">{headline}</p>
      </div>

      {isAvailable && showExpedienteClaimSection && claimHint ? (
        <p className="funcionario-expediente-detail__claim-hint">{claimHint}</p>
      ) : null}

      {claimAction && isAvailable && showExpedienteClaimSection ? (
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
          titleOverride="Tomar expediente"
          descriptionOverride="Asigná este expediente a tu bandeja para habilitar la gestión y las acciones del proceso."
        />
      ) : null}

      {!isAvailable && !railBlockMessage && !railFinishedMessage && primaryOperationalAction ? (
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

      {!isAvailable &&
      operationalActions.length === 0 &&
      !showCamundaSyncAlert &&
      !railBlockMessage &&
      !railFinishedMessage ? (
        <p className="dashboard-onify-empty">{emptyOperationalMessage}</p>
      ) : null}
    </section>
  );
}

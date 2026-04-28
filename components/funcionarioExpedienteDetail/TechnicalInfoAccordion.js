/**
 * Información técnica colapsada (Camunda, IDs, variables).
 */
export default function TechnicalInfoAccordion({
  extraOperationalErrors,
  camundaProcessStateDisplay,
  camundaTaskStateDisplay,
  activeTaskId,
  taskDefinitionKey,
  camundaLiveProcessInstanceKey,
  camundaTaskAssigneeCamundaLabel,
  operationalSituation,
  activeTaskDisplayTitle,
  procedureRequestId,
  assignedToUserId,
  collectedDataJson,
  camundaProcessInstanceKey,
  camundaProcessDefinitionId,
  camundaError,
  camundaMetadataJson,
  historyJson,
}) {
  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__card--technical">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Información técnica</h2>
          <p>Datos de diagnóstico para equipos de sistemas. Colapsado por defecto.</p>
        </div>
      </div>
      <div className="funcionario-expediente-detail__accordion">
        {Array.isArray(extraOperationalErrors) && extraOperationalErrors.length > 0 ? (
          <details className="funcionario-expediente-detail__details">
            <summary>Mensajes operativos adicionales</summary>
            <div className="funcionario-expediente-detail__details-body">
              <ul className="funcionario-expediente-detail__checklist">
                {extraOperationalErrors.map((item, index) => (
                  <li key={index} className="funcionario-expediente-detail__checklist-item">
                    <span className="funcionario-expediente-detail__checklist-bullet" aria-hidden="true">
                      •
                    </span>
                    <p className="funcionario-expediente-detail__checklist-label">{item?.message || String(item)}</p>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}

        <details className="funcionario-expediente-detail__details">
          <summary>Snapshot del proceso (motor de tareas)</summary>
          <div className="funcionario-expediente-detail__details-body">
            <p className="small">
              <strong>Estado del proceso:</strong> {camundaProcessStateDisplay}
            </p>
            <p className="small">
              <strong>Estado de la tarea:</strong> {camundaTaskStateDisplay}
            </p>
            <p className="small">
              <strong>ID de tarea:</strong>{" "}
              <span className="admin-procedure-table__mono">{activeTaskId || "—"}</span>
            </p>
            <p className="small">
              <strong>Clave de definición (elemento):</strong>{" "}
              <span className="admin-procedure-table__mono">{taskDefinitionKey || "—"}</span>
            </p>
            <p className="small">
              <strong>Instancia (en vivo):</strong>{" "}
              <span className="admin-procedure-table__mono">{camundaLiveProcessInstanceKey || "—"}</span>
            </p>
            <p className="small">
              <strong>Responsable técnico (asignatario):</strong>{" "}
              <span className="admin-procedure-table__mono">{camundaTaskAssigneeCamundaLabel}</span>
            </p>
            <p className="small">
              <strong>Situación (diagnóstico):</strong> {operationalSituation}
            </p>
            {activeTaskDisplayTitle ? (
              <p className="small">
                <strong>Título técnico de tarea:</strong>{" "}
                <span className="admin-procedure-table__mono">{activeTaskDisplayTitle}</span>
              </p>
            ) : null}
          </div>
        </details>

        <details className="funcionario-expediente-detail__details">
          <summary>Datos técnicos del expediente</summary>
          <div className="funcionario-expediente-detail__details-body">
            <p className="small">
              <strong>ID interno:</strong>{" "}
              <span className="admin-procedure-table__mono">{procedureRequestId}</span>
            </p>
            <p className="small">
              <strong>UUID responsable (local):</strong>{" "}
              <span className="admin-procedure-table__mono">{assignedToUserId || "—"}</span>
            </p>
            <pre className="admin-procedure-table__mono funcionario-expediente-detail__pre">{collectedDataJson}</pre>
          </div>
        </details>

        <details className="funcionario-expediente-detail__details">
          <summary>Variables del proceso</summary>
          <div className="funcionario-expediente-detail__details-body">
            <p className="small">
              <strong>Instancia:</strong> {camundaProcessInstanceKey || "—"}
            </p>
            <p className="small">
              <strong>Definición:</strong> {camundaProcessDefinitionId || "—"}
            </p>
            <p className="small">
              <strong>Error de sincronización:</strong> {camundaError || "Sin errores"}
            </p>
            <pre className="admin-procedure-table__mono funcionario-expediente-detail__pre">{camundaMetadataJson}</pre>
          </div>
        </details>

        <details className="funcionario-expediente-detail__details">
          <summary>Historial técnico (eventos crudos)</summary>
          <pre className="admin-procedure-table__mono funcionario-expediente-detail__pre">{historyJson}</pre>
        </details>
      </div>
    </section>
  );
}

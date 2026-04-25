"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function ProcedureList({ items }) {
  if (!items?.length) {
    return <span className="admin-roles-confirm-dialog__muted">—</span>;
  }
  return (
    <div className="admin-assignment-confirm-dialog__list">
      {items.map((item) => (
        <span key={item.id} className="badge badge--recibido">
          {item.name} ({item.code || "SIN_CODIGO"})
        </span>
      ))}
    </div>
  );
}

function ConfirmProcedureAssignmentsModalDialog({
  titleId,
  describedByIds,
  descLeadId,
  descDetailsId,
  agentName,
  agentEmail,
  previousProcedures,
  selectedProcedures,
  errorMessage,
  isSubmitting,
  onCancel,
  onConfirm,
}) {
  const cancelButtonRef = useRef(null);

  const handleBackdropClick = useCallback(
    (event) => {
      if (isSubmitting) {
        return;
      }
      if (event.target === event.currentTarget) {
        onCancel();
      }
    },
    [isSubmitting, onCancel]
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }
      if (isSubmitting) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onCancel]);

  useEffect(() => {
    const node = cancelButtonRef.current;
    if (!node || isSubmitting) {
      return undefined;
    }
    const raf = window.requestAnimationFrame(() => node.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [agentName, agentEmail, isSubmitting, previousProcedures, selectedProcedures]);

  return (
    <div
      className="admin-roles-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={describedByIds}
      onClick={handleBackdropClick}
    >
      <section className="admin-roles-confirm-dialog__panel" onClick={(event) => event.stopPropagation()}>
        <header className="admin-roles-confirm-dialog__header">
          <h2 id={titleId} className="admin-roles-confirm-dialog__title" tabIndex={-1}>
            Confirmar asignación de procedimientos
          </h2>
        </header>

        <p id={descLeadId} className="admin-roles-confirm-dialog__lead">
          Se reemplazarán las asignaciones actuales del funcionario seleccionado.
        </p>

        <dl className="admin-roles-confirm-dialog__details" id={descDetailsId}>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Nombre</dt>
            <dd>{agentName || "—"}</dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Email</dt>
            <dd>{agentEmail || "—"}</dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Procedimientos actuales</dt>
            <dd>
              <ProcedureList items={previousProcedures} />
            </dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Procedimientos seleccionados</dt>
            <dd>
              <ProcedureList items={selectedProcedures} />
            </dd>
          </div>
        </dl>

        {errorMessage ? (
          <p className="admin-roles-confirm-dialog__error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="admin-roles-confirm-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="admin-roles-confirm-dialog__button admin-roles-confirm-dialog__button--ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="admin-roles-confirm-dialog__button"
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Guardando..." : "Confirmar cambios"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ConfirmProcedureAssignmentsModal({
  isOpen,
  agentName,
  agentEmail,
  previousProcedures,
  selectedProcedures,
  errorMessage,
  isSubmitting,
  onCancel,
  onConfirm,
}) {
  const isClient = useIsClient();
  const reactId = useId();
  const titleId = `admin-procedure-assignments-confirm-title-${reactId}`;
  const descLeadId = `admin-procedure-assignments-confirm-lead-${reactId}`;
  const descDetailsId = `admin-procedure-assignments-confirm-details-${reactId}`;
  const describedByIds = `${descLeadId} ${descDetailsId}`;

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isClient || !isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <ConfirmProcedureAssignmentsModalDialog
      titleId={titleId}
      describedByIds={describedByIds}
      descLeadId={descLeadId}
      descDetailsId={descDetailsId}
      agentName={agentName}
      agentEmail={agentEmail}
      previousProcedures={previousProcedures}
      selectedProcedures={selectedProcedures}
      errorMessage={errorMessage}
      isSubmitting={isSubmitting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
    document.body
  );
}

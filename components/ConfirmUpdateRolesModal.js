"use client";

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const emptySubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function getFriendlyRoleLabel(role) {
  const normalized = String(role || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (normalized === "administrador") {
    return "Administrador";
  }
  if (normalized === "agente") {
    return "Funcionario";
  }
  return "Ciudadano";
}

function RoleBadgeList({ roles }) {
  if (!roles?.length) {
    return <span className="admin-roles-confirm-dialog__muted">—</span>;
  }
  return (
    <div className="admin-roles-confirm-dialog__badges">
      {roles.map((role) => (
        <span key={role} className="badge badge--recibido">
          {getFriendlyRoleLabel(role)}
        </span>
      ))}
    </div>
  );
}

function ConfirmUpdateRolesModalDialog({
  titleId,
  describedByIds,
  descLeadId,
  descDetailsId,
  userDisplayName,
  userEmail,
  currentRoles,
  nextRoles,
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
      if (event.key === "Escape") {
        if (isSubmitting) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSubmitting, onCancel]);

  useEffect(() => {
    const node = cancelButtonRef.current;
    if (!node || isSubmitting) {
      return undefined;
    }
    const id = window.requestAnimationFrame(() => {
      node.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isSubmitting, userDisplayName, userEmail, currentRoles, nextRoles]);

  return (
    <div
      className="admin-roles-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={describedByIds}
      aria-busy={isSubmitting}
      onClick={handleBackdropClick}
    >
      <section
        className="admin-roles-confirm-dialog__panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-roles-confirm-dialog__header">
          <h2 id={titleId} className="admin-roles-confirm-dialog__title" tabIndex={-1}>
            Confirmar actualización de roles
          </h2>
        </header>

        <p id={descLeadId} className="admin-roles-confirm-dialog__lead">
          Vas a actualizar los roles de este usuario. ¿Deseas continuar?
        </p>

        <dl className="admin-roles-confirm-dialog__details" id={descDetailsId}>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Nombre</dt>
            <dd>{userDisplayName || "—"}</dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Email</dt>
            <dd>{userEmail || "—"}</dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Roles actuales</dt>
            <dd>
              <RoleBadgeList roles={currentRoles} />
            </dd>
          </div>
          <div className="admin-roles-confirm-dialog__detail-row">
            <dt>Roles seleccionados</dt>
            <dd>
              <RoleBadgeList roles={nextRoles} />
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
            {isSubmitting ? "Guardando..." : "Confirmar cambio"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ConfirmUpdateRolesModal({
  isOpen,
  userDisplayName,
  userEmail,
  currentRoles,
  nextRoles,
  errorMessage,
  isSubmitting,
  onCancel,
  onConfirm,
}) {
  const isClient = useIsClient();
  const reactId = useId();
  const titleId = `admin-roles-confirm-title-${reactId}`;
  const descLeadId = `admin-roles-confirm-lead-${reactId}`;
  const descDetailsId = `admin-roles-confirm-details-${reactId}`;
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
    <ConfirmUpdateRolesModalDialog
      titleId={titleId}
      describedByIds={describedByIds}
      descLeadId={descLeadId}
      descDetailsId={descDetailsId}
      userDisplayName={userDisplayName}
      userEmail={userEmail}
      currentRoles={currentRoles}
      nextRoles={nextRoles}
      errorMessage={errorMessage}
      isSubmitting={isSubmitting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
    document.body
  );
}

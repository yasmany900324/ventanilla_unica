"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const emptySubscribe = () => () => {};
const CODE_PATTERN = /^[a-z0-9_]+$/;

function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function normalizeSimpleText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCode(value) {
  return normalizeSimpleText(value, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 120);
}

function DuplicateProcedureModalDialog({
  titleId,
  describedByIds,
  isSubmitting,
  procedureName,
  initialName,
  initialCode,
  onCancel,
  onConfirm,
  requestErrorMessage,
}) {
  const cancelButtonRef = useRef(null);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [copyFields, setCopyFields] = useState(true);
  const [copyCamunda, setCopyCamunda] = useState(false);
  const [copyAssignments, setCopyAssignments] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setName(initialName);
    setCode(initialCode);
    setCopyFields(true);
    setCopyCamunda(false);
    setCopyAssignments(false);
    setLocalError("");
  }, [initialCode, initialName]);

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
  }, [isSubmitting, procedureName]);

  const submit = useCallback(() => {
    const normalizedName = normalizeSimpleText(name, 160);
    const normalizedCode = normalizeCode(code);
    if (!normalizedName) {
      setLocalError("El nombre es obligatorio.");
      return;
    }
    if (!normalizedCode) {
      setLocalError("El código es obligatorio.");
      return;
    }
    if (!CODE_PATTERN.test(normalizedCode)) {
      setLocalError("El código debe ser lowercase, snake_case y contener solo letras, números o guion bajo.");
      return;
    }
    if (copyCamunda && !copyFields) {
      setLocalError("No puedes copiar Camunda/BPMN si no copias campos configurados.");
      return;
    }
    setLocalError("");
    onConfirm({
      newName: normalizedName,
      newCode: normalizedCode,
      copyFields,
      copyCamunda,
      copyAssignments,
    });
  }, [code, copyAssignments, copyCamunda, copyFields, name, onConfirm]);

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
            Duplicar procedimiento
          </h2>
        </header>

        <p className="admin-roles-confirm-dialog__lead">
          Se creará una copia de <strong>{procedureName || "este procedimiento"}</strong>.
        </p>
        <p className="small">El nuevo procedimiento siempre se creará inactivo.</p>

        <div className="admin-procedure-fields__edit" style={{ marginTop: 12 }}>
          <label htmlFor="duplicate-procedure-name">Nombre sugerido *</label>
          <input
            id="duplicate-procedure-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isSubmitting}
          />
          <label htmlFor="duplicate-procedure-code">Código sugerido *</label>
          <input
            id="duplicate-procedure-code"
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="admin-procedure-channels" style={{ marginTop: 12 }}>
          <label className="admin-procedure-channel">
            <input
              type="checkbox"
              checked={copyFields}
              onChange={(event) => setCopyFields(event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Copiar campos configurados</span>
          </label>
          <label className="admin-procedure-channel">
            <input
              type="checkbox"
              checked={copyCamunda}
              onChange={(event) => setCopyCamunda(event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Copiar configuración Camunda/BPMN</span>
          </label>
          <label className="admin-procedure-channel">
            <input
              type="checkbox"
              checked={copyAssignments}
              onChange={(event) => setCopyAssignments(event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Copiar asignaciones/permisos</span>
          </label>
        </div>

        {localError || requestErrorMessage ? (
          <p className="admin-roles-confirm-dialog__error" role="alert">
            {localError || requestErrorMessage}
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
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Duplicando..." : "Duplicar"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function DuplicateProcedureModal({
  isOpen,
  procedureName,
  initialName,
  initialCode,
  isSubmitting,
  requestErrorMessage,
  onCancel,
  onConfirm,
}) {
  const isClient = useIsClient();
  const reactId = useId();
  const titleId = `admin-procedure-duplicate-title-${reactId}`;
  const describedByIds = `admin-procedure-duplicate-desc-${reactId}`;

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
    <DuplicateProcedureModalDialog
      titleId={titleId}
      describedByIds={describedByIds}
      isSubmitting={isSubmitting}
      procedureName={procedureName}
      initialName={initialName}
      initialCode={initialCode}
      onCancel={onCancel}
      onConfirm={onConfirm}
      requestErrorMessage={requestErrorMessage}
    />,
    document.body
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import "./BpmnProcessDiagramModal.css";

const LOAD_ERROR_USER_MESSAGE = "No se pudo cargar el diagrama BPMN del proceso.";

/**
 * Modal grande con diagrama BPMN (Camunda) usando bpmn-js.
 * @param {{ isOpen: boolean, onClose: () => void, procedureRequestId: string }} props
 */
export default function BpmnProcessDiagramModal({ isOpen, onClose, procedureRequestId }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!isOpen || !procedureRequestId) {
      return undefined;
    }
    let cancelled = false;

    const destroyViewer = () => {
      if (viewerRef.current) {
        try {
          viewerRef.current.destroy();
        } catch {
          /* ignore */
        }
        viewerRef.current = null;
      }
    };

    const run = async () => {
      setPhase("loading");
      setErrorText("");
      destroyViewer();
      try {
        const res = await fetch(
          `/api/funcionario/procedures/requests/${encodeURIComponent(procedureRequestId)}/bpmn-xml`,
          { cache: "no-store" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" && data.error.trim() ? data.error : LOAD_ERROR_USER_MESSAGE);
        }
        const xml = typeof data?.bpmnXml === "string" ? data.bpmnXml : "";
        if (!xml.trim()) {
          throw new Error(LOAD_ERROR_USER_MESSAGE);
        }
        if (cancelled) {
          return;
        }
        const mod = await import("bpmn-js/lib/NavigatedViewer");
        const NavigatedViewer = mod.default;
        if (cancelled || !containerRef.current) {
          return;
        }
        const viewer = new NavigatedViewer({ container: containerRef.current });
        viewerRef.current = viewer;
        await viewer.importXML(xml);
        const canvas = viewer.get("canvas");
        canvas.zoom("fit-viewport", "auto");
        const markId = typeof data?.activeElementId === "string" ? data.activeElementId.trim() : "";
        if (markId) {
          try {
            canvas.addMarker(markId, "highlight");
          } catch {
            /* elemento no presente en el diagrama */
          }
        }
        if (!cancelled) {
          setPhase("ready");
        }
      } catch (e) {
        destroyViewer();
        if (!cancelled) {
          setPhase("error");
          setErrorText(e?.message || LOAD_ERROR_USER_MESSAGE);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
      destroyViewer();
    };
  }, [isOpen, procedureRequestId]);

  useEffect(() => {
    if (!isOpen) {
      setPhase("idle");
      setErrorText("");
    }
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="funcionario-bpmn-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="funcionario-bpmn-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
    >
      <div className="funcionario-bpmn-modal__dialog">
        <div className="funcionario-bpmn-modal__head">
          <h2 id="funcionario-bpmn-modal-title">Diagrama completo del proceso</h2>
          <button type="button" className="funcionario-bpmn-modal__close" onClick={onClose}>
            Cerrar
          </button>
        </div>
        <div className="funcionario-bpmn-modal__body">
          <div ref={containerRef} className="funcionario-bpmn-modal__canvas" aria-hidden={phase !== "ready"} />
          {phase === "loading" ? (
            <div className="funcionario-bpmn-modal__message">Cargando diagrama…</div>
          ) : null}
          {phase === "error" ? (
            <div className="funcionario-bpmn-modal__message funcionario-bpmn-modal__message--error">{errorText}</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

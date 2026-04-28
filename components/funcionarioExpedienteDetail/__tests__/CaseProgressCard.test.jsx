/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CaseProgressCard from "../CaseProgressCard";

vi.mock("../BpmnProcessDiagramModal", () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("CaseProgressCard", () => {
  it("no muestra pasos genéricos hardcodeados (Datos iniciales / Revisión / …)", () => {
    render(
      <CaseProgressCard
        procedureRequestId="pr-1"
        summary={{
          visited: [],
          current: null,
          next: [],
          hasFullDiagram: true,
          hasFullHistory: false,
          activeElementId: null,
          message: "El recorrido completo se mostrará cuando exista historial suficiente.",
        }}
        summaryLoading={false}
        summaryError={null}
        camundaProcessState="ACTIVE"
      />
    );
    expect(screen.queryByText("Datos iniciales")).toBeNull();
    expect(screen.queryByText("Revisión")).toBeNull();
    expect(screen.queryByText("Atención")).toBeNull();
  });

  it("renderiza visited con check", () => {
    render(
      <CaseProgressCard
        procedureRequestId="pr-1"
        summary={{
          visited: [{ elementId: "UserTask_A", label: "Registrar Datos Iniciales", type: "userTask" }],
          current: { elementId: "UserTask_B", label: "Revisar Incidencia", type: "userTask" },
          next: [],
          hasFullDiagram: true,
          hasFullHistory: true,
          activeElementId: "UserTask_B",
          message: null,
        }}
        summaryLoading={false}
        summaryError={null}
        camundaProcessState="ACTIVE"
      />
    );
    expect(screen.getByText("Registrar Datos Iniciales")).toBeTruthy();
    expect(screen.getByText("Revisar Incidencia")).toBeTruthy();
  });

  it("muestra alternativas cuando next tiene varios caminos", () => {
    render(
      <CaseProgressCard
        procedureRequestId="pr-1"
        summary={{
          visited: [],
          current: { elementId: "UserTask_B", label: "Revisar Incidencia", type: "userTask" },
          next: [
            {
              conditionLabel: "Si se requiere intervención",
              targetElementId: "c1",
              targetLabel: "Atender",
              targetType: "userTask",
            },
            { conditionLabel: "Si no se requiere", targetElementId: "e1", targetLabel: "Cerrado", targetType: "endEvent" },
          ],
          hasFullDiagram: true,
          hasFullHistory: false,
          activeElementId: "UserTask_B",
          message: "El recorrido completo se mostrará cuando exista historial suficiente.",
        }}
        summaryLoading={false}
        summaryError={null}
        camundaProcessState="ACTIVE"
      />
    );
    expect(screen.getByText("Posibles caminos:")).toBeTruthy();
    expect(screen.getByText("Si se requiere intervención")).toBeTruthy();
    expect(screen.getByText("Atender")).toBeTruthy();
  });

  it("muestra mensaje de historial incompleto", () => {
    const msg = "El recorrido completo se mostrará cuando exista historial suficiente.";
    render(
      <CaseProgressCard
        procedureRequestId="pr-1"
        summary={{
          visited: [],
          current: { elementId: "x", label: "Actual", type: "userTask" },
          next: [],
          hasFullDiagram: true,
          hasFullHistory: false,
          activeElementId: "x",
          message: msg,
        }}
        summaryLoading={false}
        summaryError={null}
        camundaProcessState="ACTIVE"
      />
    );
    expect(screen.getByText(msg)).toBeTruthy();
  });

  it("renderiza botón de diagrama completo", () => {
    render(
      <CaseProgressCard
        procedureRequestId="pr-9"
        summary={{
          visited: [],
          current: null,
          next: [],
          hasFullDiagram: true,
          hasFullHistory: false,
          activeElementId: null,
          message: null,
        }}
        summaryLoading={false}
        summaryError={null}
        camundaProcessState="COMPLETED"
      />
    );
    const btn = screen.getByRole("button", { name: /Ver diagrama completo del proceso/i });
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
  });
});

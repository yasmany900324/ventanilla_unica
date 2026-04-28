/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CompleteStepFormFields from "../CompleteStepFormFields";

afterEach(() => {
  cleanup();
});

function baseProps(overrides = {}) {
  return {
    activeTaskForm: {
      status: "ok",
      activeTask: {
        name: "Registrar Datos Iniciales",
      },
      form: {
        schema: {
          components: [
            { type: "textfield", key: "observacionResolucion", label: "Observación", required: true },
            { type: "checkbox", key: "incidenciaResuelta", label: "Incidencia resuelta" },
          ],
        },
      },
    },
    formValues: {},
    setFormValues: () => {},
    formValidationErrors: {},
    completeVariablesJson: "{}",
    setCompleteVariablesJson: () => {},
    internalObservation: "",
    setInternalObservation: () => {},
    nextStatus: "",
    setNextStatus: () => {},
    showAdvancedOptions: false,
    ...overrides,
  };
}

describe("CompleteStepFormFields", () => {
  it("renderiza formulario Camunda cuando status ok", () => {
    render(<CompleteStepFormFields {...baseProps()} />);
    expect(screen.getByText("Registrar Datos Iniciales")).toBeTruthy();
    expect(screen.getByLabelText("Observación *")).toBeTruthy();
    expect(screen.getByLabelText("Incidencia resuelta")).toBeTruthy();
    expect(screen.queryByText("Valores adicionales (JSON, opcional)")).toBeNull();
  });

  it("muestra validación required en campos", () => {
    render(
      <CompleteStepFormFields
        {...baseProps({
          formValidationErrors: { observacionResolucion: "Este campo es obligatorio." },
        })}
      />
    );
    expect(screen.getByText("Este campo es obligatorio.")).toBeTruthy();
  });

  it("muestra estado no_form", () => {
    render(
      <CompleteStepFormFields
        {...baseProps({
          activeTaskForm: {
            status: "no_form",
            activeTask: { name: "Revisar Incidencia" },
            form: null,
          },
        })}
      />
    );
    expect(screen.getByText("Esta tarea no tiene formulario asociado en Camunda.")).toBeTruthy();
  });

  it("muestra estado error", () => {
    render(
      <CompleteStepFormFields
        {...baseProps({
          activeTaskForm: {
            status: "error",
            activeTask: { name: "Revisar Incidencia" },
            form: null,
          },
        })}
      />
    );
    expect(screen.getByText("No se pudo obtener el formulario asociado a la tarea activa.")).toBeTruthy();
  });

  it("renderiza opciones avanzadas colapsadas por defecto", () => {
    render(<CompleteStepFormFields {...baseProps({ showAdvancedOptions: true })} />);
    const summary = screen.getByText("Opciones avanzadas / desarrollo");
    expect(summary).toBeTruthy();
    const details = summary.closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
  });
});

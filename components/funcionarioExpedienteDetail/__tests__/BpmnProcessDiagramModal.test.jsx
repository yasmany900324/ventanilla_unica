/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import BpmnProcessDiagramModal from "../BpmnProcessDiagramModal";

const originalFetch = globalThis.fetch;

describe("BpmnProcessDiagramModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
  });

  it("muestra error amigable si falla la carga del XML", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    render(<BpmnProcessDiagramModal isOpen onClose={() => {}} procedureRequestId="pr-1" />);

    await waitFor(() => {
      expect(screen.getByText("No se pudo cargar el diagrama BPMN del proceso.")).toBeTruthy();
    });
  });
});

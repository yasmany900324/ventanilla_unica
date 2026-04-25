"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmProcedureAssignmentsModal from "./ConfirmProcedureAssignmentsModal";

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeLookup(value) {
  return normalizeText(value, 320)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => normalizeText(item, 80)).filter(Boolean)));
}

function formatAssignedProcedureNames(ids, proceduresById) {
  if (!ids?.length) {
    return "Sin asignaciones";
  }
  const labels = ids
    .map((id) => proceduresById[id])
    .filter(Boolean)
    .map((procedure) => `${procedure.name} (${procedure.code})`);
  return labels.length ? labels.join(", ") : "Sin asignaciones";
}

export default function AdminProcedureAssignmentsTab({ copy }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [agents, setAgents] = useState([]);
  const [procedureTypes, setProcedureTypes] = useState([]);
  const [assignmentsByUserId, setAssignmentsByUserId] = useState({});
  const [agentSearch, setAgentSearch] = useState("");
  const [procedureSearch, setProcedureSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedProcedureTypeIds, setSelectedProcedureTypeIds] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDialogState, setConfirmDialogState] = useState(null);
  const [confirmModalError, setConfirmModalError] = useState("");

  const loadAssignments = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/procedure-assignments");
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 403) {
          router.replace("/");
          return;
        }
        throw new Error(data?.error || "No se pudieron cargar las asignaciones de procedimientos.");
      }
      const incomingAgents = Array.isArray(data?.agents) ? data.agents : [];
      const incomingProcedureTypes = Array.isArray(data?.procedureTypes) ? data.procedureTypes : [];
      const incomingAssignments =
        data?.assignmentsByUserId && typeof data.assignmentsByUserId === "object"
          ? data.assignmentsByUserId
          : {};
      setAgents(incomingAgents);
      setProcedureTypes(incomingProcedureTypes);
      setAssignmentsByUserId(incomingAssignments);

      setSelectedAgentId((previousSelectedAgentId) => {
        const stillExists = incomingAgents.some((item) => item.id === previousSelectedAgentId);
        const nextSelectedAgentId = stillExists ? previousSelectedAgentId : incomingAgents[0]?.id || "";
        const nextSelection = normalizeIdArray(incomingAssignments[nextSelectedAgentId] || []);
        setSelectedProcedureTypeIds(nextSelection);
        return nextSelectedAgentId;
      });
    } catch (error) {
      setErrorMessage(error.message || "No se pudieron cargar las asignaciones de procedimientos.");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const proceduresById = useMemo(() => {
    return procedureTypes.reduce((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [procedureTypes]);

  const activeProceduresCount = useMemo(() => {
    return procedureTypes.filter((item) => item.isActive !== false).length;
  }, [procedureTypes]);

  const filteredAgents = useMemo(() => {
    const query = normalizeLookup(agentSearch);
    if (!query) {
      return agents;
    }
    return agents.filter((agent) => {
      return (
        normalizeLookup(agent.fullName).includes(query) ||
        normalizeLookup(agent.email).includes(query)
      );
    });
  }, [agentSearch, agents]);

  const selectedAgent = useMemo(() => {
    return agents.find((item) => item.id === selectedAgentId) || null;
  }, [agents, selectedAgentId]);

  const filteredProcedures = useMemo(() => {
    const query = normalizeLookup(procedureSearch);
    return procedureTypes.filter((item) => {
      if (!query) {
        return true;
      }
      return (
        normalizeLookup(item.name).includes(query) ||
        normalizeLookup(item.code).includes(query) ||
        normalizeLookup(item.category).includes(query)
      );
    });
  }, [procedureSearch, procedureTypes]);

  const currentAssignedIds = useMemo(() => {
    return normalizeIdArray(assignmentsByUserId[selectedAgentId] || []);
  }, [assignmentsByUserId, selectedAgentId]);

  const handleSelectAgent = (agentId) => {
    const normalizedAgentId = normalizeText(agentId, 80);
    setSelectedAgentId(normalizedAgentId);
    setSelectedProcedureTypeIds(normalizeIdArray(assignmentsByUserId[normalizedAgentId] || []));
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleToggleProcedure = (procedureTypeId) => {
    setSelectedProcedureTypeIds((previous) => {
      const normalized = normalizeText(procedureTypeId, 80);
      if (!normalized) {
        return previous;
      }
      if (previous.includes(normalized)) {
        return previous.filter((item) => item !== normalized);
      }
      return [...previous, normalized];
    });
    setSuccessMessage("");
    setErrorMessage("");
  };

  const openConfirmDialog = () => {
    if (!selectedAgent) {
      return;
    }
    setConfirmDialogState({
      agentId: selectedAgent.id,
      agentName: selectedAgent.fullName,
      agentEmail: selectedAgent.email,
      previousIds: [...currentAssignedIds],
      selectedIds: [...normalizeIdArray(selectedProcedureTypeIds)],
    });
    setConfirmModalError("");
    setErrorMessage("");
    setSuccessMessage("");
  };

  const closeConfirmDialog = () => {
    setConfirmDialogState(null);
    setConfirmModalError("");
  };

  const handleConfirmSave = async () => {
    if (!confirmDialogState?.agentId) {
      return;
    }
    setIsSaving(true);
    setConfirmModalError("");
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await fetch(
        `/api/admin/procedure-assignments/${encodeURIComponent(confirmDialogState.agentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ procedureTypeIds: confirmDialogState.selectedIds }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No se pudieron guardar las asignaciones.");
      }
      setAssignmentsByUserId((previous) => ({
        ...previous,
        [confirmDialogState.agentId]: [...confirmDialogState.selectedIds],
      }));
      setSelectedProcedureTypeIds([...confirmDialogState.selectedIds]);
      setSuccessMessage("Asignaciones guardadas correctamente.");
      closeConfirmDialog();
    } catch (error) {
      const message = error.message || "No se pudieron guardar las asignaciones.";
      setConfirmModalError(message);
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <section className="card dashboard-section">
        <h2>{copy.title}</h2>
        <p className="small">{copy.description}</p>
      </section>

      {successMessage ? (
        <section className="card">
          <p className="info-message">{successMessage}</p>
        </section>
      ) : null}
      {errorMessage ? (
        <section className="card">
          <p className="error-message">{errorMessage}</p>
        </section>
      ) : null}

      <section className="card dashboard-section admin-procedure-toolbar">
        <div className="admin-procedure-toolbar__content admin-procedure-toolbar__content--full">
          <input
            type="search"
            aria-label={copy.searchAgentsPlaceholder}
            placeholder={copy.searchAgentsPlaceholder}
            value={agentSearch}
            onChange={(event) => setAgentSearch(event.target.value)}
            disabled={isLoading}
          />
          <input
            type="search"
            aria-label={copy.searchProceduresPlaceholder}
            placeholder={copy.searchProceduresPlaceholder}
            value={procedureSearch}
            onChange={(event) => setProcedureSearch(event.target.value)}
            disabled={isLoading}
          />
        </div>
      </section>

      {isLoading ? (
        <section className="card">
          <p className="info-message">{copy.loading}</p>
        </section>
      ) : null}

      {!isLoading && !agents.length ? (
        <section className="card">
          <p className="empty-message">{copy.emptyAgents}</p>
        </section>
      ) : null}

      {!isLoading && agents.length > 0 && activeProceduresCount === 0 ? (
        <section className="card">
          <p className="empty-message">{copy.emptyActiveProcedures}</p>
        </section>
      ) : null}

      {!isLoading && agents.length > 0 ? (
        <>
          <section className="card dashboard-section">
            <div className="admin-procedure-table__header">
              <h3>{copy.agentsTableTitle}</h3>
              <p className="small">
                {copy.agentsFoundLabel}: {filteredAgents.length}
              </p>
            </div>
            <div className="admin-procedure-table__container">
              <table className="admin-procedure-table">
                <thead>
                  <tr>
                    <th>{copy.columns.name}</th>
                    <th>{copy.columns.email}</th>
                    <th>{copy.columns.assignedProcedures}</th>
                    <th>{copy.columns.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent) => {
                    const assignedIds = normalizeIdArray(assignmentsByUserId[agent.id] || []);
                    const isSelected = selectedAgentId === agent.id;
                    return (
                      <tr key={agent.id} className={isSelected ? "admin-assignments__agent-row--selected" : ""}>
                        <td>{agent.fullName || "—"}</td>
                        <td>{agent.email || "—"}</td>
                        <td>{formatAssignedProcedureNames(assignedIds, proceduresById)}</td>
                        <td>
                          <button
                            type="button"
                            className={`button-inline ${isSelected ? "button-inline--selected" : ""}`}
                            onClick={() => handleSelectAgent(agent.id)}
                          >
                            {copy.editAssignments}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedAgent ? (
            <section className="card dashboard-section">
              <div className="admin-procedure-table__header">
                <h3>{copy.detailTitle}</h3>
                <p className="small">
                  {copy.selectedAgentLabel}: {selectedAgent.fullName || "—"} ({selectedAgent.email || "—"})
                </p>
                <p className="small">
                  {copy.assignedCountLabel}: {selectedProcedureTypeIds.length}
                </p>
              </div>

              <div className="admin-assignments__procedure-list">
                {filteredProcedures.map((procedure) => {
                  const isChecked = selectedProcedureTypeIds.includes(procedure.id);
                  const isDisabled = procedure.isActive === false;
                  return (
                    <label
                      key={procedure.id}
                      className={`admin-procedure-channel ${isDisabled ? "admin-procedure-channel--disabled" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleProcedure(procedure.id)}
                        disabled={isDisabled || isSaving}
                      />
                      <span>
                        <strong>{procedure.name}</strong> ({procedure.code})
                        {" · "}
                        {procedure.isActive ? copy.active : copy.inactive}
                        {procedure.category ? ` · ${procedure.category}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>

              {!filteredProcedures.length ? (
                <p className="empty-message">{copy.noProcedureResults}</p>
              ) : null}

              <div className="admin-procedure-form__actions">
                <button
                  type="button"
                  onClick={openConfirmDialog}
                  disabled={isSaving || activeProceduresCount === 0}
                >
                  {isSaving ? copy.saving : copy.saveButton}
                </button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <ConfirmProcedureAssignmentsModal
        isOpen={Boolean(confirmDialogState)}
        agentName={confirmDialogState?.agentName}
        agentEmail={confirmDialogState?.agentEmail}
        previousProcedures={normalizeIdArray(confirmDialogState?.previousIds || []).map((id) => ({
          id,
          name: proceduresById[id]?.name || id,
          code: proceduresById[id]?.code || "",
        }))}
        selectedProcedures={normalizeIdArray(confirmDialogState?.selectedIds || []).map((id) => ({
          id,
          name: proceduresById[id]?.name || id,
          code: proceduresById[id]?.code || "",
        }))}
        errorMessage={confirmModalError}
        isSubmitting={isSaving}
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmSave}
      />
    </>
  );
}

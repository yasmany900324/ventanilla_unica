"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const WINDOW_DAY_OPTIONS = [7, 14, 30];
const ADMIN_TABS = {
  CHATBOT: "chatbot",
  PROCEDURES: "procedures",
};

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0%";
  }

  return `${Math.round(value * 100)}%`;
}

function MetricCard({ label, value }) {
  return (
    <article className="card summary-card">
      <p className="summary-card__label">{label}</p>
      <p className="summary-card__value">{value}</p>
    </article>
  );
}

function normalizeSimpleText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function ProcedureStatusBadge({ isActive, copy }) {
  return (
    <span className={`badge ${isActive ? "badge--resuelto" : "badge--en-revision"}`}>
      {isActive ? copy.active : copy.inactive}
    </span>
  );
}

function ProcedureTableRow({
  procedure,
  copy,
  onEdit,
  onToggleStatus,
  onDelete,
  isDeleting,
  isToggling,
  isSaving,
}) {
  const updatedAtText = procedure.updatedAt
    ? new Date(procedure.updatedAt).toLocaleDateString()
    : "-";

  return (
    <tr>
      <td>
        <p className="admin-procedure-table__primary">{procedure.name}</p>
        {procedure.description ? (
          <p className="admin-procedure-table__secondary">{procedure.description}</p>
        ) : null}
      </td>
      <td className="admin-procedure-table__mono">{procedure.code}</td>
      <td>{procedure.category || copy.noCategory}</td>
      <td>
        <ProcedureStatusBadge isActive={Boolean(procedure.isActive)} copy={copy} />
      </td>
      <td>{(procedure.requiredFields || []).length}</td>
      <td>{updatedAtText}</td>
      <td>
        <div className="admin-procedure-item__actions">
          <button
            type="button"
            className="button-inline"
            onClick={() => onEdit(procedure)}
            disabled={isSaving || isToggling || isDeleting}
          >
            {copy.edit}
          </button>
          <button
            type="button"
            className="button-inline"
            onClick={() => onToggleStatus(procedure)}
            disabled={isSaving || isToggling || isDeleting}
          >
            {isToggling
              ? copy.statusToggling
              : procedure.isActive
                ? copy.deactivate
                : copy.activate}
          </button>
          <button
            type="button"
            className="button-inline button-inline--danger"
            onClick={() => onDelete(procedure)}
            disabled={isSaving || isToggling || isDeleting}
          >
            {isDeleting ? copy.deleting : copy.delete}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ProcedureForm({
  mode,
  copy,
  formState,
  onFieldChange,
  onSubmit,
  onCancel,
  isSaving,
}) {
  const title = mode === "create" ? copy.form.createTitle : copy.form.editTitle;

  return (
    <form className="card dashboard-section admin-procedure-form" onSubmit={onSubmit}>
      <h3>{title}</h3>
      <label htmlFor="procedure-code">{copy.form.code}</label>
      <input
        id="procedure-code"
        type="text"
        value={formState.code}
        onChange={(event) => onFieldChange("code", event.target.value)}
        disabled={isSaving || mode !== "create"}
      />

      <label htmlFor="procedure-name">{copy.form.name}</label>
      <input
        id="procedure-name"
        type="text"
        value={formState.name}
        onChange={(event) => onFieldChange("name", event.target.value)}
        disabled={isSaving}
      />

      <label htmlFor="procedure-category">{copy.form.category}</label>
      <input
        id="procedure-category"
        type="text"
        value={formState.category}
        onChange={(event) => onFieldChange("category", event.target.value)}
        disabled={isSaving}
      />

      <label htmlFor="procedure-description">{copy.form.description}</label>
      <textarea
        id="procedure-description"
        value={formState.description}
        onChange={(event) => onFieldChange("description", event.target.value)}
        disabled={isSaving}
        rows={3}
      />

      <label htmlFor="procedure-aliases">{copy.form.aliases}</label>
      <input
        id="procedure-aliases"
        type="text"
        value={formState.aliasesText}
        onChange={(event) => onFieldChange("aliasesText", event.target.value)}
        disabled={isSaving}
      />

      <label htmlFor="procedure-keywords">{copy.form.keywords}</label>
      <input
        id="procedure-keywords"
        type="text"
        value={formState.keywordsText}
        onChange={(event) => onFieldChange("keywordsText", event.target.value)}
        disabled={isSaving}
      />

      <label htmlFor="procedure-required-fields">{copy.form.requiredFields}</label>
      <textarea
        id="procedure-required-fields"
        value={formState.requiredFieldsJson}
        onChange={(event) => onFieldChange("requiredFieldsJson", event.target.value)}
        disabled={isSaving}
        rows={6}
      />

      <label htmlFor="procedure-completion-message">{copy.form.completionMessage}</label>
      <textarea
        id="procedure-completion-message"
        value={formState.completionMessage}
        onChange={(event) => onFieldChange("completionMessage", event.target.value)}
        disabled={isSaving}
        rows={3}
      />

      <div className="admin-procedure-form__actions">
        <button type="submit" disabled={isSaving}>
          {isSaving
            ? mode === "create"
              ? copy.creating
              : copy.saving
            : mode === "create"
              ? copy.create
              : copy.save}
        </button>
        <button type="button" className="button-inline" onClick={onCancel} disabled={isSaving}>
          {copy.cancel}
        </button>
      </div>
    </form>
  );
}

function parseCommaSeparatedText(value) {
  return normalizeSimpleText(value, 1200)
    .split(",")
    .map((item) => normalizeSimpleText(item, 120))
    .filter(Boolean);
}

function createProcedureFormState(procedure = null) {
  const requiredFields = Array.isArray(procedure?.requiredFields) ? procedure.requiredFields : [];
  return {
    code: normalizeSimpleText(procedure?.code, 120).toLowerCase(),
    name: normalizeSimpleText(procedure?.name, 160),
    category: normalizeSimpleText(procedure?.category, 80),
    description: normalizeSimpleText(procedure?.description, 320),
    aliasesText: Array.isArray(procedure?.aliases) ? procedure.aliases.join(", ") : "",
    keywordsText: Array.isArray(procedure?.keywords) ? procedure.keywords.join(", ") : "",
    requiredFieldsJson: requiredFields.length
      ? JSON.stringify(requiredFields, null, 2)
      : JSON.stringify(
          [
            {
              key: "dato_principal",
              label: "dato principal",
              prompt: "Indícame el dato principal para este trámite.",
            },
          ],
          null,
          2
        ),
    completionMessage: normalizeSimpleText(procedure?.flowDefinition?.completionMessage, 260),
  };
}

function getProcedureCopy(baseCopy) {
  return {
    ...baseCopy,
    contextTitle: baseCopy.contextTitle || "Catálogo de tipos de trámites",
    contextDescription:
      baseCopy.contextDescription ||
      "Un tipo de trámite define qué puede gestionar el chatbot y qué datos debe pedir en cada paso.",
    catalogTitle: baseCopy.catalogTitle || "Catálogo actual",
    catalogDescription:
      baseCopy.catalogDescription ||
      "Revisa y administra los tipos existentes antes de crear uno nuevo.",
    summaryTotal: baseCopy.summaryTotal || "Total",
    summaryActive: baseCopy.summaryActive || "Activos",
    summaryInactive: baseCopy.summaryInactive || "Inactivos",
    tableNameHeader: baseCopy.tableNameHeader || "Tipo de trámite",
    tableCodeHeader: baseCopy.tableCodeHeader || "Código",
    tableCategoryHeader: baseCopy.tableCategoryHeader || "Categoría",
    tableStatusHeader: baseCopy.tableStatusHeader || "Estado",
    tableRequiredFieldsHeader: baseCopy.tableRequiredFieldsHeader || "Campos",
    tableUpdatedAtHeader: baseCopy.tableUpdatedAtHeader || "Actualizado",
    tableActionsHeader: baseCopy.tableActionsHeader || "Acciones",
    newProcedureCta: baseCopy.newProcedureCta || "Nuevo tipo de trámite",
    hideFormCta: baseCopy.hideFormCta || "Ocultar formulario",
    createSecondaryTitle: baseCopy.createSecondaryTitle || "Agregar nuevo tipo",
    createSecondaryDescription:
      baseCopy.createSecondaryDescription ||
      "Cuando necesites ampliar el catálogo, crea un nuevo tipo de trámite desde aquí.",
    edit: baseCopy.edit || "Editar",
    activate: baseCopy.activate || "Activar",
    deactivate: baseCopy.deactivate || "Desactivar",
    delete: baseCopy.delete || "Eliminar",
    deleting: baseCopy.deleting || "Eliminando...",
    successDeleted: baseCopy.successDeleted || "Tipo de trámite eliminado correctamente.",
    confirmDelete:
      baseCopy.confirmDelete ||
      "¿Seguro que quieres eliminar este tipo de trámite? Esta acción no se puede deshacer.",
    noCategory: baseCopy.noCategory || "Sin categoría",
  };
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const procedureCopy = getProcedureCopy(copy.admin.procedures);
  const [windowDays, setWindowDays] = useState(7);
  const [activeTab, setActiveTab] = useState(ADMIN_TABS.CHATBOT);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [isLoadingProcedures, setIsLoadingProcedures] = useState(false);
  const [proceduresError, setProceduresError] = useState("");
  const [procedures, setProcedures] = useState([]);
  const [selectedProcedureCode, setSelectedProcedureCode] = useState("");
  const [showProcedureForm, setShowProcedureForm] = useState(false);
  const [procedureFormState, setProcedureFormState] = useState(() => createProcedureFormState());
  const [isSavingProcedure, setIsSavingProcedure] = useState(false);
  const [procedureSuccessMessage, setProcedureSuccessMessage] = useState("");
  const [togglingCode, setTogglingCode] = useState("");
  const [deletingCode, setDeletingCode] = useState("");

  const isAdministrator = user?.role === "administrador";
  const funnel = metrics?.funnel || null;
  const selectedProcedure = useMemo(
    () => procedures.find((item) => item.code === selectedProcedureCode) || null,
    [procedures, selectedProcedureCode]
  );
  const orderedEventCounts = useMemo(() => {
    const counts = metrics?.eventCounts || {};
    return Object.entries(counts).sort((firstEntry, secondEntry) => secondEntry[1] - firstEntry[1]);
  }, [metrics?.eventCounts]);

  const procedureSummary = useMemo(() => {
    const total = procedures.length;
    const active = procedures.filter((item) => item.isActive).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [procedures]);

  useEffect(() => {
    if (user && !isAdministrator) {
      router.replace("/");
    }
  }, [isAdministrator, router, user]);

  useEffect(() => {
    if (!user || !isAdministrator) {
      return;
    }

    const abortController = new AbortController();
    const loadMetrics = async () => {
      setIsLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch(`/api/chatbot/metrics?windowDays=${windowDays}&locale=${locale}`, {
          signal: abortController.signal,
        });
        const data = await response.json();

        if (!response.ok) {
          if (response.status === 403) {
            router.replace("/");
            return;
          }

          throw new Error(data?.error || copy.admin.loadError);
        }

        setMetrics(data);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        setErrorMessage(error.message || copy.admin.loadError);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadMetrics();
    return () => {
      abortController.abort();
    };
  }, [copy.admin.loadError, isAdministrator, locale, router, user, windowDays]);

  useEffect(() => {
    if (!user || !isAdministrator || activeTab !== ADMIN_TABS.PROCEDURES) {
      return;
    }

    const abortController = new AbortController();
    const loadProcedures = async () => {
      setIsLoadingProcedures(true);
      setProceduresError("");
      setProcedureSuccessMessage("");

      try {
        const response = await fetch(`/api/admin/procedures?locale=${locale}&includeInactive=true`, {
          signal: abortController.signal,
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 403) {
            router.replace("/");
            return;
          }
          throw new Error(data?.error || procedureCopy.loadError);
        }

        const incomingProcedures = Array.isArray(data?.procedures) ? data.procedures : [];
        setProcedures(incomingProcedures);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }
        setProceduresError(error.message || procedureCopy.loadError);
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoadingProcedures(false);
        }
      }
    };

    loadProcedures();
    return () => abortController.abort();
  }, [activeTab, isAdministrator, locale, procedureCopy.loadError, router, user]);

  const handleProcedureFieldChange = (fieldName, fieldValue) => {
    setProcedureFormState((previousState) => ({
      ...previousState,
      [fieldName]: fieldValue,
    }));
  };

  const resetProcedureForm = () => {
    setSelectedProcedureCode("");
    setProcedureFormState(createProcedureFormState());
    setShowProcedureForm(false);
  };

  const openCreateProcedureForm = () => {
    setSelectedProcedureCode("");
    setProcedureFormState(createProcedureFormState());
    setShowProcedureForm(true);
    setProcedureSuccessMessage("");
    setProceduresError("");
  };

  const handleSelectProcedureToEdit = (procedure) => {
    setSelectedProcedureCode(procedure.code);
    setProcedureFormState(createProcedureFormState(procedure));
    setShowProcedureForm(true);
    setProcedureSuccessMessage("");
    setProceduresError("");
  };

  const submitProcedure = async (event) => {
    event.preventDefault();
    setProcedureSuccessMessage("");
    setProceduresError("");

    const code = normalizeSimpleText(procedureFormState.code, 120).toLowerCase();
    const name = normalizeSimpleText(procedureFormState.name, 160);
    const category = normalizeSimpleText(procedureFormState.category, 80);
    const description = normalizeSimpleText(procedureFormState.description, 320);
    const completionMessage = normalizeSimpleText(procedureFormState.completionMessage, 260);
    const aliases = parseCommaSeparatedText(procedureFormState.aliasesText);
    const keywords = parseCommaSeparatedText(procedureFormState.keywordsText);

    if (!code) {
      setProceduresError(procedureCopy.validation.codeRequired);
      return;
    }
    if (!name) {
      setProceduresError(procedureCopy.validation.nameRequired);
      return;
    }

    let requiredFields = [];
    try {
      const parsed = JSON.parse(procedureFormState.requiredFieldsJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        setProceduresError(procedureCopy.validation.requiredFieldsRequired);
        return;
      }
      requiredFields = parsed;
    } catch (_error) {
      setProceduresError(procedureCopy.validation.invalidRequiredFieldsJson);
      return;
    }

    setIsSavingProcedure(true);
    try {
      const isEditMode = Boolean(selectedProcedureCode);
      const response = await fetch("/api/admin/procedures", {
        method: isEditMode ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          name,
          category,
          description,
          aliases,
          keywords,
          requiredFields,
          flowDefinition: completionMessage ? { completionMessage } : {},
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }

      const savedProcedure = data?.procedure;
      if (savedProcedure) {
        setProcedures((previousProcedures) => {
          const index = previousProcedures.findIndex((item) => item.code === savedProcedure.code);
          if (index === -1) {
            return [savedProcedure, ...previousProcedures].sort((firstItem, secondItem) =>
              firstItem.name.localeCompare(secondItem.name, locale)
            );
          }

          const updated = [...previousProcedures];
          updated[index] = savedProcedure;
          return updated.sort((firstItem, secondItem) =>
            firstItem.name.localeCompare(secondItem.name, locale)
          );
        });
      }

      setProcedureSuccessMessage(isEditMode ? procedureCopy.successSaved : procedureCopy.successCreated);
      setSelectedProcedureCode("");
      setProcedureFormState(createProcedureFormState());
      setShowProcedureForm(false);
    } catch (error) {
      setProceduresError(error.message || procedureCopy.loadError);
    } finally {
      setIsSavingProcedure(false);
    }
  };

  const handleToggleProcedureStatus = async (procedure) => {
    if (!procedure?.code) {
      return;
    }

    setProcedureSuccessMessage("");
    setProceduresError("");
    setTogglingCode(procedure.code);
    try {
      const response = await fetch("/api/admin/procedures", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: procedure.code,
          isActive: !procedure.isActive,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }

      const savedProcedure = data?.procedure;
      if (savedProcedure) {
        setProcedures((previousProcedures) =>
          previousProcedures
            .map((item) => (item.code === savedProcedure.code ? savedProcedure : item))
            .sort((firstItem, secondItem) => firstItem.name.localeCompare(secondItem.name, locale))
        );
      }
      setProcedureSuccessMessage(procedureCopy.successStatusUpdated);
    } catch (error) {
      setProceduresError(error.message || procedureCopy.loadError);
    } finally {
      setTogglingCode("");
    }
  };

  const handleDeleteProcedure = async (procedure) => {
    if (!procedure?.code) {
      return;
    }

    if (!window.confirm(procedureCopy.confirmDelete)) {
      return;
    }

    setProcedureSuccessMessage("");
    setProceduresError("");
    setDeletingCode(procedure.code);
    try {
      const response = await fetch("/api/admin/procedures", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: procedure.code }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }

      setProcedures((previousProcedures) =>
        previousProcedures.filter((item) => item.code !== procedure.code)
      );
      if (selectedProcedureCode === procedure.code) {
        setSelectedProcedureCode("");
        setProcedureFormState(createProcedureFormState());
        setShowProcedureForm(false);
      }
      setProcedureSuccessMessage(procedureCopy.successDeleted);
    } catch (error) {
      setProceduresError(error.message || procedureCopy.loadError);
    } finally {
      setDeletingCode("");
    }
  };

  if (user && !isAdministrator) {
    return null;
  }

  return (
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">{copy.portal.adminDashboard}</p>
          <h1>{copy.admin.title}</h1>
          <p className="description">{copy.admin.description}</p>
        </div>
      </section>

      <section className="card dashboard-section admin-tabs">
        <div role="tablist" aria-label={copy.portal.adminDashboard} className="admin-tabs__list">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ADMIN_TABS.CHATBOT}
            className={`admin-tabs__tab ${
              activeTab === ADMIN_TABS.CHATBOT ? "admin-tabs__tab--active" : ""
            }`}
            onClick={() => setActiveTab(ADMIN_TABS.CHATBOT)}
          >
            {copy.admin.tabs.chatbot}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ADMIN_TABS.PROCEDURES}
            className={`admin-tabs__tab ${
              activeTab === ADMIN_TABS.PROCEDURES ? "admin-tabs__tab--active" : ""
            }`}
            onClick={() => setActiveTab(ADMIN_TABS.PROCEDURES)}
          >
            {copy.admin.tabs.procedures}
          </button>
        </div>
      </section>

      {activeTab === ADMIN_TABS.CHATBOT ? (
        <>
          <section className="card dashboard-section">
            <label htmlFor="admin-window-days">{copy.admin.analysisWindow}</label>
            <select
              id="admin-window-days"
              value={windowDays}
              onChange={(event) => setWindowDays(Number.parseInt(event.target.value, 10) || 7)}
              disabled={isLoading}
            >
              {WINDOW_DAY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {copy.admin.lastDaysLabel(option)}
                </option>
              ))}
            </select>
          </section>

          {isLoading ? (
            <section className="card">
              <p className="info-message">{copy.admin.loadingMetrics}</p>
            </section>
          ) : null}

          {!isLoading && errorMessage ? (
            <section className="card">
              <p className="error-message">{errorMessage}</p>
            </section>
          ) : null}

          {!isLoading && !errorMessage && funnel ? (
            <>
              <section className="summary-grid" aria-label={copy.admin.funnelSummaryAria}>
                <MetricCard
                  label={copy.admin.cards.enteredIncidentFlow}
                  value={funnel.enteredIncidentFlow}
                />
                <MetricCard label={copy.admin.cards.askedField} value={funnel.askedField} />
                <MetricCard
                  label={copy.admin.cards.readyForConfirmation}
                  value={funnel.readyForConfirmation}
                />
                <MetricCard label={copy.admin.cards.authRequired} value={funnel.authRequired} />
                <MetricCard label={copy.admin.cards.confirmed} value={funnel.confirmed} />
                <MetricCard label={copy.admin.cards.incidentCreated} value={funnel.incidentCreated} />
                <MetricCard
                  label={copy.admin.cards.incidentCreationConversion}
                  value={formatPercent(funnel.incidentCreationConversion)}
                />
                <MetricCard label={copy.admin.cards.cancelled} value={funnel.cancelled} />
              </section>

              <section className="card dashboard-section">
                <h2>{copy.admin.totalsTitle}</h2>
                <p className="small">
                  {copy.admin.totalsEvents}: {metrics?.totals?.events || 0}
                </p>
                <p className="small">
                  {copy.admin.totalsUniqueSessions}: {metrics?.totals?.uniqueSessions || 0}
                </p>
              </section>

              <section className="card dashboard-section">
                <h2>{copy.admin.frequentEventsTitle}</h2>
                {orderedEventCounts.length ? (
                  <ul className="incident-list incident-list--full" aria-label={copy.admin.telemetryEventsAria}>
                    {orderedEventCounts.map(([eventName, count]) => (
                      <li key={eventName} className="incident-card incident-card--list">
                        <div className="incident-card__main">
                          <p className="incident-card__meta">{eventName}</p>
                          <p className="incident-card__description">{copy.admin.occurrencesLabel(count)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-message">{copy.admin.emptyWindowEvents}</p>
                )}
              </section>
            </>
          ) : null}
        </>
      ) : (
        <>
          <section className="card dashboard-section">
            <h2>{procedureCopy.contextTitle}</h2>
            <p className="small">{procedureCopy.contextDescription}</p>
          </section>

          {procedureSuccessMessage ? (
            <section className="card">
              <p className="info-message">{procedureSuccessMessage}</p>
            </section>
          ) : null}

          {proceduresError ? (
            <section className="card">
              <p className="error-message">{proceduresError}</p>
            </section>
          ) : null}

          <section className="summary-grid">
            <MetricCard label={procedureCopy.summaryTotal} value={procedureSummary.total} />
            <MetricCard label={procedureCopy.summaryActive} value={procedureSummary.active} />
            <MetricCard label={procedureCopy.summaryInactive} value={procedureSummary.inactive} />
          </section>

          <section className="card dashboard-section admin-procedure-toolbar">
            <div className="admin-procedure-toolbar__content">
              <h3>{procedureCopy.catalogTitle}</h3>
              <p className="small">{procedureCopy.catalogDescription}</p>
            </div>
            <div className="admin-procedure-toolbar__actions">
              <button type="button" className="button-inline" onClick={openCreateProcedureForm}>
                {procedureCopy.newProcedureCta}
              </button>
              {showProcedureForm ? (
                <button type="button" className="button-inline" onClick={resetProcedureForm}>
                  {procedureCopy.hideFormCta}
                </button>
              ) : null}
            </div>
          </section>

          {isLoadingProcedures ? (
            <section className="card">
              <p className="info-message">{procedureCopy.loading}</p>
            </section>
          ) : null}

          {!isLoadingProcedures && !proceduresError && procedures.length ? (
            <section className="card dashboard-section">
              <div className="admin-procedure-table__container" aria-label={procedureCopy.listAria}>
                <table className="admin-procedure-table">
                  <thead>
                    <tr>
                      <th>{procedureCopy.tableNameHeader}</th>
                      <th>{procedureCopy.tableCodeHeader}</th>
                      <th>{procedureCopy.tableCategoryHeader}</th>
                      <th>{procedureCopy.tableStatusHeader}</th>
                      <th>{procedureCopy.tableRequiredFieldsHeader}</th>
                      <th>{procedureCopy.tableUpdatedAtHeader}</th>
                      <th>{procedureCopy.tableActionsHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procedures.map((procedure) => (
                      <ProcedureTableRow
                        key={procedure.code}
                        procedure={procedure}
                        copy={procedureCopy}
                        onEdit={handleSelectProcedureToEdit}
                        onToggleStatus={handleToggleProcedureStatus}
                        onDelete={handleDeleteProcedure}
                        isDeleting={deletingCode === procedure.code}
                        isToggling={togglingCode === procedure.code}
                        isSaving={isSavingProcedure}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {!isLoadingProcedures && !proceduresError && !procedures.length ? (
            <section className="card dashboard-section">
              <p className="empty-message">{procedureCopy.empty}</p>
              <p className="small">{procedureCopy.createSecondaryDescription}</p>
              <div className="admin-procedure-item__actions">
                <button type="button" className="button-inline" onClick={openCreateProcedureForm}>
                  {procedureCopy.newProcedureCta}
                </button>
              </div>
            </section>
          ) : null}

          {showProcedureForm ? (
            <ProcedureForm
              mode={selectedProcedure ? "edit" : "create"}
              copy={procedureCopy}
              formState={procedureFormState}
              onFieldChange={handleProcedureFieldChange}
              onSubmit={submitProcedure}
              onCancel={resetProcedureForm}
              isSaving={isSavingProcedure}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

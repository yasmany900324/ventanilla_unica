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

function ProcedureListItem({
  procedure,
  copy,
  onEdit,
  onToggleStatus,
  isToggling,
  isSaving,
}) {
  return (
    <li className="incident-card incident-card--list">
      <div className="incident-card__header">
        <div className="incident-card__main">
          <p className="incident-card__meta">{procedure.name}</p>
          <p className="small">{procedure.code}</p>
          {procedure.category ? <p className="small">{procedure.category}</p> : null}
        </div>
        <ProcedureStatusBadge isActive={Boolean(procedure.isActive)} copy={copy} />
      </div>
      {procedure.description ? (
        <p className="incident-card__description">{procedure.description}</p>
      ) : null}
      <div className="admin-procedure-item__meta">
        <p className="small">
          {copy.aliasesLabel}: {(procedure.aliases || []).join(", ") || "-"}
        </p>
        <p className="small">
          {copy.keywordsLabel}: {(procedure.keywords || []).join(", ") || "-"}
        </p>
        <p className="small">
          {copy.requiredFieldsLabel}: {(procedure.requiredFields || []).length}
        </p>
      </div>
      <div className="admin-procedure-item__actions">
        <button
          type="button"
          className="button-inline"
          onClick={() => onEdit(procedure)}
          disabled={isSaving || isToggling}
        >
          {copy.save}
        </button>
        <button
          type="button"
          className="button-inline"
          onClick={() => onToggleStatus(procedure)}
          disabled={isSaving || isToggling}
        >
          {isToggling ? copy.statusToggling : copy.statusToggle}
        </button>
      </div>
    </li>
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
      <h2>{title}</h2>
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
        {mode === "edit" ? (
          <button
            type="button"
            className="button-inline"
            onClick={onCancel}
            disabled={isSaving}
          >
            {copy.cancel}
          </button>
        ) : null}
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

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const procedureCopy = copy.admin.procedures;
  const [windowDays, setWindowDays] = useState(7);
  const [activeTab, setActiveTab] = useState(ADMIN_TABS.CHATBOT);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [metrics, setMetrics] = useState(null);
  const [isLoadingProcedures, setIsLoadingProcedures] = useState(false);
  const [proceduresError, setProceduresError] = useState("");
  const [procedures, setProcedures] = useState([]);
  const [selectedProcedureCode, setSelectedProcedureCode] = useState("");
  const [procedureFormState, setProcedureFormState] = useState(() => createProcedureFormState());
  const [isSavingProcedure, setIsSavingProcedure] = useState(false);
  const [procedureSuccessMessage, setProcedureSuccessMessage] = useState("");
  const [togglingCode, setTogglingCode] = useState("");

  const isAdministrator = user?.role === "administrador";
  const funnel = metrics?.funnel || null;
  const selectedProcedure = useMemo(
    () => procedures.find((item) => item.code === selectedProcedureCode) || null,
    [procedures, selectedProcedureCode]
  );

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
        const response = await fetch(`/api/admin/procedures?locale=${locale}`, {
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

  const orderedEventCounts = useMemo(() => {
    const counts = metrics?.eventCounts || {};
    return Object.entries(counts).sort((firstEntry, secondEntry) => secondEntry[1] - firstEntry[1]);
  }, [metrics?.eventCounts]);

  const handleProcedureFieldChange = (fieldName, fieldValue) => {
    setProcedureFormState((previousState) => ({
      ...previousState,
      [fieldName]: fieldValue,
    }));
  };

  const resetProcedureForm = () => {
    setSelectedProcedureCode("");
    setProcedureFormState(createProcedureFormState());
  };

  const handleSelectProcedureToEdit = (procedure) => {
    setSelectedProcedureCode(procedure.code);
    setProcedureFormState(createProcedureFormState(procedure));
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
          return updated;
        });
      }

      setProcedureSuccessMessage(isEditMode ? procedureCopy.successSaved : procedureCopy.successCreated);
      resetProcedureForm();
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
          previousProcedures.map((item) =>
            item.code === savedProcedure.code ? savedProcedure : item
          )
        );
      }
      setProcedureSuccessMessage(procedureCopy.successStatusUpdated);
    } catch (error) {
      setProceduresError(error.message || procedureCopy.loadError);
    } finally {
      setTogglingCode("");
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
                <MetricCard
                  label={copy.admin.cards.incidentCreated}
                  value={funnel.incidentCreated}
                />
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
            <h2>{procedureCopy.title}</h2>
            <p className="small">{procedureCopy.description}</p>
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

          <ProcedureForm
            mode={selectedProcedure ? "edit" : "create"}
            copy={procedureCopy}
            formState={procedureFormState}
            onFieldChange={handleProcedureFieldChange}
            onSubmit={submitProcedure}
            onCancel={resetProcedureForm}
            isSaving={isSavingProcedure}
          />

          {isLoadingProcedures ? (
            <section className="card">
              <p className="info-message">{procedureCopy.loading}</p>
            </section>
          ) : null}

          {!isLoadingProcedures && !proceduresError ? (
            <section className="card dashboard-section">
              {procedures.length ? (
                <ul className="incident-list incident-list--full" aria-label={procedureCopy.listAria}>
                  {procedures.map((procedure) => (
                    <ProcedureListItem
                      key={procedure.code}
                      procedure={procedure}
                      copy={procedureCopy}
                      onEdit={handleSelectProcedureToEdit}
                      onToggleStatus={handleToggleProcedureStatus}
                      isToggling={togglingCode === procedure.code}
                      isSaving={isSavingProcedure}
                    />
                  ))}
                </ul>
              ) : (
                <p className="empty-message">{procedureCopy.empty}</p>
              )}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

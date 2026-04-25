"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";
import AdminPanelNav from "./AdminPanelNav";

const WINDOW_DAY_OPTIONS = [7, 14, 30];
const ADMIN_TABS = {
  CHATBOT: "chatbot",
  PROCEDURES: "procedures",
};

const DEFAULT_REQUIRED_FIELDS = [
  { key: "description", label: "Descripción", type: "text", required: true, order: 1 },
  { key: "photo", label: "Foto", type: "image", required: true, order: 2 },
  { key: "location", label: "Ubicación", type: "location", required: true, order: 3 },
];

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Texto" },
  { value: "textarea", label: "Texto largo" },
  { value: "boolean", label: "Booleano" },
  { value: "date", label: "Fecha" },
  { value: "image", label: "Imagen" },
  { value: "location", label: "Ubicación" },
  { value: "email", label: "Email" },
  { value: "number", label: "Número" },
  { value: "select", label: "Selección" },
];

const CAMUNDA_MAPPING_EXAMPLE_START_INSTANCE = `[
  {
    "scope": "START_INSTANCE",
    "procedureFieldKey": "description",
    "camundaVariableName": "descripcion",
    "camundaVariableType": "string",
    "required": true,
    "enabled": true
  }
]`;

const CAMUNDA_MAPPING_EXAMPLE_COMPLETE_TASK = `[
  {
    "scope": "COMPLETE_TASK",
    "camundaTaskDefinitionKey": "review_incident",
    "procedureFieldKey": "backofficeDecision",
    "camundaVariableName": "aprobado",
    "camundaVariableType": "boolean",
    "required": true,
    "enabled": true
  }
]`;

const TASK_UI_DICTIONARY_EXAMPLE = `{
  "validar_incidencia": {
    "title": "Revisar reporte ciudadano",
    "description": "Verificá la descripción, ubicación e imagen enviada por el ciudadano antes de continuar el trámite.",
    "primaryActionLabel": "Confirmar revisión",
    "requiredVariables": [
      {
        "camundaVariableName": "revisionFuncionario",
        "label": "Resultado de la revisión",
        "camundaVariableType": "string",
        "required": true
      },
      {
        "camundaVariableName": "observacionesInternas",
        "label": "Observaciones internas",
        "camundaVariableType": "string",
        "required": false
      }
    ]
  }
}`;

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "0%";
  }
  return `${Math.round(value * 100)}%`;
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
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 120);
}

function formatProcedureUpdatedAt(updatedAt, locale) {
  if (!updatedAt) {
    return "-";
  }
  const date = new Date(updatedAt);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return locale === "en" ? "Today" : locale === "pt" ? "Hoje" : "Hoy";
  }
  return date.toLocaleDateString(locale || "es");
}

function getFieldTypeLabel(type, locale) {
  const normalizedType = normalizeSimpleText(type, 20).toLowerCase();
  const labels = {
    text: { es: "Texto", en: "Text", pt: "Texto" },
    textarea: { es: "Texto largo", en: "Long text", pt: "Texto longo" },
    boolean: { es: "Booleano", en: "Boolean", pt: "Booleano" },
    date: { es: "Fecha", en: "Date", pt: "Data" },
    image: { es: "Imagen", en: "Image", pt: "Imagem" },
    location: { es: "Ubicación", en: "Location", pt: "Localização" },
    email: { es: "Email", en: "Email", pt: "Email" },
    number: { es: "Número", en: "Number", pt: "Número" },
    select: { es: "Selección", en: "Select", pt: "Seleção" },
  };
  return labels[normalizedType]?.[locale] || labels[normalizedType]?.es || type || "Texto";
}

function humanizeProcedureType(rawType) {
  const normalized = normalizeSimpleText(rawType, 80);
  if (!normalized) {
    return "Incidencia";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function resolveProcedureTypeForDisplay(procedure) {
  const category = normalizeSimpleText(procedure?.category, 80);
  const processId = normalizeSimpleText(procedure?.camundaProcessId, 160);
  const categoryLookup = category.toLowerCase();
  const processLookup = processId.toLowerCase();
  const looksLikeTechnicalId = /^[a-z0-9_-]+$/u.test(category) && categoryLookup.length <= 40;
  if (categoryLookup && processLookup && categoryLookup === processLookup && looksLikeTechnicalId) {
    return "Incidencia";
  }
  return humanizeProcedureType(category || "Incidencia");
}

function ProcedureStatusBadge({ isActive, copy }) {
  return (
    <span className={`badge ${isActive ? "badge--resuelto" : "badge--en-revision"}`}>
      {isActive ? copy.active : copy.inactive}
    </span>
  );
}

function MetricCard({ label, value }) {
  return (
    <article className="card summary-card">
      <p className="summary-card__label">{label}</p>
      <p className="summary-card__value">{value}</p>
    </article>
  );
}

function ProcedureSummaryCard({ icon, label, value }) {
  return (
    <article className="card summary-card admin-procedure-summary-card">
      <p className="admin-procedure-summary-card__icon" aria-hidden="true">
        {icon}
      </p>
      <p className="summary-card__label">{label}</p>
      <p className="summary-card__value">{value}</p>
    </article>
  );
}

function createProcedureFormState(procedure = null) {
  const requiredFields = Array.isArray(procedure?.requiredFields)
    ? procedure.requiredFields
    : DEFAULT_REQUIRED_FIELDS;
  const normalizedFields = requiredFields.map((field, index) => ({
    key: normalizeCode(field?.key || field?.label || `field_${index + 1}`),
    label: normalizeSimpleText(field?.label || `Campo ${index + 1}`, 80),
    type: normalizeSimpleText(field?.type || "text", 24).toLowerCase() || "text",
    required: field?.required !== false,
    order: Number.isInteger(field?.order) ? field.order : index + 1,
  }));
  const channels = Array.isArray(procedure?.enabledChannels)
    ? procedure.enabledChannels.map((channel) => normalizeSimpleText(channel, 20).toLowerCase())
    : ["web", "whatsapp"];
  const mappings = Array.isArray(procedure?.camundaVariableMappings)
    ? procedure.camundaVariableMappings
    : [];
  const flowDefinition =
    procedure?.flowDefinition && typeof procedure.flowDefinition === "object"
      ? procedure.flowDefinition
      : {};
  const taskUiDictionaryRaw = flowDefinition.taskUiDictionary;
  const taskUiDictionary = Array.isArray(taskUiDictionaryRaw)
    ? taskUiDictionaryRaw
    : taskUiDictionaryRaw && typeof taskUiDictionaryRaw === "object"
      ? Object.entries(taskUiDictionaryRaw).map(([taskDefinitionKey, config]) => ({
          taskDefinitionKey,
          ...(config && typeof config === "object" ? config : {}),
        }))
      : [];
  return {
    originalCode: normalizeCode(procedure?.code || ""),
    code: normalizeCode(procedure?.code || ""),
    name: normalizeSimpleText(procedure?.name || "", 160),
    type: resolveProcedureTypeForDisplay(procedure),
    description: normalizeSimpleText(procedure?.description || "", 320),
    isActive: procedure?.isActive !== false,
    camundaProcessId: normalizeSimpleText(procedure?.camundaProcessId || "", 160),
    camundaVersion: normalizeSimpleText(procedure?.camundaVersion || procedure?.version || "", 80),
    requiredFields: normalizedFields,
    camundaVariableMappingsJson:
      mappings.length > 0 ? JSON.stringify(mappings, null, 2) : CAMUNDA_MAPPING_EXAMPLE_START_INSTANCE,
    taskUiDictionaryJson:
      taskUiDictionary.length > 0
        ? JSON.stringify(taskUiDictionary, null, 2)
        : TASK_UI_DICTIONARY_EXAMPLE,
    flowDefinitionBase: flowDefinition,
    enabledChannels: Array.from(new Set(channels.filter(Boolean))),
  };
}

function getProcedureCopy(baseCopy) {
  return {
    ...baseCopy,
    contextTitle: baseCopy.contextTitle || "Catálogo de procedimientos",
    contextDescription:
      baseCopy.contextDescription ||
      "Define qué procedimientos puede ofrecer el chatbot, qué datos debe solicitar y con qué proceso BPMN se integra.",
    configuredTitle: baseCopy.configuredTitle || "Procedimientos configurados",
    configuredDescription:
      baseCopy.configuredDescription ||
      "Activa, edita o elimina los procedimientos disponibles para el asistente.",
    searchPlaceholder: baseCopy.searchPlaceholder || "Buscar por nombre o código",
    filterAll: baseCopy.filterAll || "Todos",
    filterActive: baseCopy.filterActive || "Activos",
    summaryTotal: baseCopy.summaryTotal || "Total",
    summaryActive: baseCopy.summaryActive || "Activos",
    summaryInactive: baseCopy.summaryInactive || "Inactivos",
    summaryBpmn: baseCopy.summaryBpmn || "Integrados con BPMN",
    tableNameHeader: baseCopy.tableNameHeader || "Procedimiento",
    tableCodeHeader: baseCopy.tableCodeHeader || "Código",
    tableCategoryHeader: baseCopy.tableCategoryHeader || "Tipo",
    tableStatusHeader: baseCopy.tableStatusHeader || "Estado",
    tableBpmnHeader: baseCopy.tableBpmnHeader || "BPMN / Process ID",
    tableUpdatedAtHeader: baseCopy.tableUpdatedAtHeader || "Actualizado",
    tableActionsHeader: baseCopy.tableActionsHeader || "Acciones",
    newProcedureCta: baseCopy.newProcedureCta || "Nuevo procedimiento",
    active: baseCopy.active || "Activo",
    inactive: baseCopy.inactive || "Inactivo",
    edit: baseCopy.edit || "Editar",
    deactivate: baseCopy.deactivate || "Deshabilitar",
    delete: baseCopy.delete || "Eliminar",
    deleting: baseCopy.deleting || "Eliminando...",
    statusToggling: baseCopy.statusToggling || "Actualizando estado...",
    save: baseCopy.save || "Guardar cambios",
    saving: baseCopy.saving || "Guardando...",
    cancel: baseCopy.cancel || "Cancelar",
    collapse: baseCopy.collapse || "Contraer",
    noResults: baseCopy.noResults || "No hay procedimientos para los filtros seleccionados.",
    loading: baseCopy.loading || "Cargando catálogo de procedimientos...",
    loadError: baseCopy.loadError || "No se pudo cargar el catálogo de procedimientos.",
    successSaved: baseCopy.successSaved || "Procedimiento guardado correctamente.",
    successCreated: baseCopy.successCreated || "Procedimiento creado correctamente.",
    successStatusUpdated: baseCopy.successStatusUpdated || "Estado del procedimiento actualizado.",
    successDeleted: baseCopy.successDeleted || "Procedimiento eliminado correctamente.",
    confirmDelete:
      baseCopy.confirmDelete ||
      "¿Seguro que quieres eliminar este procedimiento inactivo? Esta acción no se puede deshacer.",
    validation: {
      codeRequired: baseCopy.validation?.codeRequired || "El código es obligatorio.",
      codeUnique: baseCopy.validation?.codeUnique || "El código debe ser único.",
      nameRequired: baseCopy.validation?.nameRequired || "El nombre es obligatorio.",
      typeRequired: baseCopy.validation?.typeRequired || "El tipo es obligatorio.",
      camundaRequired:
        baseCopy.validation?.camundaRequired || "El ID del proceso de Camunda es obligatorio.",
      requiredFieldsRequired:
        baseCopy.validation?.requiredFieldsRequired || "Debe existir al menos un campo solicitado.",
      channelsRequired:
        baseCopy.validation?.channelsRequired || "Debe haber al menos un canal habilitado.",
    },
  };
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const procedureCopy = getProcedureCopy(copy.admin.procedures);

  const [windowDays, setWindowDays] = useState(7);
  const [activeTab, setActiveTab] = useState(ADMIN_TABS.PROCEDURES);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [metrics, setMetrics] = useState(null);

  const [isLoadingProcedures, setIsLoadingProcedures] = useState(false);
  const [proceduresError, setProceduresError] = useState("");
  const [procedureSuccessMessage, setProcedureSuccessMessage] = useState("");
  const [procedures, setProcedures] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedProcedureCode, setExpandedProcedureCode] = useState("");
  const [editingFieldIndex, setEditingFieldIndex] = useState(-1);
  const [formState, setFormState] = useState(() => createProcedureFormState());
  const [isSavingProcedure, setIsSavingProcedure] = useState(false);
  const [togglingCode, setTogglingCode] = useState("");
  const [deletingCode, setDeletingCode] = useState("");

  const isAdministrator = user?.role === "administrador";
  const funnel = metrics?.funnel || null;

  const orderedEventCounts = useMemo(() => {
    const counts = metrics?.eventCounts || {};
    return Object.entries(counts).sort((firstEntry, secondEntry) => secondEntry[1] - firstEntry[1]);
  }, [metrics?.eventCounts]);

  const filteredProcedures = useMemo(() => {
    const query = normalizeSimpleText(searchText, 120).toLowerCase();
    return procedures.filter((procedure) => {
      const statusMatch = statusFilter === "active" ? Boolean(procedure.isActive) : true;
      if (!statusMatch) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        normalizeSimpleText(procedure.name, 160).toLowerCase().includes(query) ||
        normalizeSimpleText(procedure.code, 120).toLowerCase().includes(query)
      );
    });
  }, [procedures, searchText, statusFilter]);

  const procedureSummary = useMemo(() => {
    const total = procedures.length;
    const active = procedures.filter((item) => item.isActive).length;
    const inactive = total - active;
    const integrated = procedures.filter((item) =>
      Boolean(normalizeSimpleText(item.camundaProcessId, 160))
    ).length;
    return { total, active, inactive, integrated };
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
        if (error.name !== "AbortError") {
          setErrorMessage(error.message || copy.admin.loadError);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadMetrics();
    return () => abortController.abort();
  }, [copy.admin.loadError, isAdministrator, locale, router, user, windowDays]);

  const loadProcedures = useCallback(async (signal = undefined) => {
    setIsLoadingProcedures(true);
    setProceduresError("");
    try {
      const response = await fetch(`/api/admin/procedures?locale=${locale}&includeInactive=true`, { signal });
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
      if (error.name !== "AbortError") {
        setProceduresError(error.message || procedureCopy.loadError);
      }
    } finally {
      setIsLoadingProcedures(false);
    }
  }, [locale, procedureCopy.loadError, router]);

  useEffect(() => {
    if (!user || !isAdministrator || activeTab !== ADMIN_TABS.PROCEDURES) {
      return;
    }
    const abortController = new AbortController();
    loadProcedures(abortController.signal);
    return () => abortController.abort();
  }, [activeTab, isAdministrator, loadProcedures, user]);

  const openCreateForm = () => {
    setExpandedProcedureCode("__new__");
    setEditingFieldIndex(-1);
    setFormState(
      createProcedureFormState({
        code: "",
        name: "",
        category: "Incidencia",
        isActive: true,
        camundaProcessId: "",
        requiredFields: DEFAULT_REQUIRED_FIELDS,
        enabledChannels: ["web", "whatsapp"],
      })
    );
    setProcedureSuccessMessage("");
    setProceduresError("");
  };

  const openEditForm = (procedure) => {
    setExpandedProcedureCode(procedure.code);
    setEditingFieldIndex(-1);
    setFormState(createProcedureFormState(procedure));
    setProcedureSuccessMessage("");
    setProceduresError("");
  };

  const closeExpandedForm = () => {
    setExpandedProcedureCode("");
    setEditingFieldIndex(-1);
    setFormState(createProcedureFormState());
  };

  const updateFormField = (fieldName, value) => {
    setFormState((previousState) => ({ ...previousState, [fieldName]: value }));
  };

  const updateRequiredField = (index, patch) => {
    setFormState((previousState) => ({
      ...previousState,
      requiredFields: previousState.requiredFields.map((field, fieldIndex) => {
        if (fieldIndex !== index) {
          return field;
        }
        const nextLabel =
          patch.label !== undefined ? normalizeSimpleText(patch.label, 80) : field.label;
        const nextKey = normalizeCode(patch.key !== undefined ? patch.key : nextLabel || field.key);
        return {
          ...field,
          ...patch,
          key: nextKey || field.key,
          label: nextLabel || field.label,
          order: fieldIndex + 1,
        };
      }),
    }));
  };

  const deleteRequiredField = (index) => {
    setFormState((previousState) => ({
      ...previousState,
      requiredFields: previousState.requiredFields
        .filter((_, fieldIndex) => fieldIndex !== index)
        .map((field, fieldIndex) => ({ ...field, order: fieldIndex + 1 })),
    }));
    setEditingFieldIndex(-1);
  };

  const addRequiredField = () => {
    setFormState((previousState) => {
      const nextIndex = previousState.requiredFields.length + 1;
      return {
        ...previousState,
        requiredFields: [
          ...previousState.requiredFields,
          {
            key: `campo_${nextIndex}`,
            label: `Campo ${nextIndex}`,
            type: "text",
            required: true,
            order: nextIndex,
          },
        ],
      };
    });
  };

  const toggleChannel = (channel) => {
    setFormState((previousState) => {
      const normalized = normalizeSimpleText(channel, 20).toLowerCase();
      const hasChannel = previousState.enabledChannels.includes(normalized);
      return {
        ...previousState,
        enabledChannels: hasChannel
          ? previousState.enabledChannels.filter((item) => item !== normalized)
          : [...previousState.enabledChannels, normalized],
      };
    });
  };

  const validateProcedureForm = () => {
    const code = normalizeCode(formState.code);
    const name = normalizeSimpleText(formState.name, 160);
    const type = normalizeSimpleText(formState.type, 80);
    const camundaProcessId = normalizeSimpleText(formState.camundaProcessId, 160);
    const camundaVersion = normalizeSimpleText(formState.camundaVersion, 80);
    const requiredFields = formState.requiredFields
      .map((field, index) => ({
        key: normalizeCode(field.key || field.label || `field_${index + 1}`),
        label: normalizeSimpleText(field.label, 80),
        type: normalizeSimpleText(field.type, 24).toLowerCase() || "text",
        required: field.required !== false,
        order: index + 1,
      }))
      .filter((field) => field.key && field.label);
    const enabledChannels = Array.from(
      new Set(formState.enabledChannels.map((channel) => normalizeSimpleText(channel, 20).toLowerCase()))
    ).filter(Boolean);
    let camundaVariableMappings = [];
    let taskUiDictionary = [];
    if (normalizeSimpleText(formState.camundaVariableMappingsJson, 12000)) {
      try {
        const parsed = JSON.parse(formState.camundaVariableMappingsJson);
        if (!Array.isArray(parsed)) {
          return {
            ok: false,
            error:
              "El mapeo de variables Camunda debe ser un arreglo JSON. Ejemplo: [{\"scope\":\"START_INSTANCE\",\"procedureFieldKey\":\"description\",\"camundaVariableName\":\"descripcion\"}]",
          };
        }
        camundaVariableMappings = parsed;
      } catch (_error) {
        return { ok: false, error: "El JSON de mapeo de variables Camunda no es válido." };
      }
    }
    if (normalizeSimpleText(formState.taskUiDictionaryJson, 20000)) {
      try {
        const parsed = JSON.parse(formState.taskUiDictionaryJson);
        if (Array.isArray(parsed)) {
          taskUiDictionary = parsed;
        } else if (parsed && typeof parsed === "object") {
          taskUiDictionary = Object.entries(parsed).map(([taskDefinitionKey, config]) => ({
            taskDefinitionKey,
            ...(config && typeof config === "object" ? config : {}),
          }));
        } else {
          return {
            ok: false,
            error:
              "El diccionario de tareas debe ser un objeto o arreglo JSON. Ejemplo: {\"validar\":{\"title\":\"Revisar\"}}",
          };
        }
      } catch (_error) {
        return { ok: false, error: "El JSON del diccionario de tareas no es válido." };
      }
    }

    if (!name) {
      return { ok: false, error: procedureCopy.validation.nameRequired };
    }
    if (!code) {
      return { ok: false, error: procedureCopy.validation.codeRequired };
    }
    if (!type) {
      return { ok: false, error: procedureCopy.validation.typeRequired };
    }
    if (!camundaProcessId) {
      return { ok: false, error: procedureCopy.validation.camundaRequired };
    }
    if (!requiredFields.length) {
      return { ok: false, error: procedureCopy.validation.requiredFieldsRequired };
    }
    if (!enabledChannels.length) {
      return { ok: false, error: procedureCopy.validation.channelsRequired };
    }

    const duplicate = procedures.find(
      (procedure) => procedure.code === code && procedure.code !== formState.originalCode
    );
    if (duplicate) {
      return { ok: false, error: procedureCopy.validation.codeUnique };
    }

    const flowDefinition =
      formState.flowDefinitionBase && typeof formState.flowDefinitionBase === "object"
        ? { ...formState.flowDefinitionBase }
        : {};
    if (taskUiDictionary.length > 0) {
      flowDefinition.taskUiDictionary = taskUiDictionary;
    } else {
      delete flowDefinition.taskUiDictionary;
    }

    return {
      ok: true,
      payload: {
        originalCode: formState.originalCode || code,
        code,
        name,
        category: type,
        description: normalizeSimpleText(formState.description, 320),
        aliases: [],
        keywords: [],
        isActive: Boolean(formState.isActive),
        camundaProcessId,
        camundaVersion,
        enabledChannels,
        requiredFields,
        camundaVariableMappings,
        flowDefinition,
      },
    };
  };

  const submitProcedure = async (event) => {
    event.preventDefault();
    setProcedureSuccessMessage("");
    setProceduresError("");

    const validation = validateProcedureForm();
    if (!validation.ok) {
      setProceduresError(validation.error || procedureCopy.loadError);
      return;
    }

    setIsSavingProcedure(true);
    try {
      const isCreateMode = expandedProcedureCode === "__new__";
      const method = isCreateMode ? "POST" : "PATCH";
      const response = await fetch("/api/admin/procedures", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }
      await loadProcedures();
      setProcedureSuccessMessage(isCreateMode ? procedureCopy.successCreated : procedureCopy.successSaved);
      closeExpandedForm();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: procedure.code,
          originalCode: procedure.code,
          isActive: !procedure.isActive,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }
      await loadProcedures();
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
    if (procedure.isActive) {
      setProceduresError(procedureCopy.confirmDisableFirst || "Primero deshabilita el procedimiento.");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: procedure.code }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || procedureCopy.loadError);
      }
      await loadProcedures();
      setProcedureSuccessMessage(procedureCopy.successDeleted);
      if (expandedProcedureCode === procedure.code) {
        closeExpandedForm();
      }
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
      <AdminPanelNav />

      <section className="card dashboard-section admin-tabs">
        <div role="tablist" aria-label={copy.portal.adminDashboard} className="admin-tabs__list">
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
            <ProcedureSummaryCard icon="📋" label={procedureCopy.summaryTotal} value={procedureSummary.total} />
            <ProcedureSummaryCard icon="✅" label={procedureCopy.summaryActive} value={procedureSummary.active} />
            <ProcedureSummaryCard
              icon="⏸"
              label={procedureCopy.summaryInactive}
              value={procedureSummary.inactive}
            />
            <ProcedureSummaryCard
              icon="🔗"
              label={procedureCopy.summaryBpmn}
              value={procedureSummary.integrated}
            />
          </section>

          <section className="card dashboard-section admin-procedure-toolbar">
            <div className="admin-procedure-toolbar__content admin-procedure-toolbar__content--full">
              <input
                type="search"
                aria-label={procedureCopy.searchPlaceholder}
                placeholder={procedureCopy.searchPlaceholder}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                disabled={isLoadingProcedures}
              />
              <div className="admin-procedure-toolbar__filters">
                <button
                  type="button"
                  className={`button-inline ${statusFilter === "all" ? "button-inline--selected" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  {procedureCopy.filterAll}
                </button>
                <button
                  type="button"
                  className={`button-inline ${statusFilter === "active" ? "button-inline--selected" : ""}`}
                  onClick={() => setStatusFilter("active")}
                >
                  {procedureCopy.filterActive}
                </button>
              </div>
            </div>
            <div className="admin-procedure-toolbar__actions">
              <button type="button" onClick={openCreateForm}>
                {procedureCopy.newProcedureCta}
              </button>
            </div>
          </section>

          {expandedProcedureCode === "__new__" ? (
            <section className="card dashboard-section admin-procedure-form">
              <form onSubmit={submitProcedure}>
                <div className="admin-procedure-form__header">
                  <div>
                    <h3>{procedureCopy.form?.editTitle || "Edición del procedimiento"}</h3>
                    <p className="small">
                      {procedureCopy.form?.editDescription ||
                        "Modifica los datos y la estructura del procedimiento."}
                    </p>
                  </div>
                  <button type="button" className="button-inline" onClick={closeExpandedForm}>
                    {procedureCopy.collapse}
                  </button>
                </div>

                <div className="admin-procedure-form__grid">
                  <div>
                    <label htmlFor="new-procedure-name">Nombre del procedimiento *</label>
                    <input
                      id="new-procedure-name"
                      type="text"
                      value={formState.name}
                      onChange={(event) => updateFormField("name", event.target.value)}
                      disabled={isSavingProcedure}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-procedure-code">Código *</label>
                    <input
                      id="new-procedure-code"
                      type="text"
                      value={formState.code}
                      onChange={(event) => updateFormField("code", event.target.value)}
                      disabled={isSavingProcedure}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-procedure-type">Tipo *</label>
                    <input
                      id="new-procedure-type"
                      type="text"
                      value={formState.type}
                      onChange={(event) => updateFormField("type", event.target.value)}
                      disabled={isSavingProcedure}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-procedure-status">Estado</label>
                    <select
                      id="new-procedure-status"
                      value={formState.isActive ? "active" : "inactive"}
                      onChange={(event) => updateFormField("isActive", event.target.value === "active")}
                      disabled={isSavingProcedure}
                    >
                      <option value="active">{procedureCopy.active}</option>
                      <option value="inactive">{procedureCopy.inactive}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="new-procedure-camunda">ID del proceso de Camunda *</label>
                    <input
                      id="new-procedure-camunda"
                      type="text"
                      value={formState.camundaProcessId}
                      onChange={(event) => updateFormField("camundaProcessId", event.target.value)}
                      disabled={isSavingProcedure}
                    />
                  </div>
                  <div>
                    <label htmlFor="new-procedure-camunda-version">Versión Camunda (opcional)</label>
                    <input
                      id="new-procedure-camunda-version"
                      type="text"
                      value={formState.camundaVersion}
                      onChange={(event) => updateFormField("camundaVersion", event.target.value)}
                      disabled={isSavingProcedure}
                    />
                  </div>
                </div>

                <section className="admin-procedure-fields">
                  <h4>Mapeo de variables Camunda</h4>
                  <p className="small">
                    Configura un arreglo JSON con mapeos por scope. Usa `START_INSTANCE` o `COMPLETE_TASK` y, para tareas, `camundaTaskDefinitionKey`.
                  </p>
                  <pre className="small">
                    {`START_INSTANCE:\n${CAMUNDA_MAPPING_EXAMPLE_START_INSTANCE}\n\nCOMPLETE_TASK:\n${CAMUNDA_MAPPING_EXAMPLE_COMPLETE_TASK}`}
                  </pre>
                  <label htmlFor="new-procedure-camunda-mappings" className="small">
                    JSON de mapeo
                  </label>
                  <textarea
                    id="new-procedure-camunda-mappings"
                    value={formState.camundaVariableMappingsJson}
                    onChange={(event) => updateFormField("camundaVariableMappingsJson", event.target.value)}
                    rows={8}
                    disabled={isSavingProcedure}
                  />
                </section>

                <section className="admin-procedure-fields">
                  <h4>Diccionario funcional de tareas Camunda</h4>
                  <p className="small">
                    Define cómo se muestran en la bandeja los textos por `taskDefinitionKey` (título, descripción,
                    botón principal y variables con labels amigables).
                  </p>
                  <pre className="small">{TASK_UI_DICTIONARY_EXAMPLE}</pre>
                  <label htmlFor="new-procedure-task-ui-dictionary" className="small">
                    JSON del diccionario por tarea
                  </label>
                  <textarea
                    id="new-procedure-task-ui-dictionary"
                    value={formState.taskUiDictionaryJson}
                    onChange={(event) => updateFormField("taskUiDictionaryJson", event.target.value)}
                    rows={10}
                    disabled={isSavingProcedure}
                  />
                </section>

                <div className="admin-procedure-form__actions">
                  <button type="button" className="button-inline" onClick={closeExpandedForm} disabled={isSavingProcedure}>
                    {procedureCopy.cancel}
                  </button>
                  <button type="submit" disabled={isSavingProcedure}>
                    {isSavingProcedure ? procedureCopy.saving : procedureCopy.save}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {isLoadingProcedures ? (
            <section className="card">
              <p className="info-message">{procedureCopy.loading}</p>
            </section>
          ) : null}

          {!isLoadingProcedures ? (
            <section className="card dashboard-section">
              <div className="admin-procedure-table__header">
                <h3>{procedureCopy.configuredTitle}</h3>
                <p className="small">{procedureCopy.configuredDescription}</p>
              </div>

              <div className="admin-procedure-table__container" aria-label={procedureCopy.listAria}>
                <table className="admin-procedure-table">
                  <thead>
                    <tr>
                      <th>{procedureCopy.tableNameHeader}</th>
                      <th>{procedureCopy.tableCodeHeader}</th>
                      <th>{procedureCopy.tableCategoryHeader}</th>
                      <th>{procedureCopy.tableStatusHeader}</th>
                      <th>{procedureCopy.tableBpmnHeader}</th>
                      <th>{procedureCopy.tableUpdatedAtHeader}</th>
                      <th>{procedureCopy.tableActionsHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcedures.map((procedure) => {
                      const isExpanded = expandedProcedureCode === procedure.code;
                      return (
                        <Fragment key={procedure.code}>
                          <tr>
                            <td>
                              <p className="admin-procedure-table__primary">{procedure.name}</p>
                              {procedure.description ? (
                                <p className="admin-procedure-table__secondary">{procedure.description}</p>
                              ) : null}
                            </td>
                            <td className="admin-procedure-table__mono">{procedure.code}</td>
                            <td>{resolveProcedureTypeForDisplay(procedure)}</td>
                            <td>
                              <ProcedureStatusBadge isActive={Boolean(procedure.isActive)} copy={procedureCopy} />
                            </td>
                            <td className="admin-procedure-table__mono">{procedure.camundaProcessId || "-"}</td>
                            <td>{formatProcedureUpdatedAt(procedure.updatedAt, locale)}</td>
                            <td>
                              <div className="admin-procedure-item__actions">
                                <button
                                  type="button"
                                  className="button-inline"
                                  onClick={() => openEditForm(procedure)}
                                  disabled={isSavingProcedure || togglingCode === procedure.code || deletingCode === procedure.code}
                                >
                                  {procedureCopy.edit}
                                </button>
                                {procedure.isActive ? (
                                  <button
                                    type="button"
                                    className="button-inline"
                                    onClick={() => handleToggleProcedureStatus(procedure)}
                                    disabled={isSavingProcedure || togglingCode === procedure.code || deletingCode === procedure.code}
                                  >
                                    {togglingCode === procedure.code
                                      ? procedureCopy.statusToggling
                                      : procedureCopy.deactivate}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="button-inline button-inline--danger"
                                    onClick={() => handleDeleteProcedure(procedure)}
                                    disabled={isSavingProcedure || togglingCode === procedure.code || deletingCode === procedure.code}
                                  >
                                    {deletingCode === procedure.code ? procedureCopy.deleting : procedureCopy.delete}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr>
                              <td colSpan={7}>
                                <form className="admin-procedure-form" onSubmit={submitProcedure}>
                                  <div className="admin-procedure-form__header">
                                    <div>
                                      <h3>{procedureCopy.form?.editTitle || "Edición del procedimiento"}</h3>
                                      <p className="small">
                                        {procedureCopy.form?.editDescription ||
                                          "Modifica los datos y la estructura del procedimiento."}
                                      </p>
                                    </div>
                                    <button type="button" className="button-inline" onClick={closeExpandedForm}>
                                      {procedureCopy.collapse}
                                    </button>
                                  </div>

                                  <div className="admin-procedure-form__grid">
                                    <div>
                                      <label htmlFor={`name-${procedure.code}`}>Nombre del procedimiento *</label>
                                      <input
                                        id={`name-${procedure.code}`}
                                        type="text"
                                        value={formState.name}
                                        onChange={(event) => updateFormField("name", event.target.value)}
                                        disabled={isSavingProcedure}
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`code-${procedure.code}`}>Código *</label>
                                      <input
                                        id={`code-${procedure.code}`}
                                        type="text"
                                        value={formState.code}
                                        onChange={(event) => updateFormField("code", event.target.value)}
                                        disabled={isSavingProcedure}
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`type-${procedure.code}`}>Tipo *</label>
                                      <input
                                        id={`type-${procedure.code}`}
                                        type="text"
                                        value={formState.type}
                                        onChange={(event) => updateFormField("type", event.target.value)}
                                        disabled={isSavingProcedure}
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`status-${procedure.code}`}>Estado</label>
                                      <select
                                        id={`status-${procedure.code}`}
                                        value={formState.isActive ? "active" : "inactive"}
                                        onChange={(event) =>
                                          updateFormField("isActive", event.target.value === "active")
                                        }
                                        disabled={isSavingProcedure}
                                      >
                                        <option value="active">{procedureCopy.active}</option>
                                        <option value="inactive">{procedureCopy.inactive}</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label htmlFor={`camunda-${procedure.code}`}>ID del proceso de Camunda *</label>
                                      <input
                                        id={`camunda-${procedure.code}`}
                                        type="text"
                                        value={formState.camundaProcessId}
                                        onChange={(event) =>
                                          updateFormField("camundaProcessId", event.target.value)
                                        }
                                        disabled={isSavingProcedure}
                                      />
                                    </div>
                                    <div>
                                      <label htmlFor={`camunda-version-${procedure.code}`}>
                                        Versión Camunda (opcional)
                                      </label>
                                      <input
                                        id={`camunda-version-${procedure.code}`}
                                        type="text"
                                        value={formState.camundaVersion}
                                        onChange={(event) =>
                                          updateFormField("camundaVersion", event.target.value)
                                        }
                                        disabled={isSavingProcedure}
                                      />
                                    </div>
                                  </div>

                                  <section className="admin-procedure-fields">
                                    <h4>Mapeo de variables Camunda</h4>
                                    <p className="small">
                                      Define variables por scope (`START_INSTANCE`, `COMPLETE_TASK`) y
                                      `camundaTaskDefinitionKey` cuando corresponda.
                                    </p>
                                    <pre className="small">
                                      {`START_INSTANCE:\n${CAMUNDA_MAPPING_EXAMPLE_START_INSTANCE}\n\nCOMPLETE_TASK:\n${CAMUNDA_MAPPING_EXAMPLE_COMPLETE_TASK}`}
                                    </pre>
                                    <label
                                      htmlFor={`camunda-mappings-${procedure.code}`}
                                      className="small"
                                    >
                                      JSON de mapeo
                                    </label>
                                    <textarea
                                      id={`camunda-mappings-${procedure.code}`}
                                      value={formState.camundaVariableMappingsJson}
                                      onChange={(event) =>
                                        updateFormField("camundaVariableMappingsJson", event.target.value)
                                      }
                                      rows={8}
                                      disabled={isSavingProcedure}
                                    />
                                  </section>

                                  <section className="admin-procedure-fields">
                                    <h4>Diccionario funcional de tareas Camunda</h4>
                                    <p className="small">
                                      Configura textos funcionales por `taskDefinitionKey` para la bandeja de
                                      expedientes (título, descripción, botón principal y labels de variables).
                                    </p>
                                    <pre className="small">{TASK_UI_DICTIONARY_EXAMPLE}</pre>
                                    <label
                                      htmlFor={`task-ui-dictionary-${procedure.code}`}
                                      className="small"
                                    >
                                      JSON del diccionario por tarea
                                    </label>
                                    <textarea
                                      id={`task-ui-dictionary-${procedure.code}`}
                                      value={formState.taskUiDictionaryJson}
                                      onChange={(event) =>
                                        updateFormField("taskUiDictionaryJson", event.target.value)
                                      }
                                      rows={10}
                                      disabled={isSavingProcedure}
                                    />
                                  </section>

                                  <section className="admin-procedure-fields">
                                    <h4>Campos solicitados</h4>
                                    <p className="small">
                                      Ordena y administra los campos que el chatbot debe solicitar.
                                    </p>
                                    <ul className="admin-procedure-fields__list">
                                      {formState.requiredFields.map((field, index) => {
                                        const isEditing = editingFieldIndex === index;
                                        return (
                                          <li key={`${field.key}-${index}`} className="admin-procedure-fields__item">
                                            <div className="admin-procedure-fields__row">
                                              <span aria-hidden="true">≡</span>
                                              <strong>{field.label}</strong>
                                              <span className="small">
                                                Tipo: {getFieldTypeLabel(field.type, locale)}
                                              </span>
                                              <button
                                                type="button"
                                                className="button-inline"
                                                onClick={() =>
                                                  setEditingFieldIndex(isEditing ? -1 : index)
                                                }
                                              >
                                                Editar
                                              </button>
                                              <button
                                                type="button"
                                                className="button-inline button-inline--danger"
                                                onClick={() => deleteRequiredField(index)}
                                                disabled={isSavingProcedure}
                                              >
                                                Eliminar
                                              </button>
                                            </div>
                                            {isEditing ? (
                                              <div className="admin-procedure-fields__edit">
                                                <label htmlFor={`field-label-${procedure.code}-${index}`}>
                                                  Nombre del campo
                                                </label>
                                                <input
                                                  id={`field-label-${procedure.code}-${index}`}
                                                  type="text"
                                                  value={field.label}
                                                  onChange={(event) =>
                                                    updateRequiredField(index, { label: event.target.value })
                                                  }
                                                  disabled={isSavingProcedure}
                                                />
                                                <label htmlFor={`field-type-${procedure.code}-${index}`}>
                                                  Tipo
                                                </label>
                                                <select
                                                  id={`field-type-${procedure.code}-${index}`}
                                                  value={field.type}
                                                  onChange={(event) =>
                                                    updateRequiredField(index, { type: event.target.value })
                                                  }
                                                  disabled={isSavingProcedure}
                                                >
                                                  {FIELD_TYPE_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                      {option.label}
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                            ) : null}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                    <button type="button" className="button-inline" onClick={addRequiredField}>
                                      Agregar campo
                                    </button>
                                  </section>

                                  <section className="admin-procedure-fields">
                                    <h4>Canales habilitados</h4>
                                    <p className="small">
                                      Selecciona los canales por los que estará disponible este procedimiento.
                                    </p>
                                    <div className="admin-procedure-channels">
                                      <label className="admin-procedure-channel">
                                        <input
                                          type="checkbox"
                                          checked={formState.enabledChannels.includes("web")}
                                          onChange={() => toggleChannel("web")}
                                          disabled={isSavingProcedure}
                                        />
                                        <span>Web</span>
                                      </label>
                                      <label className="admin-procedure-channel">
                                        <input
                                          type="checkbox"
                                          checked={formState.enabledChannels.includes("whatsapp")}
                                          onChange={() => toggleChannel("whatsapp")}
                                          disabled={isSavingProcedure}
                                        />
                                        <span>WhatsApp</span>
                                      </label>
                                    </div>
                                  </section>

                                  <div className="admin-procedure-form__actions">
                                    <button
                                      type="button"
                                      className="button-inline"
                                      onClick={closeExpandedForm}
                                      disabled={isSavingProcedure}
                                    >
                                      {procedureCopy.cancel}
                                    </button>
                                    <button type="submit" disabled={isSavingProcedure}>
                                      {isSavingProcedure ? procedureCopy.saving : procedureCopy.save}
                                    </button>
                                  </div>
                                </form>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!filteredProcedures.length ? <p className="empty-message">{procedureCopy.noResults}</p> : null}
            </section>
          ) : null}

        </>
      )}
    </main>
  );
}

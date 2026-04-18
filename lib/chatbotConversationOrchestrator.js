import { CHATBOT_CONVERSATION_STATES } from "./chatSessionStore";
import {
  computeMissingIncidentFields,
  extractIncidentDraftFromParameters,
  extractIncidentDraftFromText,
  getIncidentCategoryOptions,
  mergeIncidentDraft,
  normalizeIncidentCategory,
  normalizeIncidentDraft,
} from "./chatbotIncidentMapper";

const INCIDENT_SIGNAL_KEYWORDS = [
  "incidencia",
  "incidente",
  "reportar",
  "reporte",
  "problema",
  "bache",
  "basura",
  "luz",
  "alumbrado",
  "issue",
  "report",
];
const STATUS_SIGNAL_KEYWORDS = [
  "estado",
  "seguimiento",
  "consultar",
  "tracking",
  "status",
  "acompanamiento",
];
const PROCEDURE_SIGNAL_KEYWORDS = [
  "tramite",
  "tramite",
  "solicitud",
  "gestion",
  "gestion",
  "documentacion",
  "documents",
  "procedure",
];
const INCIDENT_ACTION_HINTS = new Set(["crear_incidencia", "reportar_problema"]);
const STATUS_ACTION_HINTS = new Set(["consultar_tramite", "consultar_estado_solicitud"]);
const PROCEDURE_ACTION_HINTS = new Set(["iniciar_tramite"]);
const INCIDENT_DRAFT_FIELDS = new Set(["category", "description", "location"]);

const CATEGORY_LABELS = {
  es: {
    alumbrado: "Alumbrado",
    limpieza: "Limpieza",
    seguridad: "Seguridad",
    infraestructura: "Infraestructura",
    otro: "Otro",
  },
  en: {
    alumbrado: "Lighting",
    limpieza: "Cleaning",
    seguridad: "Safety",
    infraestructura: "Infrastructure",
    otro: "Other",
  },
  pt: {
    alumbrado: "Iluminacao",
    limpieza: "Limpeza",
    seguridad: "Seguranca",
    infraestructura: "Infraestrutura",
    otro: "Outro",
  },
};

function normalizeIntentKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function normalizeUserText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

function hasKeyword(text, keywords) {
  if (!text) {
    return false;
  }

  const normalizedText = text.toLowerCase();
  return keywords.some((keyword) => normalizedText.includes(keyword));
}

function getLocaleMessages(locale) {
  if (locale === "en") {
    return {
      fallbackClarification:
        "I could not identify your request clearly yet. Tell me if this is a report, a procedure, or a status inquiry.",
      askField: {
        category:
          "To route this quickly, choose the category that best matches your report.",
        description:
          "Great. Please tell me what is happening and since when, in one short description.",
        location: "Now share the exact location where this is happening.",
      },
      confirmTitle:
        "Perfect, I already have the minimum information. Please review and confirm:",
      confirmActions: {
        confirm: "Confirm and submit ticket",
        editDescription: "Edit description",
        editLocation: "Edit location",
        cancel: "Cancel draft",
      },
      authRequired:
        "To submit the ticket I need you to sign in first. After signing in, return here and I will show your draft again.",
      cancelled:
        "Done. I canceled this incident draft. If you want, we can start a new report.",
      resumedAfterLogin:
        "Welcome back. I recovered your draft so you can confirm it now or edit any detail.",
      fieldLabels: {
        category: "Category",
        description: "Description",
        location: "Location",
      },
    };
  }

  if (locale === "pt") {
    return {
      fallbackClarification:
        "Ainda nao consegui identificar claramente sua solicitacao. Diga se e um reporte, um tramite ou uma consulta de status.",
      askField: {
        category:
          "Para encaminhar mais rapido, qual categoria descreve melhor o problema?",
        description:
          "Perfeito. Conte em uma frase o que esta acontecendo e desde quando.",
        location: "Agora informe a localizacao exata do problema.",
      },
      confirmTitle:
        "Perfeito, ja tenho os dados minimos. Revise e confirme:",
      confirmActions: {
        confirm: "Confirmar e enviar ticket",
        editDescription: "Editar descricao",
        editLocation: "Editar localizacao",
        cancel: "Cancelar rascunho",
      },
      authRequired:
        "Para enviar o ticket preciso que voce faca login. Depois de entrar, volte aqui que eu reexibo seu rascunho.",
      cancelled:
        "Pronto. Cancelei este rascunho de incidencia. Se quiser, podemos iniciar um novo reporte.",
      resumedAfterLogin:
        "Bem-vindo de volta. Recuperei seu rascunho para voce confirmar agora ou editar algum detalhe.",
      fieldLabels: {
        category: "Categoria",
        description: "Descricao",
        location: "Localizacao",
      },
    };
  }

  return {
    fallbackClarification:
      "Todavia no pude identificar con claridad tu solicitud. Contame si se trata de un reporte, un tramite o una consulta de estado.",
    askField: {
      category:
        "Para derivarlo mas rapido, que categoria describe mejor la incidencia?",
      description:
        "Perfecto. Contame en una frase que esta pasando y desde cuando.",
      location: "Ahora indicame la ubicacion exacta del problema.",
    },
    confirmTitle:
      "Perfecto, ya tengo los datos minimos. Revisa este resumen y confirma:",
    confirmActions: {
      confirm: "Confirmar y enviar ticket",
      editDescription: "Editar descripcion",
      editLocation: "Editar ubicacion",
      cancel: "Cancelar borrador",
    },
    authRequired:
      "Para enviar el ticket necesito que inicies sesión primero. Cuando ingreses, vuelve al chat y te muestro el borrador para confirmar.",
    cancelled:
      "Listo, cancele este borrador de incidencia. Si quieres, iniciamos otro reporte.",
    resumedAfterLogin:
      "Bienvenido de nuevo. Recupere tu borrador para que puedas confirmarlo ahora o editar algun dato.",
    fieldLabels: {
      category: "Categoria",
      description: "Descripcion",
      location: "Ubicacion",
    },
  };
}

function resolveConversationMode({
  intent,
  action,
  text,
  state,
  shouldAskClarification,
}) {
  const normalizedAction = normalizeIntentKey(action);
  const normalizedIntent = normalizeIntentKey(intent);
  const activeIncidentSession =
    state === CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT ||
    state === CHATBOT_CONVERSATION_STATES.AWAITING_INCIDENT_CONFIRMATION;

  const incidentFromIntent =
    INCIDENT_ACTION_HINTS.has(normalizedAction) ||
    INCIDENT_ACTION_HINTS.has(normalizedIntent);
  const statusFromIntent =
    STATUS_ACTION_HINTS.has(normalizedAction) || STATUS_ACTION_HINTS.has(normalizedIntent);
  const procedureFromIntent =
    PROCEDURE_ACTION_HINTS.has(normalizedAction) ||
    PROCEDURE_ACTION_HINTS.has(normalizedIntent);
  const incidentFromText = hasKeyword(text, INCIDENT_SIGNAL_KEYWORDS);
  const statusFromText = hasKeyword(text, STATUS_SIGNAL_KEYWORDS);
  const procedureFromText = hasKeyword(text, PROCEDURE_SIGNAL_KEYWORDS);

  if (activeIncidentSession || incidentFromIntent || incidentFromText) {
    return "incident";
  }

  if (shouldAskClarification) {
    return "fallback";
  }

  if (statusFromIntent || statusFromText) {
    return "status";
  }

  if (procedureFromIntent || procedureFromText) {
    return "procedure";
  }

  return "procedure";
}

function applyPendingFieldAnswer({ pendingField, text, draft }) {
  if (!pendingField) {
    return draft;
  }

  const normalizedDraft = normalizeIncidentDraft(draft);
  const userText = normalizeUserText(text);
  if (!userText) {
    return normalizedDraft;
  }

  if (pendingField === "category") {
    const category = normalizeIncidentCategory(userText);
    return {
      ...normalizedDraft,
      category: category || normalizedDraft.category,
    };
  }

  if (pendingField === "description") {
    return {
      ...normalizedDraft,
      description: userText,
    };
  }

  if (pendingField === "location") {
    return {
      ...normalizedDraft,
      location: userText,
    };
  }

  return normalizedDraft;
}

function buildCategoryActionOptions(locale) {
  const labels = CATEGORY_LABELS[locale] || CATEGORY_LABELS.es;
  return getIncidentCategoryOptions().map((category) => ({
    label: labels[category] || category,
    command: "none",
    value: category,
  }));
}

function buildIncidentConfirmationActionOptions(locale) {
  const messages = getLocaleMessages(locale);
  return [
    {
      label: messages.confirmActions.confirm,
      command: "confirm_incident",
    },
    {
      label: messages.confirmActions.editDescription,
      command: "edit_incident_description",
    },
    {
      label: messages.confirmActions.editLocation,
      command: "edit_incident_location",
    },
    {
      label: messages.confirmActions.cancel,
      command: "cancel_incident",
    },
  ];
}

function buildIncidentSummary(draft, locale) {
  const messages = getLocaleMessages(locale);
  const labels = CATEGORY_LABELS[locale] || CATEGORY_LABELS.es;
  const categoryLabel = labels[draft.category] || draft.category;

  return `${messages.fieldLabels.category}: ${categoryLabel}
${messages.fieldLabels.description}: ${draft.description}
${messages.fieldLabels.location}: ${draft.location}`;
}

export function buildCancelledIncidentReply(locale) {
  return getLocaleMessages(locale).cancelled;
}

export function buildAuthRequiredReply(locale) {
  return getLocaleMessages(locale).authRequired;
}

export function buildIncidentResumeReply(locale) {
  return getLocaleMessages(locale).resumedAfterLogin;
}

export { buildIncidentConfirmationActionOptions };

export function buildIncidentCreatedReply({ locale, incidentId }) {
  if (locale === "en") {
    return `Done, I created your incident ticket successfully. Case ID: ${incidentId}.`;
  }
  if (locale === "pt") {
    return `Pronto, criei seu ticket de incidencia com sucesso. Codigo do caso: ${incidentId}.`;
  }

  return `Listo, cree tu ticket de incidencia correctamente. Codigo del caso: ${incidentId}.`;
}

export function buildIncidentFlowFromDialogTurn({
  text,
  locale,
  shouldAskClarification,
  dialogflowResponse,
  sessionSnapshot,
}) {
  const messages = getLocaleMessages(locale);
  const mode = resolveConversationMode({
    intent: dialogflowResponse?.intent,
    action: dialogflowResponse?.action,
    text,
    state: sessionSnapshot?.state,
    shouldAskClarification,
  });
  const previousDraft = normalizeIncidentDraft(sessionSnapshot?.draft);
  const pendingField = sessionSnapshot?.pendingField || null;

  if (mode !== "incident") {
    if (shouldAskClarification) {
      return {
        mode: "fallback",
        state: CHATBOT_CONVERSATION_STATES.FALLBACK_CLARIFICATION,
        pendingField: null,
        draft: previousDraft,
        nextStep: {
          type: "clarify",
          field: null,
        },
        actionOptions: [],
        replyText: messages.fallbackClarification,
      };
    }

    return {
      mode,
      state:
        mode === "procedure"
          ? CHATBOT_CONVERSATION_STATES.GUIDING_PROCEDURE
          : CHATBOT_CONVERSATION_STATES.IDLE,
      pendingField: null,
      draft: previousDraft,
      nextStep: {
        type: "redirect",
        field: null,
      },
      actionOptions: [],
      replyText: dialogflowResponse?.replyText || messages.fallbackClarification,
    };
  }

  const fromParameters = extractIncidentDraftFromParameters(dialogflowResponse?.parameters);
  const fromText = extractIncidentDraftFromText(text);
  const mergedDraft = mergeIncidentDraft(
    applyPendingFieldAnswer({
      pendingField,
      text,
      draft: mergeIncidentDraft(previousDraft, fromParameters),
    }),
    fromText
  );
  const missingFields = computeMissingIncidentFields(mergedDraft);
  if (missingFields.length > 0) {
    const nextField = missingFields[0];

    return {
      mode: "incident",
      state: CHATBOT_CONVERSATION_STATES.COLLECTING_INCIDENT,
      pendingField: nextField,
      draft: mergedDraft,
      nextStep: {
        type: "ask_field",
        field: nextField,
      },
      actionOptions: nextField === "category" ? buildCategoryActionOptions(locale) : [],
      replyText: messages.askField[nextField] || messages.askField.description,
    };
  }

  return {
    mode: "incident",
    state: CHATBOT_CONVERSATION_STATES.AWAITING_INCIDENT_CONFIRMATION,
    pendingField: null,
    draft: mergedDraft,
    nextStep: {
      type: "confirm_incident",
      field: null,
    },
    actionOptions: buildIncidentConfirmationActionOptions(locale),
    replyText: `${messages.confirmTitle}
${buildIncidentSummary(mergedDraft, locale)}`,
  };
}

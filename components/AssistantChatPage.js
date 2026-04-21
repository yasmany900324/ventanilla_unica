"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const MAX_MESSAGE_LENGTH = 500;

const MAX_TEXTAREA_HEIGHT = 168;
const SESSION_ID_STORAGE_KEY = "chatbot_session_id";
const SESSION_LOCALE_STORAGE_KEY = "chatbot_session_locale";
const CHATBOT_MESSAGES_STORAGE_KEY = "chatbot_messages";
const CHATBOT_RESUME_PENDING_KEY = "chatbot_resume_pending";
const DEFAULT_CHAT_COMMAND = "none";
const MAX_PERSISTED_MESSAGES = 80;

function createLocalMessage(partial) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function normalizeInput(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function formatConfidence(confidence) {
  if (typeof confidence !== "number") {
    return null;
  }

  return `${Math.round(confidence * 100)}%`;
}

function formatMessageTime(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeChipLabel(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
}

function extractPayloadChips(fulfillmentMessages) {
  if (!Array.isArray(fulfillmentMessages)) {
    return [];
  }

  const chipSet = new Set();
  const addChip = (candidate) => {
    const normalized = normalizeChipLabel(candidate);
    if (normalized) {
      chipSet.add(normalized);
    }
  };

  fulfillmentMessages.forEach((message) => {
    if (message?.type !== "payload" || !message.payload || typeof message.payload !== "object") {
      return;
    }

    const payload = message.payload;
    if (Array.isArray(payload?.richContent)) {
      payload.richContent.forEach((group) => {
        if (!Array.isArray(group)) {
          return;
        }

        group.forEach((item) => {
          if (item?.type !== "chips" || !Array.isArray(item.options)) {
            return;
          }

          item.options.forEach((option) => {
            addChip(option?.text);
          });
        });
      });
    }

    if (Array.isArray(payload?.suggestions)) {
      payload.suggestions.forEach((suggestion) => {
        addChip(suggestion?.title || suggestion?.text);
      });
    }
  });

  return Array.from(chipSet);
}

function normalizeActionOptions(actionOptions) {
  if (!Array.isArray(actionOptions)) {
    return [];
  }

  return actionOptions
    .map((option) => {
      if (!option || typeof option !== "object") {
        return null;
      }

      const label = normalizeChipLabel(option.label);
      const command = normalizeChipLabel(option.command) || DEFAULT_CHAT_COMMAND;
      const value = normalizeChipLabel(option.value);
      const commandField = normalizeChipLabel(option.commandField);
      if (!label) {
        return null;
      }

      return {
        label,
        command,
        value,
        commandField: commandField || null,
      };
    })
    .filter(Boolean);
}

function safeSetLocalStorageItem(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

function safeGetLocalStorageItem(key) {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) || "";
}

function safeRemoveLocalStorageItem(key) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(key);
}

function normalizePersistedMessage(rawMessage, index) {
  if (!rawMessage || typeof rawMessage !== "object") {
    return null;
  }

  const sender = rawMessage.sender === "user" ? "user" : rawMessage.sender === "bot" ? "bot" : "";
  if (!sender) {
    return null;
  }

  const text = normalizeChipLabel(rawMessage.text);
  if (!text) {
    return null;
  }

  const createdAt = normalizeContextParam(rawMessage.createdAt, 80);
  const hasValidDate = createdAt && !Number.isNaN(new Date(createdAt).getTime());
  const actionOptions = normalizeActionOptions(rawMessage.actionOptions);
  const suggestedReplies = Array.isArray(rawMessage.suggestedReplies)
    ? rawMessage.suggestedReplies
        .map((value) => normalizeChipLabel(value))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    id: normalizeContextParam(rawMessage.id, 80) || `msg-restored-${Date.now()}-${index}`,
    sender,
    text,
    createdAt: hasValidDate ? createdAt : new Date().toISOString(),
    kind: normalizeContextParam(rawMessage.kind, 40) || undefined,
    intent: normalizeContextParam(rawMessage.intent, 60) || null,
    confidence: normalizeContextParam(rawMessage.confidence, 20) || null,
    action: normalizeContextParam(rawMessage.action, 80) || null,
    suggestedReplies,
    actionOptions,
    nextStep:
      rawMessage.nextStep && typeof rawMessage.nextStep === "object"
        ? {
            type: normalizeContextParam(rawMessage.nextStep.type, 60) || null,
            field: normalizeContextParam(rawMessage.nextStep.field, 60) || null,
          }
        : null,
    statusSummary: normalizeStatusSummary(rawMessage.statusSummary),
    mode: normalizeContextParam(rawMessage.mode, 40) || null,
    redirectTo: normalizeContextParam(rawMessage.redirectTo, 180) || null,
    redirectLabel: normalizeContextParam(rawMessage.redirectLabel, 120) || null,
    needsClarification: Boolean(rawMessage.needsClarification),
  };
}

function parsePersistedMessages(serializedMessages) {
  if (typeof serializedMessages !== "string" || !serializedMessages.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(serializedMessages);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((rawMessage, index) => normalizePersistedMessage(rawMessage, index))
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function buildPersistedMessagesPayload(messages) {
  if (!Array.isArray(messages)) {
    return "[]";
  }

  const normalized = messages
    .slice(-MAX_PERSISTED_MESSAGES)
    .map((message, index) => normalizePersistedMessage(message, index))
    .filter(Boolean);

  return JSON.stringify(normalized);
}

function normalizeContextParam(value, maxLength = 120) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function getChatEntryContext(searchParams) {
  const rawType = normalizeContextParam(searchParams.get("type"), 24).toLowerCase();
  if (rawType !== "tramite" && rawType !== "incidencia") {
    return null;
  }

  const id = normalizeContextParam(searchParams.get("id"), 60);
  const title = normalizeContextParam(searchParams.get("title"), 120);
  const description = normalizeContextParam(searchParams.get("description"), 180);
  const category = normalizeContextParam(searchParams.get("category"), 40).toLowerCase();
  if (!title) {
    return null;
  }

  return {
    type: rawType,
    id,
    title,
    description,
    category,
  };
}

function buildContextAutoPrompt({ context, copy }) {
  if (!context || !copy?.contextualEntry) {
    return "";
  }

  if (context.type === "tramite") {
    return copy.contextualEntry.procedurePrompt.replace("{title}", context.title);
  }

  const categoryLabel = context.category || context.title;
  return copy.contextualEntry.incidentPrompt.replace("{title}", categoryLabel);
}

function normalizeContextEntryPayload(context) {
  if (!context) {
    return null;
  }

  const kind = context.type === "tramite" ? "tramite" : context.type === "incidencia" ? "incidencia" : "";
  if (!kind) {
    return null;
  }

  const title = normalizeContextParam(context.title, 120);
  if (!title) {
    return null;
  }

  return {
    kind,
    title,
    description: normalizeContextParam(context.description, 180),
    category: normalizeContextParam(context.category, 40).toLowerCase(),
  };
}

function buildContextWelcomeMessage({ context, copy }) {
  if (!context || !copy?.contextualEntry) {
    return copy.welcome;
  }

  if (context.type === "tramite") {
    return copy.contextualEntry.procedureMessage.replace("{title}", context.title);
  }

  return copy.contextualEntry.incidentMessage.replace("{title}", context.title);
}

function formatStatusTimestamp(value) {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizeStatusSummary(rawSummary) {
  if (!rawSummary || typeof rawSummary !== "object") {
    return null;
  }
  const kind = normalizeContextParam(rawSummary.kind, 30).toLowerCase();
  if (kind !== "incident" && kind !== "procedure") {
    return null;
  }
  const displayCode = normalizeContextParam(rawSummary.displayCode, 120);
  const status = normalizeContextParam(rawSummary.status, 80);
  const category = normalizeContextParam(rawSummary.category, 120);
  const location = normalizeContextParam(rawSummary.location, 200);
  const description = normalizeContextParam(rawSummary.description, 400);
  const procedureName = normalizeContextParam(rawSummary.procedureName, 180);
  const procedureCategory = normalizeContextParam(rawSummary.procedureCategory, 120);
  const summary = normalizeContextParam(rawSummary.summary, 400);
  const risk = normalizeContextParam(rawSummary.risk, 80);
  const updatedAt = formatStatusTimestamp(rawSummary.updatedAt);
  const createdAt = formatStatusTimestamp(rawSummary.createdAt);

  return {
    kind,
    displayCode,
    status,
    category,
    location,
    description,
    procedureName,
    procedureCategory,
    summary,
    risk,
    updatedAt,
    createdAt,
  };
}

function buildStatusDetailRows(statusSummary) {
  if (!statusSummary) {
    return [];
  }
  if (statusSummary.kind === "incident") {
    return [
      { label: "Última actualización", value: statusSummary.updatedAt || "Sin dato" },
      { label: "Ubicación", value: statusSummary.location || "Sin dato" },
      { label: "Tipo", value: statusSummary.category || "Incidencia" },
      { label: "Descripción", value: statusSummary.description || "Sin dato" },
      ...(statusSummary.risk
        ? [{ label: "Riesgo reportado", value: statusSummary.risk }]
        : []),
    ];
  }
  return [
    { label: "Última actualización", value: statusSummary.updatedAt || "Sin dato" },
    { label: "Trámite", value: statusSummary.procedureName || "Sin dato" },
    { label: "Categoría", value: statusSummary.procedureCategory || "Sin dato" },
    { label: "Detalle", value: statusSummary.summary || "Sin dato" },
  ];
}

function dedupeActionOptions(actionOptions) {
  if (!Array.isArray(actionOptions)) {
    return [];
  }
  const seenLabels = new Set();
  const deduped = [];
  actionOptions.forEach((option) => {
    if (!option?.label) {
      return;
    }
    const key = option.label.toLowerCase();
    if (seenLabels.has(key)) {
      return;
    }
    seenLabels.add(key);
    deduped.push(option);
  });
  return deduped;
}

function humanizeStatusLabel(value) {
  const normalized = normalizeContextParam(value, 80).toLowerCase();
  if (!normalized) {
    return "Sin estado";
  }
  if (normalized === "recibido") {
    return "Recibido";
  }
  if (normalized === "en revision") {
    return "En revisión";
  }
  if (normalized === "en proceso") {
    return "En proceso";
  }
  if (normalized === "resuelto") {
    return "Resuelto";
  }
  return value;
}

function inferStatusExplanation(statusSummary) {
  const normalized = normalizeContextParam(statusSummary?.status, 80).toLowerCase();
  if (normalized === "recibido") {
    return "Tu incidencia fue registrada correctamente y está pendiente de revisión por el equipo correspondiente.";
  }
  if (normalized === "en revision") {
    return "Tu incidencia está siendo revisada por el equipo correspondiente.";
  }
  if (normalized === "en proceso") {
    return "Tu incidencia está en proceso de atención.";
  }
  if (normalized === "resuelto") {
    return "Tu incidencia figura como resuelta.";
  }
  return "Te comparto el estado actualizado de tu caso.";
}

function StatusSummaryCard({ statusSummary }) {
  const normalizedStatusSummary = normalizeStatusSummary(statusSummary);
  if (!normalizedStatusSummary) {
    return null;
  }
  const statusLabel = humanizeStatusLabel(normalizedStatusSummary.status);
  const detailRows = buildStatusDetailRows(normalizedStatusSummary);
  const explanation = inferStatusExplanation(normalizedStatusSummary);
  const title =
    normalizedStatusSummary.kind === "incident"
      ? `Incidencia ${normalizedStatusSummary.displayCode || ""}`.trim()
      : `Solicitud ${normalizedStatusSummary.displayCode || ""}`.trim();

  return (
    <section className="assistant-status-card" aria-label={title}>
      <header className="assistant-status-card__header">
        <h3>{title}</h3>
      </header>
      <div className="assistant-status-card__status-wrap">
        <p className="assistant-status-card__status-label">Estado actual</p>
        <span
          className={`assistant-status-card__pill assistant-status-card__pill--${normalizeContextParam(
            normalizedStatusSummary.status,
            40
          )
            .toLowerCase()
            .replace(/\s+/g, "-")}`}
        >
          {statusLabel}
        </span>
      </div>
      <p className="assistant-status-card__explanation">{explanation}</p>
      <hr className="assistant-status-card__divider" />
      <div className="assistant-status-card__details">
        <p className="assistant-status-card__details-title">Detalles del caso</p>
        <dl className="assistant-status-card__details-list">
          {detailRows.map((row) => (
            <div key={row.label} className="assistant-status-card__detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function ChatHeader({ copy }) {
  return (
    <header className="assistant-chat-header">
      <div className="assistant-chat-header__top">
        <div className="assistant-chat-header__identity">
          <div className="assistant-chat-header__avatar" aria-hidden="true">
            AV
          </div>
          <div>
            <p className="assistant-chat-header__eyebrow">{copy.header.eyebrow}</p>
            <h1>{copy.header.title}</h1>
          </div>
        </div>
        <p className="assistant-chat-header__status" aria-live="polite">
          <span className="assistant-chat-header__status-dot" aria-hidden="true" />
          {copy.header.online}
        </p>
      </div>
      <p className="assistant-chat-header__subtitle">{copy.header.subtitle}</p>
      <nav className="assistant-chat-header__nav" aria-label={copy.header.secondaryNavAria}>
        <ul className="assistant-chat-header__actions">
          <li>
            <Link href="/" className="assistant-chat-header__action-link">
              {copy.header.backHome}
            </Link>
          </li>
          <li>
            <Link href="/mis-incidencias" className="assistant-chat-header__action-link">
              {copy.header.viewIncidents}
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}

function ChatMessageBubble({
  message,
  onChipClick,
  onActionOptionClick,
  onRedirectClick,
  disabled,
  copy,
}) {
  const isBot = message.sender === "bot";
  const timeLabel = formatMessageTime(message.createdAt);

  return (
    <li className={`assistant-thread__item assistant-thread__item--${message.sender}`}>
      <article className={`assistant-message assistant-message--${message.sender}`}>
        {message.kind === "error" ? (
          <p className="assistant-message__system-label">{copy.connectionIssue}</p>
        ) : null}
        {!(isBot && message.statusSummary) ? <p>{message.text}</p> : null}
        {isBot && message.statusSummary ? (
          <StatusSummaryCard statusSummary={message.statusSummary} />
        ) : null}

        {isBot && message.needsClarification ? (
          <p className="assistant-message__clarification">
            {copy.clarification}
          </p>
        ) : null}

        {isBot && message.redirectTo && !message.statusSummary ? (
          <div className="assistant-message__redirect-wrap">
            <p className="assistant-message__redirect-text">
              {copy.redirectIntro}
            </p>
            <Link
              href={message.redirectTo}
              className="assistant-message__redirect"
              onClick={() => onRedirectClick(message)}
            >
              {message.redirectLabel || copy.redirectCta}
            </Link>
          </div>
        ) : null}

        {isBot && Array.isArray(message.suggestedReplies) && message.suggestedReplies.length > 0 ? (
          <div className="assistant-chat-quick-replies" aria-label={copy.dynamicSuggestions}>
            <div className="assistant-chat-quick-replies__list">
              {message.suggestedReplies.map((suggestedReply) => (
                <button
                  key={`${message.id}-${suggestedReply}`}
                  type="button"
                  className="assistant-prompt-chip"
                  onClick={() => onChipClick(suggestedReply)}
                  disabled={disabled}
                >
                  {suggestedReply}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {isBot && Array.isArray(message.actionOptions) && message.actionOptions.length > 0 ? (
          <div className="assistant-chat-quick-replies" aria-label={copy.dynamicSuggestions}>
            <div className="assistant-chat-quick-replies__list">
              {message.actionOptions.map((actionOption) => (
                <button
                  key={`${message.id}-${actionOption.command}-${actionOption.value || actionOption.label}`}
                  type="button"
                  className="assistant-prompt-chip"
                  onClick={() => onActionOptionClick(actionOption)}
                  disabled={disabled}
                >
                  {actionOption.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {timeLabel ? (
          <time className="assistant-message__time" dateTime={message.createdAt}>
            {timeLabel}
          </time>
        ) : null}
      </article>
    </li>
  );
}

function TypingIndicator({ copy }) {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article
        className="assistant-message assistant-message--bot assistant-message--typing"
        aria-live="polite"
      >
        <p className="assistant-message__typing-copy">{copy.typing}</p>
        <div className="assistant-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </article>
    </li>
  );
}

function ChatErrorMessage({ onRetry, disabled, copy }) {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article className="assistant-message assistant-message--error">
        <p className="assistant-message__system-label">{copy.retryTitle}</p>
        <p>{copy.retryBody}</p>
        <button
          type="button"
          className="assistant-message__retry-button"
          onClick={onRetry}
          disabled={disabled}
        >
          {copy.retryButton}
        </button>
      </article>
    </li>
  );
}

function ChatQuickReplies({ prompts, onPromptClick, disabled, copy }) {
  return (
    <div
      className="assistant-chat-quick-replies assistant-chat-quick-replies--global"
      aria-label={copy.quickRepliesTitle}
    >
      <p className="assistant-chat-quick-replies__title">{copy.quickRepliesTitle}</p>
      <div className="assistant-chat-quick-replies__list">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="assistant-prompt-chip"
            onClick={() => onPromptClick(prompt)}
            disabled={disabled}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatInitialGuidance({ prompts, onPromptClick, disabled, copy }) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return null;
  }

  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article className="assistant-message assistant-message--bot assistant-message--intro">
        <p className="assistant-message__intro-copy">{copy.initialHelp}</p>
        <div className="assistant-chat-quick-replies" aria-label={copy.quickRepliesTitle}>
          <div className="assistant-chat-quick-replies__list">
            {prompts.map((prompt) => (
              <button
                key={`starter-${prompt}`}
                type="button"
                className="assistant-prompt-chip"
                onClick={() => onPromptClick(prompt)}
                disabled={disabled}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </article>
    </li>
  );
}

function ChatComposer({
  inputValue,
  onInputChange,
  onSubmit,
  isSending,
  canSend,
  onKeyDown,
  characterCount,
  inputRef,
  copy,
}) {
  const shouldShowCounter = characterCount >= MAX_MESSAGE_LENGTH - 80;

  return (
    <form className="assistant-chat-composer" onSubmit={onSubmit}>
      <label htmlFor="assistant-chat-input" className="assistant-chat-composer__sr-only">
        {copy.composer.label}
      </label>
      <div className="assistant-chat-composer__input-wrap">
        <textarea
          ref={inputRef}
          id="assistant-chat-input"
          name="message"
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={copy.composer.placeholder}
          value={inputValue}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          disabled={isSending}
          rows={1}
        />
        <button
          type="submit"
          className="assistant-chat-composer__send"
          disabled={!canSend}
          aria-label={isSending ? copy.composer.sendingAria : copy.composer.sendAria}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.7 20.3 21.1 12 3.7 3.7v6.4l10.2 1.9-10.2 1.9v6.4Z" />
          </svg>
        </button>
      </div>
      {shouldShowCounter ? (
        <p className="assistant-chat-composer__counter">
          {characterCount}/{MAX_MESSAGE_LENGTH}
        </p>
      ) : null}
    </form>
  );
}

export default function AssistantChatPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useLocale();
  const uiCopy = getLocaleCopy(locale).chat;
  const entryContext = useMemo(() => getChatEntryContext(searchParams), [searchParams]);
  const quickPrompts = useMemo(
    () => (Array.isArray(uiCopy.quickPrompts) ? uiCopy.quickPrompts.slice(0, 3) : []),
    [uiCopy.quickPrompts]
  );
  const contextualWelcomeMessage = useMemo(
    () => buildContextWelcomeMessage({ context: entryContext, copy: uiCopy }),
    [entryContext, uiCopy]
  );
  const contextAutoPrompt = useMemo(
    () => buildContextAutoPrompt({ context: entryContext, copy: uiCopy }),
    [entryContext, uiCopy]
  );
  const contextEntryPayload = useMemo(() => normalizeContextEntryPayload(entryContext), [entryContext]);
  const contextTriggerKey = useMemo(() => {
    if (!entryContext) {
      return "";
    }

    return `${entryContext.type}|${entryContext.id}|${entryContext.title}`;
  }, [entryContext]);
  const restartKey = useMemo(() => normalizeContextParam(searchParams.get("restart"), 8), [searchParams]);
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const initializedSessionRef = useRef(false);
  const contextualPromptSentRef = useRef("");
  const lastFailedInputRef = useRef({
    rawValue: "",
    command: DEFAULT_CHAT_COMMAND,
    commandField: null,
  });
  const [messages, setMessages] = useState([
    createLocalMessage({
      sender: "bot",
      text: contextualWelcomeMessage,
    }),
  ]);
  useEffect(() => {
    setMessages((previousMessages) => {
      if (!previousMessages.length) {
        return previousMessages;
      }
      const [firstMessage, ...rest] = previousMessages;
      if (firstMessage.sender !== "bot") {
        return previousMessages;
      }
      return [
        {
          ...firstMessage,
          text: contextualWelcomeMessage,
        },
        ...rest,
      ];
    });
  }, [contextualWelcomeMessage]);

  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [sessionLocale, setSessionLocale] = useState("");

  useEffect(() => {
    if (initializedSessionRef.current) {
      return;
    }

    initializedSessionRef.current = true;
    if (typeof window === "undefined") {
      return;
    }

    const shouldResume = safeGetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY) === "1";
    if (!shouldResume) {
      safeRemoveLocalStorageItem(SESSION_ID_STORAGE_KEY);
      safeRemoveLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
      safeRemoveLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY);
      setSessionId("");
      setSessionLocale("");
      return;
    }

    const existingSessionId = safeGetLocalStorageItem(SESSION_ID_STORAGE_KEY);
    if (existingSessionId) {
      setSessionId(existingSessionId);
    }

    const existingSessionLocale = safeGetLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
    if (existingSessionLocale) {
      setSessionLocale(existingSessionLocale);
    }

    const persistedMessages = parsePersistedMessages(
      safeGetLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY)
    );
    if (persistedMessages.length > 0) {
      setMessages(persistedMessages);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(SESSION_ID_STORAGE_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionLocale || typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(SESSION_LOCALE_STORAGE_KEY, sessionLocale);
  }, [sessionLocale]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    safeSetLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY, buildPersistedMessagesPayload(messages));
  }, [messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) {
      return;
    }

    inputElement.style.height = "auto";
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [inputValue]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (restartKey !== "1") {
      return;
    }

    safeRemoveLocalStorageItem(SESSION_ID_STORAGE_KEY);
    safeRemoveLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
    safeRemoveLocalStorageItem(CHATBOT_MESSAGES_STORAGE_KEY);
    safeRemoveLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    contextualPromptSentRef.current = "";
    lastFailedInputRef.current = {
      rawValue: "",
      command: DEFAULT_CHAT_COMMAND,
      commandField: null,
    };
    setSessionId("");
    setSessionLocale("");
    setInputValue("");
    setIsSending(false);
    setServiceError(false);
    setMessages([
      createLocalMessage({
        sender: "bot",
        text: contextualWelcomeMessage,
      }),
    ]);
    router.replace(pathname || "/asistente");
  }, [contextualWelcomeMessage, pathname, restartKey, router]);

  const canSend = useMemo(() => {
    return Boolean(normalizeInput(inputValue)) && !isSending;
  }, [inputValue, isSending]);

  const submitMessage = useCallback(async ({
    rawValue,
    command = DEFAULT_CHAT_COMMAND,
    commandField = null,
    appendUserMessage,
    contextEntry = null,
  }) => {
    const text = normalizeInput(rawValue);
    if ((!text && command === DEFAULT_CHAT_COMMAND) || isSending) {
      return;
    }

    const clientDebugEnabled =
      typeof window !== "undefined" &&
      window.localStorage.getItem("chatbot_debug") === "1";
    if (clientDebugEnabled) {
      console.info("[chatbot][client][send]", {
        sessionId: sessionId || null,
        locale: sessionLocale || locale || "es",
        command,
        commandField,
        text,
      });
    }

    setServiceError(false);
    if (appendUserMessage && text) {
      setInputValue("");
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({ sender: "user", text }),
      ]);
    }
    setIsSending(true);

    try {
      const response = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clientDebugEnabled ? { "x-chatbot-debug": "1" } : {}),
        },
        body: JSON.stringify({
          text,
          sessionId: sessionId || undefined,
          preferredLocale: sessionLocale || locale || "es",
          command,
          commandField,
          contextEntry,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || uiCopy.networkError);
      }

      const fulfillmentMessages = Array.isArray(data?.fulfillmentMessages)
        ? data.fulfillmentMessages
        : [];
      const suggestedReplies = extractPayloadChips(fulfillmentMessages);
      const actionOptions = normalizeActionOptions(data?.actionOptions);
      const statusSummary = normalizeStatusSummary(data?.statusSummary);
      const effectiveActionOptions = statusSummary
        ? dedupeActionOptions(actionOptions).slice(0, 3)
        : actionOptions;
      if (data?.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      if (typeof data?.locale === "string" && data.locale && data.locale !== sessionLocale) {
        setSessionLocale(data.locale);
      }

      if (clientDebugEnabled) {
        console.info("[chatbot][client][response]", {
          requestSessionId: sessionId || null,
          responseSessionId: data?.sessionId || null,
          mode: data?.mode || null,
          action: data?.action || null,
          intent: data?.intent || null,
          nextStep: data?.nextStep || null,
          draft: data?.draft || null,
          needsClarification: Boolean(data?.needsClarification),
        });
      }
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "bot",
          text:
            data?.replyText ||
            uiCopy.fallbackReply,
          intent: data?.intent || null,
          confidence: formatConfidence(data?.confidence),
          action: data?.action || null,
          fulfillmentMessages,
          suggestedReplies,
          actionOptions: effectiveActionOptions,
          nextStep: data?.nextStep || null,
          mode: data?.mode || null,
          draft: data?.draft || null,
          redirectTo: data?.redirectTo || null,
          redirectLabel: data?.redirectLabel || null,
          needsClarification: Boolean(data?.needsClarification),
          statusSummary,
        }),
      ]);
      lastFailedInputRef.current = {
        rawValue: "",
        command: DEFAULT_CHAT_COMMAND,
        commandField: null,
      };
    } catch (error) {
      lastFailedInputRef.current = {
        rawValue: text,
        command,
        commandField,
      };
      setServiceError(true);
    } finally {
      setIsSending(false);
    }
  }, [isSending, locale, sessionId, sessionLocale, uiCopy.fallbackReply, uiCopy.networkError]);

  useEffect(() => {
    const shouldResume = safeGetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    if (shouldResume !== "1" || isSending) {
      return;
    }

    safeRemoveLocalStorageItem(CHATBOT_RESUME_PENDING_KEY);
    void submitMessage({
      rawValue: "",
      command: "resume_confirmation",
      appendUserMessage: false,
    });
  }, [isSending, submitMessage]);

  useEffect(() => {
    if (!contextAutoPrompt || !contextTriggerKey || isSending) {
      return;
    }
    if (contextualPromptSentRef.current === contextTriggerKey) {
      return;
    }

    contextualPromptSentRef.current = contextTriggerKey;
    void submitMessage({
      rawValue: contextAutoPrompt,
      command: "start_contextual_flow",
      appendUserMessage: false,
      contextEntry: contextEntryPayload,
    });
  }, [contextAutoPrompt, contextEntryPayload, contextTriggerKey, isSending, submitMessage]);

  const handleSendMessage = async (rawValue) => {
    await submitMessage({
      rawValue,
      command: DEFAULT_CHAT_COMMAND,
      appendUserMessage: true,
    });
  };

  const handleActionOption = async (actionOption) => {
    if (!actionOption || isSending) {
      return;
    }

    const command = actionOption.command || DEFAULT_CHAT_COMMAND;
    if (command !== DEFAULT_CHAT_COMMAND) {
      await submitMessage({
        rawValue: "",
        command,
        commandField: actionOption.commandField || null,
        appendUserMessage: false,
      });
      return;
    }

    await submitMessage({
      rawValue: actionOption.value || actionOption.label,
      command: DEFAULT_CHAT_COMMAND,
      appendUserMessage: true,
    });
  };

  const handleRetry = async () => {
    const lastFailedInput = lastFailedInputRef.current;
    if (
      (!lastFailedInput?.rawValue && lastFailedInput?.command === DEFAULT_CHAT_COMMAND) ||
      isSending
    ) {
      return;
    }

    await submitMessage({
      rawValue: lastFailedInput.rawValue,
      command: lastFailedInput.command || DEFAULT_CHAT_COMMAND,
      commandField: lastFailedInput.commandField || null,
      appendUserMessage: false,
    });
  };

  const handleRedirectClick = (message) => {
    if (message?.nextStep?.type !== "auth_required") {
      return;
    }

    safeSetLocalStorageItem(CHATBOT_RESUME_PENDING_KEY, "1");
  };

  const handleInputChange = (event) => {
    setInputValue(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage(inputValue);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    void handleSendMessage(inputValue);
  };

  const characterCount = inputValue.length;
  const lastBotMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.sender === "bot") {
        return messages[index];
      }
    }
    return null;
  }, [messages]);
  const hasDynamicBotActions = Boolean(
    lastBotMessage &&
      ((Array.isArray(lastBotMessage.suggestedReplies) && lastBotMessage.suggestedReplies.length > 0) ||
        (Array.isArray(lastBotMessage.actionOptions) && lastBotMessage.actionOptions.length > 0))
  );
  const showInitialGuidance =
    !entryContext &&
    !serviceError &&
    !isSending &&
    messages.length === 1 &&
    messages[0]?.sender === "bot";
  const showQuickReplies =
    messages.some((message) => message.sender === "bot") &&
    messages.length <= 4 &&
    !isSending &&
    !entryContext &&
    !showInitialGuidance &&
    !hasDynamicBotActions;

  return (
    <main className="page page--assistant" lang={locale}>
      <section className="assistant-chat-card" aria-label={uiCopy.conversationAria.section}>
        <ChatHeader copy={uiCopy} />

        <div
          ref={scrollContainerRef}
          id="assistant-chat-scroll-container"
          className="assistant-chat-messages"
          aria-label={uiCopy.conversationAria.region}
          aria-describedby="assistant-chat-description"
          role="region"
        >
          <p id="assistant-chat-description" className="assistant-chat-composer__sr-only">
            {uiCopy.conversationAria.description}
          </p>
          <p className="assistant-chat-composer__sr-only" role="status" aria-live="polite">
            {isSending ? uiCopy.typingStatus : serviceError ? uiCopy.networkError : ""}
          </p>
          <ol
            className="assistant-thread"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label={uiCopy.conversationAria.log}
          >
            {messages.map((message) => (
              <ChatMessageBubble
                key={message.id}
                message={message}
                onChipClick={handleSendMessage}
                onActionOptionClick={handleActionOption}
                onRedirectClick={handleRedirectClick}
                disabled={isSending}
                copy={uiCopy}
              />
            ))}
            {showInitialGuidance ? (
              <ChatInitialGuidance
                prompts={quickPrompts}
                onPromptClick={handleSendMessage}
                disabled={isSending}
                copy={uiCopy}
              />
            ) : null}

            {isSending ? <TypingIndicator copy={uiCopy} /> : null}

            {serviceError ? (
              <ChatErrorMessage onRetry={handleRetry} disabled={isSending} copy={uiCopy} />
            ) : null}
          </ol>
        </div>

        {showQuickReplies ? (
          <ChatQuickReplies
            prompts={quickPrompts}
            onPromptClick={handleSendMessage}
            disabled={isSending}
            copy={uiCopy}
          />
        ) : null}

        <ChatComposer
          inputValue={inputValue}
          onInputChange={handleInputChange}
          onSubmit={handleSubmit}
          isSending={isSending}
          canSend={canSend}
          onKeyDown={handleInputKeyDown}
          characterCount={characterCount}
          inputRef={inputRef}
          copy={uiCopy}
        />
      </section>
    </main>
  );
}

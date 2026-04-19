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
const CHATBOT_RESUME_PENDING_KEY = "chatbot_resume_pending";
const DEFAULT_CHAT_COMMAND = "none";

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

function ChatHeader({ copy }) {
  return (
    <header className="assistant-chat-header">
      <div className="assistant-chat-header__identity">
        <div className="assistant-chat-header__avatar" aria-hidden="true">
          AV
        </div>
        <div>
          <p className="assistant-chat-header__eyebrow">{copy.header.eyebrow}</p>
          <h1>{copy.header.title}</h1>
          <p className="assistant-chat-header__subtitle">
            {copy.header.subtitle}
          </p>
        </div>
      </div>
      <div className="assistant-chat-header__meta">
        <p className="assistant-chat-header__status" aria-live="polite">
          <span className="assistant-chat-header__status-dot" aria-hidden="true" />
          {copy.header.online}
        </p>
        <nav aria-label={copy.header.secondaryNavAria}>
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
      </div>
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
        <p>{message.text}</p>

        {isBot && message.needsClarification ? (
          <p className="assistant-message__clarification">
            {copy.clarification}
          </p>
        ) : null}

        {isBot && message.redirectTo ? (
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
    <div className="assistant-chat-quick-replies" aria-label={copy.quickRepliesTitle}>
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
      <div className="assistant-chat-composer__actions">
        {shouldShowCounter ? (
          <p className="assistant-chat-composer__counter">
            {characterCount}/{MAX_MESSAGE_LENGTH}
          </p>
        ) : (
          <span className="assistant-chat-composer__hint">{copy.composer.counterHint}</span>
        )}
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
  const quickPrompts = uiCopy.quickPrompts;
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

    const existingSessionId = safeGetLocalStorageItem(SESSION_ID_STORAGE_KEY);
    if (existingSessionId) {
      setSessionId(existingSessionId);
    }

    const existingSessionLocale = safeGetLocalStorageItem(SESSION_LOCALE_STORAGE_KEY);
    if (existingSessionLocale) {
      setSessionLocale(existingSessionLocale);
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
      if (data?.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      if (typeof data?.locale === "string" && data.locale && data.locale !== sessionLocale) {
        setSessionLocale(data.locale);
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
          actionOptions,
          nextStep: data?.nextStep || null,
          mode: data?.mode || null,
          draft: data?.draft || null,
          redirectTo: data?.redirectTo || null,
          redirectLabel: data?.redirectLabel || null,
          needsClarification: Boolean(data?.needsClarification),
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
  const showQuickReplies = messages.some((message) => message.sender === "bot") && !isSending && !entryContext;

  return (
    <main className="page page--assistant" lang={locale}>
      <section className="card assistant-chat-card" aria-label={uiCopy.conversationAria.section}>
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

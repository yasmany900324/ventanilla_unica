"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

const MAX_MESSAGE_LENGTH = 500;

const QUICK_PROMPTS = [
  "Quiero reportar un problema",
  "Necesito hacer un tramite",
  "Quiero crear una incidencia",
  "Donde consulto el estado de mi solicitud?",
];

const WELCOME_TEXT =
  "Hola, soy tu asistente virtual. Puedo ayudarte a identificar el tramite correcto, sugerir una categoria y llevarte al flujo indicado.";

const ERROR_TEXT =
  "Hubo un problema de conexion. Intenta nuevamente para continuar con la conversacion.";

const MAX_TEXTAREA_HEIGHT = 168;
const TYPING_STATUS_TEXT = "El asistente esta escribiendo una respuesta.";

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

function ChatHeader() {
  return (
    <header className="assistant-chat-header">
      <div className="assistant-chat-header__identity">
        <div className="assistant-chat-header__avatar" aria-hidden="true">
          AV
        </div>
        <div>
          <p className="assistant-chat-header__eyebrow">Asistente virtual</p>
          <h1>Chat de orientacion ciudadana</h1>
          <p className="assistant-chat-header__subtitle">
            Te ayudo a identificar tramites, reportar problemas o consultar el estado de tu
            solicitud.
          </p>
        </div>
      </div>
      <div className="assistant-chat-header__meta">
        <p className="assistant-chat-header__status" aria-live="polite">
          <span className="assistant-chat-header__status-dot" aria-hidden="true" />
          En linea
        </p>
        <nav aria-label="Acciones de navegacion secundaria">
          <ul className="assistant-chat-header__actions">
            <li>
              <Link href="/" className="assistant-chat-header__action-link">
                Volver al inicio
              </Link>
            </li>
            <li>
              <Link href="/mis-incidencias" className="assistant-chat-header__action-link">
                Ver mis incidencias
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function ChatMeta({ message }) {
  if (message.sender !== "bot" || (!message.intent && !message.action && !message.confidence)) {
    return null;
  }

  return (
    <div className="assistant-message__meta">
      {message.intent ? <span>Intent: {message.intent}</span> : null}
      {message.confidence ? <span>Confianza: {message.confidence}</span> : null}
      {message.action ? <span>Action: {message.action}</span> : null}
    </div>
  );
}

function ChatMessageBubble({ message }) {
  const isBot = message.sender === "bot";
  const timeLabel = formatMessageTime(message.createdAt);

  return (
    <li className={`assistant-thread__item assistant-thread__item--${message.sender}`}>
      <article className={`assistant-message assistant-message--${message.sender}`}>
        {message.kind === "error" ? (
          <p className="assistant-message__system-label">Problema de conexion</p>
        ) : null}
        <p>{message.text}</p>
        <ChatMeta message={message} />

        {isBot && message.needsClarification ? (
          <p className="assistant-message__clarification">
            Si quieres, cuentame si se trata de un problema, un tramite o una consulta de
            estado para orientarte mejor.
          </p>
        ) : null}

        {isBot && message.redirectTo ? (
          <div className="assistant-message__redirect-wrap">
            <p className="assistant-message__redirect-text">
              Identifique un flujo recomendado para tu consulta.
            </p>
            <Link href={message.redirectTo} className="assistant-message__redirect">
              {message.redirectLabel || "Ir al flujo sugerido"}
            </Link>
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

function TypingIndicator() {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article
        className="assistant-message assistant-message--bot assistant-message--typing"
        aria-live="polite"
      >
        <p className="assistant-message__typing-copy">El asistente esta escribiendo...</p>
        <div className="assistant-typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </article>
    </li>
  );
}

function ChatErrorMessage({ onRetry, disabled }) {
  return (
    <li className="assistant-thread__item assistant-thread__item--bot">
      <article className="assistant-message assistant-message--error">
        <p className="assistant-message__system-label">No pude responder en este momento.</p>
        <p>Hubo un problema de conexion. Intenta nuevamente.</p>
        <button
          type="button"
          className="assistant-message__retry-button"
          onClick={onRetry}
          disabled={disabled}
        >
          Reintentar
        </button>
      </article>
    </li>
  );
}

function ChatQuickReplies({ prompts, onPromptClick, disabled }) {
  return (
    <div className="assistant-chat-quick-replies" aria-label="Respuestas rapidas sugeridas">
      <p className="assistant-chat-quick-replies__title">Sugerencias rapidas</p>
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
}) {
  const shouldShowCounter = characterCount >= MAX_MESSAGE_LENGTH - 80;

  return (
    <form className="assistant-chat-composer" onSubmit={onSubmit}>
      <label htmlFor="assistant-chat-input" className="assistant-chat-composer__sr-only">
        Escribe tu consulta
      </label>
      <textarea
        ref={inputRef}
        id="assistant-chat-input"
        name="message"
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder="Escribe tu consulta..."
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
          <span className="assistant-chat-composer__hint">Enter para enviar</span>
        )}
        <button
          type="submit"
          className="assistant-chat-composer__send"
          disabled={!canSend}
          aria-label={isSending ? "Enviando mensaje" : "Enviar mensaje"}
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
  const scrollContainerRef = useRef(null);
  const inputRef = useRef(null);
  const initializedSessionRef = useRef(false);
  const lastFailedInputRef = useRef("");
  const [messages, setMessages] = useState([
    createLocalMessage({
      sender: "bot",
      text: WELCOME_TEXT,
    }),
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [serviceError, setServiceError] = useState(false);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    if (initializedSessionRef.current) {
      return;
    }

    initializedSessionRef.current = true;
    if (typeof window === "undefined") {
      return;
    }

    const existingSessionId = window.localStorage.getItem("chatbot_session_id");
    if (existingSessionId) {
      setSessionId(existingSessionId);
    }
  }, []);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("chatbot_session_id", sessionId);
  }, [sessionId]);

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

  const canSend = useMemo(() => {
    return Boolean(normalizeInput(inputValue)) && !isSending;
  }, [inputValue, isSending]);

  const submitMessage = async ({ rawValue, appendUserMessage }) => {
    const text = normalizeInput(rawValue);
    if (!text || isSending) {
      return;
    }

    setServiceError(false);
    if (appendUserMessage) {
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
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "No pudimos contactar al asistente.");
      }

      if (data?.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "bot",
          text:
            data?.replyText ||
            "No pude entender del todo tu solicitud. Puedes contarme un poco mas?",
          intent: data?.intent || null,
          confidence: formatConfidence(data?.confidence),
          action: data?.action || null,
          redirectTo: data?.redirectTo || null,
          redirectLabel: data?.redirectLabel || null,
          needsClarification: Boolean(data?.needsClarification),
        }),
      ]);
      lastFailedInputRef.current = "";
    } catch (error) {
      lastFailedInputRef.current = text;
      setServiceError(true);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendMessage = async (rawValue) => {
    await submitMessage({ rawValue, appendUserMessage: true });
  };

  const handleRetry = async () => {
    if (!lastFailedInputRef.current || isSending) {
      return;
    }

    await submitMessage({
      rawValue: lastFailedInputRef.current,
      appendUserMessage: false,
    });
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
  const showQuickReplies = messages.some((message) => message.sender === "bot") && !isSending;

  return (
    <main className="page page--assistant">
      <section className="card assistant-chat-card" aria-label="Conversacion con asistente">
        <ChatHeader />

        <div
          ref={scrollContainerRef}
          id="assistant-chat-scroll-container"
          className="assistant-chat-messages"
          aria-label="Conversacion con el asistente virtual"
          aria-describedby="assistant-chat-description"
          role="region"
        >
          <p id="assistant-chat-description" className="assistant-chat-composer__sr-only">
            Conversacion entre el asistente virtual y la persona usuaria.
          </p>
          <p className="assistant-chat-composer__sr-only" role="status" aria-live="polite">
            {isSending ? TYPING_STATUS_TEXT : serviceError ? ERROR_TEXT : ""}
          </p>
          <ol
            className="assistant-thread"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Mensajes del chatbot"
          >
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}

            {isSending ? <TypingIndicator /> : null}

            {serviceError ? <ChatErrorMessage onRetry={handleRetry} disabled={isSending} /> : null}
          </ol>
        </div>

        {showQuickReplies ? (
          <ChatQuickReplies
            prompts={QUICK_PROMPTS}
            onPromptClick={handleSendMessage}
            disabled={isSending}
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
        />
      </section>
    </main>
  );
}

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

export default function AssistantChatPage() {
  const initializedSessionRef = useRef(false);
  const [messages, setMessages] = useState([
    createLocalMessage({
      sender: "bot",
      text: WELCOME_TEXT,
    }),
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [serviceError, setServiceError] = useState("");
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
    const container = document.getElementById("assistant-chat-scroll-container");
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isSending]);

  const canSend = useMemo(() => {
    return Boolean(normalizeInput(inputValue)) && !isSending;
  }, [inputValue, isSending]);

  const handleSendMessage = async (rawValue) => {
    const text = normalizeInput(rawValue);
    if (!text || isSending) {
      return;
    }

    setServiceError("");
    setInputValue("");
    setMessages((previousMessages) => [
      ...previousMessages,
      createLocalMessage({ sender: "user", text }),
    ]);
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
    } catch (error) {
      setServiceError(
        "Hubo un problema de comunicacion con el asistente. Intenta nuevamente en unos segundos."
      );
      setMessages((previousMessages) => [
        ...previousMessages,
        createLocalMessage({
          sender: "bot",
          text:
            "Estoy teniendo dificultades tecnicas en este momento. Intenta nuevamente o usa las opciones de ayuda del portal.",
        }),
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await handleSendMessage(inputValue);
  };

  return (
    <main className="page page--assistant">
      <section className="card assistant-page-hero">
        <p className="eyebrow">Asistente virtual</p>
        <h1>Chat de orientacion ciudadana</h1>
        <p className="description">
          Conversa con el asistente para identificar el tipo de ticket, incidencia o tramite
          y recibir una redireccion al flujo adecuado.
        </p>
        <div className="assistant-page-hero__links">
          <Link href="/" className="button-link button-link--secondary button-link--compact">
            Volver al inicio
          </Link>
          <Link href="/mis-incidencias" className="button-link button-link--secondary button-link--compact">
            Ver mis incidencias
          </Link>
        </div>
      </section>

      <section className="card assistant-chat-card" aria-label="Conversacion con asistente">
        <div className="assistant-chat-prompts" aria-label="Consultas sugeridas">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="assistant-prompt-chip"
              onClick={() => handleSendMessage(prompt)}
              disabled={isSending}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div
          id="assistant-chat-scroll-container"
          className="assistant-chat-messages"
          role="log"
          aria-live="polite"
          aria-label="Mensajes del chatbot"
        >
          {messages.map((message) => (
            <article
              key={message.id}
              className={`assistant-message assistant-message--${message.sender}`}
            >
              <p>{message.text}</p>
              {message.sender === "bot" && (message.intent || message.action) ? (
                <div className="assistant-message__meta">
                  {message.intent ? <span>Intent: {message.intent}</span> : null}
                  {message.confidence ? <span>Confianza: {message.confidence}</span> : null}
                  {message.action ? <span>Action: {message.action}</span> : null}
                </div>
              ) : null}
              {message.sender === "bot" && message.needsClarification ? (
                <p className="assistant-message__clarification">
                  Si quieres, cuentame si se trata de un problema, un tramite o una
                  consulta de estado para orientarte mejor.
                </p>
              ) : null}
              {message.sender === "bot" && message.redirectTo ? (
                <div className="assistant-message__redirect-wrap">
                  <p className="assistant-message__redirect-text">
                    Identifique un flujo recomendado para tu consulta.
                  </p>
                  <Link href={message.redirectTo} className="assistant-message__redirect">
                    {message.redirectLabel || "Ir al flujo sugerido"}
                  </Link>
                </div>
              ) : null}
            </article>
          ))}

          {isSending ? (
            <article className="assistant-message assistant-message--bot assistant-message--typing">
              <p>El asistente esta escribiendo...</p>
            </article>
          ) : null}
        </div>

        {serviceError ? (
          <p className="error-message assistant-chat-error" role="alert">
            {serviceError}
          </p>
        ) : null}

        <form className="assistant-chat-form" onSubmit={handleSubmit}>
          <label htmlFor="assistant-chat-input">Escribe tu mensaje</label>
          <textarea
            id="assistant-chat-input"
            name="message"
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Ej.: Quiero reportar un problema en alumbrado publico"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            disabled={isSending}
          />
          <div className="assistant-chat-form__footer">
            <p className="small">{normalizeInput(inputValue).length}/{MAX_MESSAGE_LENGTH}</p>
            <button type="submit" disabled={!canSend}>
              {isSending ? "Enviando..." : "Enviar mensaje"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

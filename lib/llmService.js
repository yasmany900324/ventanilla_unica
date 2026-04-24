import { z } from "zod";
import { getLlmOpenAIClient } from "./openai/openaiClientRegistry";
import { createChatCompletionWithLogs } from "./openai/openaiLoggedClient";

const DEFAULT_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 4500;
const MAX_RETRIES = 2;

const INTERPRETATION_SCHEMA = z
  .object({
    intent: z
      .object({
        kind: z
          .enum(["report_incident", "start_procedure", "check_status", "unknown"])
          .default("unknown"),
        confidence: z.number().min(0).max(1).nullable().default(null),
      })
      .strict()
      .default({
        kind: "unknown",
        confidence: null,
      }),
    flowCandidate: z
      .object({
        flowKey: z
          .enum(["incident.general", "procedure.general_start"])
          .nullable()
          .default(null),
        confidence: z.number().min(0).max(1).nullable().default(null),
      })
      .strict()
      .default({
        flowKey: null,
        confidence: null,
      }),
    procedureCandidate: z
      .object({
        name: z.string().trim().min(1).max(160).nullable().default(null),
        category: z.string().trim().min(1).max(80).nullable().default(null),
        confidence: z.number().min(0).max(1).nullable().default(null),
      })
      .strict()
      .default({
        name: null,
        category: null,
        confidence: null,
      }),
    entities: z
      .object({
        location: z
          .object({
            value: z.string().trim().min(1).max(320).nullable().default(null),
            confidence: z.number().min(0).max(1).nullable().default(null),
          })
          .strict()
          .default({
            value: null,
            confidence: null,
          }),
        description: z
          .object({
            value: z.string().trim().min(1).max(320).nullable().default(null),
            confidence: z.number().min(0).max(1).nullable().default(null),
          })
          .strict()
          .default({
            value: null,
            confidence: null,
          }),
        photoIntent: z
          .object({
            value: z
              .enum(["wants_upload", "skip_photo"])
              .nullable()
              .default(null),
            confidence: z.number().min(0).max(1).nullable().default(null),
          })
          .strict()
          .default({
            value: null,
            confidence: null,
          }),
      })
      .strict()
      .default({
        location: { value: null, confidence: null },
        description: { value: null, confidence: null },
        photoIntent: { value: null, confidence: null },
      }),
    userSignals: z
      .object({
        wantsToConfirm: z.boolean().default(false),
        wantsToCancel: z.boolean().default(false),
        wantsToEdit: z.enum(["location", "description", "photo"]).nullable().default(null),
        greetingOpen: z.boolean().default(false),
      })
      .strict()
      .default({
        wantsToConfirm: false,
        wantsToCancel: false,
        wantsToEdit: null,
        greetingOpen: false,
      }),
    assistantStyle: z
      .object({
        suggestedReply: z.string().trim().min(1).max(240).nullable().default(null),
      })
      .strict()
      .default({
        suggestedReply: null,
      }),
  })
  .strict();

const EMPTY_INTERPRETATION = INTERPRETATION_SCHEMA.parse({});

function getOpenAIClient() {
  return getLlmOpenAIClient();
}

function getInterpreterModel() {
  return process.env.OPENAI_MODEL_INTERPRETER?.trim() || DEFAULT_MODEL;
}

function buildSystemPrompt() {
  return `Eres un extractor estructurado para un chatbot municipal.
Devuelve SIEMPRE JSON valido y solo con las claves permitidas.
No inventes datos.
Idioma de salida: español.

Reglas:
- intent.kind solo puede ser: report_incident, start_procedure, check_status, unknown.
- flowCandidate.flowKey solo puede ser "incident.general", "procedure.general_start" o null.
- procedureCandidate.name debe ser el nombre probable del tramite que el usuario quiere iniciar (no una accion auxiliar).
- procedureCandidate.category puede ser null o una categoria breve del tramite.
- procedureCandidate.confidence entre 0 y 1.
- entities.location y entities.description deben incluir confidence entre 0 y 1.
- entities.photoIntent.value solo puede ser: wants_upload, skip_photo o null.
- userSignals.greetingOpen debe ser true cuando el mensaje sea un saludo/apertura conversacional
  (ej. "hola", "buenas", "hello") y no haya una intención específica de trámite/incidencia/estado.
- No propongas ni infieras campos adicionales fuera de location/description/photoIntent; el backend decide los campos válidos del catálogo.
- Si no hay evidencia clara, usa null y confidence baja.
- assistantStyle.suggestedReply debe ser breve y no ejecutar acciones de negocio.
- Si el contexto indica userMessageOrigin.source = "speech_to_text", el texto viene de voz: puede fallar; para datos sensibles o decisivos pedí confirmación explícita y bajá confidence en entities.`;
}

function extractJsonContent(rawContent) {
  if (typeof rawContent !== "string") {
    return null;
  }

  const trimmed = rawContent.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    // continue
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const candidate = trimmed.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return null;
  }
}

function isRetryableError(error) {
  if (error?.name === "AbortError") {
    return true;
  }

  const status = typeof error?.status === "number" ? error.status : null;
  if (status === 429) {
    return true;
  }

  if (status && status >= 500 && status <= 599) {
    return true;
  }

  return !status;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRawInterpretation(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const intent = value.intent && typeof value.intent === "object" ? value.intent : {};
  const flowCandidate =
    value.flowCandidate && typeof value.flowCandidate === "object" ? value.flowCandidate : {};
  const procedureCandidate =
    value.procedureCandidate && typeof value.procedureCandidate === "object"
      ? value.procedureCandidate
      : {};
  const entities = value.entities && typeof value.entities === "object" ? value.entities : {};
  const userSignals =
    value.userSignals && typeof value.userSignals === "object" ? value.userSignals : {};
  const assistantStyle =
    value.assistantStyle && typeof value.assistantStyle === "object" ? value.assistantStyle : {};

  return {
    intent: {
      kind: intent.kind,
      confidence: intent.confidence,
    },
    flowCandidate: {
      flowKey: flowCandidate.flowKey,
      confidence: flowCandidate.confidence,
    },
    procedureCandidate: {
      name: procedureCandidate.name,
      category: procedureCandidate.category,
      confidence: procedureCandidate.confidence,
    },
    entities: {
      location: entities.location,
      description: entities.description,
      photoIntent: entities.photoIntent,
    },
    userSignals: {
      wantsToConfirm: userSignals.wantsToConfirm,
      wantsToCancel: userSignals.wantsToCancel,
      wantsToEdit: userSignals.wantsToEdit,
      greetingOpen: userSignals.greetingOpen,
    },
    assistantStyle: {
      suggestedReply: assistantStyle.suggestedReply,
    },
  };
}

function buildUserPrompt({ text, locale, sessionContext }) {
  const serializedContext =
    sessionContext && typeof sessionContext === "object"
      ? JSON.stringify(sessionContext).slice(0, 2000)
      : "{}";

  const channel =
    sessionContext && typeof sessionContext === "object" && sessionContext.channel
      ? String(sessionContext.channel)
      : "web";

  const fromSpeechToText =
    sessionContext &&
    typeof sessionContext === "object" &&
    sessionContext.userMessageOrigin &&
    typeof sessionContext.userMessageOrigin === "object" &&
    sessionContext.userMessageOrigin.source === "speech_to_text";

  const sttBlock = fromSpeechToText
    ? `
Origen del mensaje: transcripcion automatica de audio (WhatsApp). Puede contener errores.
Reglas extra: no inventes datos; si hay cedula, direccion muy especifica, numeros de caso o montos, usa confidence baja en entities y en assistantStyle.suggestedReply pedi confirmacion por escrito antes de asumirlos como correctos.
`
    : "";

  return `Analiza este mensaje del usuario y extrae estructura.

Canal de conversacion: ${channel}
Si el contexto incluye "whatsappInbound", el tipo de mensaje ya fue resuelto por el backend (no intentes inferir ubicacion o imagen desde JSON crudo de Meta).
${sttBlock}
Mensaje usuario (o resumen si el canal lo normalizo):
${text || ""}

Locale preferido:
${locale || "es"}

Contexto de sesion:
${serializedContext}`;
}

async function callWithTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function isLlmConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function interpretUserMessage({
  text,
  locale,
  sessionContext,
  openAiLogContext = "chatbot.intent.classification",
}) {
  const client = getOpenAIClient();
  if (!client) {
    return {
      interpretation: EMPTY_INTERPRETATION,
      meta: {
        source: "fallback",
        reason: "missing_api_key",
      },
    };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const completion = await callWithTimeout(
        (signal) =>
          createChatCompletionWithLogs(client, {
            context: openAiLogContext,
            params: {
              model: getInterpreterModel(),
              temperature: 0,
              response_format: {
                type: "json_object",
              },
              messages: [
                { role: "system", content: buildSystemPrompt() },
                {
                  role: "user",
                  content: buildUserPrompt({ text, locale, sessionContext }),
                },
              ],
            },
            requestOptions: { signal },
          }),
        REQUEST_TIMEOUT_MS
      );

      const content = completion?.choices?.[0]?.message?.content || "";
      const parsedJson = extractJsonContent(content);
      if (!parsedJson) {
        return {
          interpretation: EMPTY_INTERPRETATION,
          meta: {
            source: "fallback",
            reason: "invalid_json",
          },
        };
      }

      const normalizedRaw = normalizeRawInterpretation(parsedJson);
      const parsedResult = INTERPRETATION_SCHEMA.safeParse(normalizedRaw);
      if (!parsedResult.success) {
        return {
          interpretation: EMPTY_INTERPRETATION,
          meta: {
            source: "fallback",
            reason: "schema_validation_failed",
          },
        };
      }

      return {
        interpretation: parsedResult.data,
        meta: {
          source: "llm",
          reason: null,
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        break;
      }

      const backoff = attempt === 0 ? 300 : 900;
      await wait(backoff + Math.floor(Math.random() * 120));
    }
  }

  return {
    interpretation: EMPTY_INTERPRETATION,
    meta: {
      source: "fallback",
      reason:
        lastError?.name === "AbortError"
          ? "timeout"
          : typeof lastError?.status === "number"
            ? `http_${lastError.status}`
            : "request_failed",
    },
  };
}

export function getEmptyInterpretation() {
  return EMPTY_INTERPRETATION;
}

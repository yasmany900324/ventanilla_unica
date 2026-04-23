import OpenAI from "openai";

let llmClient = null;
let sttClient = null;
/** @type {string} */
let sttResolvedKey = "";

/**
 * Cliente singleton para el intérprete LLM (OPENAI_API_KEY).
 * @returns {import("openai").OpenAI|null}
 */
export function getLlmOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  if (!llmClient) {
    llmClient = new OpenAI({ apiKey });
  }
  return llmClient;
}

/**
 * Cliente para STT (STT_API_KEY o OPENAI_API_KEY). Instancia distinta si la clave difiere.
 * @returns {import("openai").OpenAI|null}
 */
export function getSttOpenAIClient() {
  const apiKey = (process.env.STT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return null;
  }
  if (!sttClient || sttResolvedKey !== apiKey) {
    sttClient = new OpenAI({ apiKey });
    sttResolvedKey = apiKey;
  }
  return sttClient;
}

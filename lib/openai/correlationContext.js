import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const als = new AsyncLocalStorage();

/**
 * Propaga correlationId por request HTTP hacia logs de OpenAI (AsyncLocalStorage).
 * @param {string|null|undefined} correlationId
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>|T}
 * @template T
 */
export function runWithOpenAiCorrelationId(correlationId, fn) {
  const id =
    typeof correlationId === "string" && correlationId.trim()
      ? correlationId.trim()
      : randomUUID();
  return als.run({ correlationId: id }, fn);
}

/** @returns {string|null} */
export function getOpenAiCorrelationId() {
  const store = als.getStore();
  return store?.correlationId ?? null;
}

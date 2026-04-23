/**
 * Sanitiza valores para logs (JSON): redacción, truncado, profundidad, referencias circulares.
 * Ejemplo: `sanitizeForLogs({ apiKey: "sk-x", text: "a".repeat(5000) })` → apiKey redactado, text truncado.
 */

const DEFAULTS = {
  maxDepth: 6,
  maxStringLength: 800,
  maxArrayItems: 24,
  maxObjectKeys: 40,
  largeBinaryThreshold: 200,
};

/** @type {Set<string>} */
const REDACTED_KEY_FRAGMENTS = new Set([
  "apikey",
  "authorization",
  "token",
  "secret",
  "password",
  "cookie",
  "set-cookie",
  "bearer",
  "client_secret",
  "access_token",
  "refresh_token",
  "openai_api_key",
  "stt_api_key",
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_\s]/g, "");
}

function shouldRedactKey(key) {
  const n = normalizeKey(key);
  for (const frag of REDACTED_KEY_FRAGMENTS) {
    if (n.includes(frag.replace(/[-_\s]/g, ""))) {
      return true;
    }
  }
  return false;
}

function looksLikeBase64Chunk(s) {
  if (typeof s !== "string" || s.length < DEFAULTS.largeBinaryThreshold) {
    return false;
  }
  const sample = s.slice(0, 400).replace(/\s+/g, "");
  if (sample.length < 80) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(sample)) {
    return false;
  }
  const ratio = (sample.match(/[A-Za-z0-9+/]/g) || []).length / sample.length;
  return ratio > 0.95;
}

/**
 * @param {unknown} value
 * @param {object} [options]
 * @param {number} [options.maxDepth]
 * @param {number} [options.maxStringLength]
 * @param {number} [options.maxArrayItems]
 * @param {number} [options.maxObjectKeys]
 * @param {number} [options.largeBinaryThreshold]
 * @param {WeakSet<object>} [options.seen] — uso interno (referencias circulares)
 * @param {number} [options._depth] — uso interno
 * @returns {unknown}
 */
export function sanitizeForLogs(value, options) {
  const opts = { ...DEFAULTS, ...(options || {}) };
  const seen = opts.seen || new WeakSet();
  const depth = typeof opts._depth === "number" ? opts._depth : 0;

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (looksLikeBase64Chunk(value)) {
      return "[omitted_large_content]";
    }
    if (value.length > opts.maxStringLength) {
      return `${value.slice(0, opts.maxStringLength)}…[truncated_${value.length}_chars]`;
    }
    return value;
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { _type: "Buffer", byteLength: value.length, preview: "[omitted_large_content]" };
  }

  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return { _type: "ArrayBuffer", byteLength: value.byteLength, preview: "[omitted_large_content]" };
  }

  if (Array.isArray(value)) {
    if (depth >= opts.maxDepth) {
      return `[array_depth_${depth}]`;
    }
    const out = [];
    const limit = Math.min(value.length, opts.maxArrayItems);
    for (let i = 0; i < limit; i += 1) {
      out.push(
        sanitizeForLogs(value[i], {
          ...opts,
          seen,
          _depth: depth + 1,
        })
      );
    }
    if (value.length > opts.maxArrayItems) {
      out.push(`…[truncated_array_${value.length}_items]`);
    }
    return out;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);

    if (depth >= opts.maxDepth) {
      return `[object_depth_${depth}]`;
    }

    const ctor = value.constructor?.name;
    if (ctor && ctor !== "Object" && ctor !== "Array") {
      if (typeof File !== "undefined" && value instanceof File) {
        return {
          _type: "File",
          name: sanitizeForLogs(value.name, { ...opts, seen, _depth: depth + 1 }),
          size: value.size,
          type: sanitizeForLogs(String(value.type || ""), { ...opts, seen, _depth: depth + 1 }),
          content: "[omitted_large_content]",
        };
      }
      if (typeof Blob !== "undefined" && value instanceof Blob) {
        return { _type: "Blob", size: value.size, content: "[omitted_large_content]" };
      }
      return { _type: ctor, preview: "[omitted_non_plain_object]" };
    }

    /** @type {Record<string, unknown>} */
    const out = {};
    const keys = Object.keys(value);
    const limited = keys.slice(0, opts.maxObjectKeys);
    for (const key of limited) {
      if (shouldRedactKey(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = sanitizeForLogs(value[key], {
          ...opts,
          seen,
          _depth: depth + 1,
        });
      }
    }
    if (keys.length > opts.maxObjectKeys) {
      out["…"] = `[truncated_${keys.length}_keys]`;
    }
    return out;
  }

  return String(value);
}

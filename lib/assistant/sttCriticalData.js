/**
 * Evaluación STT “crítica” para WhatsApp (Ventanilla Única).
 *
 * HARD CRITICAL — obliga eco (`sttCriticalEchoPending`) antes del resumen final:
 * - Dirección / ubicación textual con calle y número, esquina concreta, o línea de ubicación claramente estructurada.
 * - Cédula / documento (palabras clave o formatos habituales).
 * - Teléfono (p. ej. celular uruguayo 09… u otros patrones compactos).
 * - Email.
 * - Números operativos largos (p. ej. expediente / referencia larga).
 * - Nombres propios **solo** si van acompañados de señal de ubicación operativa (número de puerta, esquina, “calle …”, etc.).
 *
 * SOFT CRITICAL — **no** activa el eco por sí solo (solo sirve para heurísticas futuras / diagnóstico):
 * - Relato largo sin dato estructurado “duro”.
 * - Menciones vagas de lugar sin número ni esquina explícita.
 * - Texto amplio de contexto sin email, teléfono, documento ni dirección concreta.
 */

function truncate(s, max) {
  if (typeof s !== "string") {
    return "";
  }
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Señales “soft”: relato o contexto amplio sin dato operativo duro.
 * No deben disparar `sttCriticalEchoPending` solas.
 * @param {string} t
 */
export function textSignalsSoftCriticalStt(t) {
  if (typeof t !== "string" || !t.trim()) {
    return false;
  }
  if (textSignalsHardCriticalStt(t)) {
    return false;
  }
  if (t.trim().length > 140) {
    return true;
  }
  if (/(barrio|zona|cerca de|por la zona de|al lado de)\b/i.test(t) && !/\d{3,5}/.test(t)) {
    return true;
  }
  if (/(calle|avenida|av\.)\b/i.test(t) && !/\d{3,5}/.test(t)) {
    return true;
  }
  return false;
}

/**
 * @param {string} loc
 */
function locationLineIsHardCritical(loc) {
  if (typeof loc !== "string" || !loc.trim()) {
    return false;
  }
  const s = loc.trim();
  if (/\besquina\b/i.test(s) && s.length >= 12) {
    return true;
  }
  if (/\d{3,5}/.test(s) && /(calle|av\.?|avenida|esquina|entre|#\s*\d|número|numero|km\s*\d)/i.test(s)) {
    return true;
  }
  if (/\d{3,5}/.test(s) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{4,}/.test(s) && s.length >= 14) {
    return true;
  }
  return false;
}

/**
 * Datos duros que deben validarse antes de crear incidencia/trámite.
 * @param {string} t
 */
export function textSignalsHardCriticalStt(t) {
  if (typeof t !== "string" || !t.trim()) {
    return false;
  }
  const lower = t.toLowerCase();
  if (/\S+@\S+\.\S{2,}/i.test(t)) {
    return true;
  }
  if (/\b09\d{7}\b/.test(t)) {
    return true;
  }
  if (/\b2\d{3}[\s-]?\d{2,4}[\s-]?\d{2,4}\b/.test(t)) {
    return true;
  }
  if (/(cedula|c[ií]édula|documento|d\.?\s*n\.?\s*i\.?|pasaporte)\b/i.test(t)) {
    return true;
  }
  if (/\b\d{1}[.\s]?\d{3}[.\s]?\d{3}[.\s]?\d{1}\b/.test(t)) {
    return true;
  }
  if (/\b\d{8,}\b/.test(t)) {
    return true;
  }
  if (/\d{3,5}/.test(t) && /(calle|av\.?|avenida|esquina|entre|#\b|número|numero|km\s*\d)/i.test(t)) {
    return true;
  }
  if (/\d{3,5}/.test(t) && /(y|esquina|entre|casi|frente|altura)\b/i.test(lower)) {
    return true;
  }
  const hasStreetNumber = /\d{3,5}/.test(t);
  if (hasStreetNumber) {
    const words = t.trim().split(/\s+/).filter(Boolean);
    let capRun = 0;
    for (const w of words) {
      if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(w) && w.length > 2) {
        capRun += 1;
        if (capRun >= 2) {
          return true;
        }
      } else {
        capRun = 0;
      }
    }
  }
  return false;
}

/**
 * @deprecated Usar {@link textSignalsHardCriticalStt} o {@link textSignalsSoftCriticalStt}.
 * @param {string} t
 */
export function textSignalsCriticalStt(t) {
  return textSignalsHardCriticalStt(t) || textSignalsSoftCriticalStt(t);
}

/**
 * @param {object} params
 * @param {string|null|undefined} params.inboundUserTextSource
 * @param {string} params.channel
 * @param {string} params.text
 * @param {string[]} params.acceptedEntities
 * @param {object} params.mergedData
 * @returns {{ requiresEcho: boolean, echoLines: string[] }}
 */
export function assessSttCriticalIncidentTurn({
  inboundUserTextSource,
  channel,
  text,
  acceptedEntities,
  mergedData,
}) {
  const echoLines = [];
  if (channel !== "whatsapp" || inboundUserTextSource !== "speech_to_text") {
    return { requiresEcho: false, echoLines };
  }
  const raw = typeof text === "string" ? text : "";
  const loc = typeof mergedData?.location === "string" ? mergedData.location.trim() : "";
  const desc = typeof mergedData?.description === "string" ? mergedData.description.trim() : "";

  if (acceptedEntities.includes("location") && loc && locationLineIsHardCritical(loc)) {
    echoLines.push(`Ubicación: ${truncate(loc, 200)}`);
  }
  if (acceptedEntities.includes("description") && desc) {
    if (textSignalsHardCriticalStt(desc) || textSignalsHardCriticalStt(raw)) {
      echoLines.push(`Descripción: ${truncate(desc, 200)}`);
    }
  }
  if (textSignalsHardCriticalStt(raw) && echoLines.length === 0 && raw.trim()) {
    echoLines.push(desc ? `Detalle: ${truncate(desc, 200)}` : `Detalle: ${truncate(raw, 200)}`);
  }

  const requiresEcho = echoLines.length > 0;
  return { requiresEcho, echoLines };
}

/**
 * @param {object} params
 * @param {object} params.procedureData
 * @param {string} params.normalizedText
 */
export function assessSttCriticalProcedureTurn({ procedureData, normalizedText }) {
  const echoLines = [];
  const t = typeof normalizedText === "string" ? normalizedText : "";
  const inspect = (label, value) => {
    if (typeof value !== "string" || !value.trim()) {
      return;
    }
    if (!textSignalsHardCriticalStt(value) && !textSignalsHardCriticalStt(t)) {
      return;
    }
    echoLines.push(`${label}: ${truncate(value, 180)}`);
  };

  inspect("Detalle del trámite", procedureData?.procedureDetails);
  const fields = Array.isArray(procedureData?.procedureFieldDefinitions)
    ? procedureData.procedureFieldDefinitions
    : Array.isArray(procedureData?.procedureRequiredFields)
      ? procedureData.procedureRequiredFields
    : [];
  fields.forEach((f) => {
    const key = f?.key;
    const lab = f?.label || key;
    if (key && procedureData[key]) {
      inspect(lab, procedureData[key]);
    }
  });

  const procName = procedureData?.procedureName;
  if (
    typeof procName === "string" &&
    procName.trim() &&
    textSignalsHardCriticalStt(t) &&
    echoLines.length === 0
  ) {
    inspect("Trámite", procName);
  }

  const requiresEcho = echoLines.length > 0;
  return { requiresEcho, echoLines };
}

/**
 * @param {string[]} echoLines
 * @param {{ transcriptPreview?: string|null }} [options]
 * @returns {string}
 */
export function formatSttCriticalEchoUserReply(echoLines, options = {}) {
  const lines = Array.isArray(echoLines) ? echoLines.filter(Boolean).slice(0, 5) : [];
  if (lines.length === 0) {
    return "Antes de seguir, confirmame por escrito si lo que entendí del audio es correcto.";
  }
  const intro = "Esto fue lo que entendí de tu audio:";
  const preview =
    typeof options.transcriptPreview === "string" ? options.transcriptPreview.replace(/\s+/g, " ").trim() : "";
  const previewUse =
    preview.length > 14 &&
    !lines.some((l) => {
      const frag = preview.slice(0, 28).toLowerCase();
      return frag && l.toLowerCase().includes(frag);
    });
  const previewLine = previewUse ? `\n${truncate(preview, 110)}` : "";
  const detailLines = lines.map((l) => `${l}`).join("\n");
  return `${intro}${previewLine}\n\n${detailLines}\n\n¿Es correcto? Si está bien, respondé «sí», «ok» o «dale». Si hace falta, corregí el dato en un mensaje.`;
}

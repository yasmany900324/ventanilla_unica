import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdministrator } from "../../../../lib/auth";
import {
  ensureProcedureCatalogSchema,
  getProcedureCatalogEntryByCode,
  listProcedureCatalog,
} from "../../../../lib/procedureCatalog";
import { ensureDatabase, hasDatabase } from "../../../../lib/db";
import {
  getDefaultLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
} from "../../../../lib/i18n";

const PROCEDURE_ADMIN_MESSAGES = {
  es: {
    forbidden: "No autorizado.",
    dbRequired: "La administración de trámites requiere base de datos configurada.",
    listError: "No se pudo cargar el catálogo de trámites.",
    createError: "No se pudo crear el trámite.",
    updateError: "No se pudo actualizar el trámite.",
    invalidBody: "La solicitud no tiene un formato válido.",
    missingCode: "El código del trámite es obligatorio.",
    missingName: "El nombre del trámite es obligatorio.",
    missingFields: "Debes configurar al menos un campo requerido para el trámite.",
    duplicateCode: "Ya existe un trámite con ese código.",
    notFound: "No se encontró el trámite solicitado.",
    deleteError: "No se pudo eliminar el trámite.",
  },
  en: {
    forbidden: "Unauthorized.",
    dbRequired: "Procedure administration requires a configured database.",
    listError: "Could not load procedure catalog.",
    createError: "Could not create procedure.",
    updateError: "Could not update procedure.",
    invalidBody: "Request payload is invalid.",
    missingCode: "Procedure code is required.",
    missingName: "Procedure name is required.",
    missingFields: "At least one required field must be configured.",
    duplicateCode: "A procedure with that code already exists.",
    notFound: "Requested procedure was not found.",
    deleteError: "Could not delete procedure.",
  },
  pt: {
    forbidden: "Não autorizado.",
    dbRequired: "A administração de trâmites requer base de dados configurada.",
    listError: "Não foi possível carregar o catálogo de trâmites.",
    createError: "Não foi possível criar o trâmite.",
    updateError: "Não foi possível atualizar o trâmite.",
    invalidBody: "Formato da solicitação inválido.",
    missingCode: "O código do trâmite é obrigatório.",
    missingName: "O nome do trâmite é obrigatório.",
    missingFields: "Configure ao menos um campo obrigatório para o trâmite.",
    duplicateCode: "Já existe um trâmite com esse código.",
    notFound: "Não foi encontrado o trâmite solicitado.",
    deleteError: "Não foi possível eliminar o trâmite.",
  },
};

function resolveRequestLocale(request, searchParams) {
  return (
    normalizeLocale(searchParams.get("locale")) ||
    resolveLocaleFromAcceptLanguage(request.headers.get("accept-language")) ||
    getDefaultLocale()
  );
}

function normalizeLookup(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value, maxLength = 320) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCode(value) {
  const lookup = normalizeLookup(value);
  return lookup.replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 120);
}

function normalizeStringArray(value, maxLength = 120) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const output = [];
  value.forEach((item) => {
    const normalized = normalizeText(item, maxLength);
    if (!normalized) {
      return;
    }
    const lookup = normalizeLookup(normalized);
    if (!lookup || seen.has(lookup)) {
      return;
    }
    seen.add(lookup);
    output.push(normalized);
  });
  return output;
}

function normalizeRequiredFields(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set();
  const output = [];
  value.forEach((rawField, index) => {
    if (!rawField || typeof rawField !== "object") {
      return;
    }

    const key = normalizeCode(rawField.key).slice(0, 60);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const minLength =
      Number.isInteger(rawField?.validation?.minLength) && rawField.validation.minLength > 0
        ? rawField.validation.minLength
        : null;
    const maxLength =
      Number.isInteger(rawField?.validation?.maxLength) && rawField.validation.maxLength >= 1
        ? rawField.validation.maxLength
        : null;
    const pattern = normalizeText(rawField?.validation?.pattern, 120);
    const validation = {};
    if (minLength) {
      validation.minLength = minLength;
    }
    if (maxLength) {
      validation.maxLength = maxLength;
    }
    if (pattern) {
      validation.pattern = pattern;
    }

    output.push({
      key,
      label: normalizeText(rawField.label || key, 120),
      prompt: normalizeText(rawField.prompt || `Indícame ${rawField.label || key}.`, 280),
      type: normalizeLookup(rawField.type || "text") || "text",
      required: rawField.required !== false,
      options: normalizeStringArray(rawField.options || [], 80),
      validation,
      order: Number.isInteger(rawField.order) ? rawField.order : index,
    });
  });

  return output.sort((a, b) => a.order - b.order);
}

function normalizeFlowDefinition(value) {
  if (!value || typeof value !== "object") {
    return {};
  }

  const completionMessage = normalizeText(value.completionMessage, 260);
  return completionMessage ? { completionMessage } : {};
}

function normalizeProcedurePayload(rawPayload, messages) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : null;
  if (!payload) {
    return { ok: false, error: messages.invalidBody };
  }

  const code = normalizeCode(payload.code);
  if (!code) {
    return { ok: false, error: messages.missingCode };
  }
  const name = normalizeText(payload.name, 160);
  if (!name) {
    return { ok: false, error: messages.missingName };
  }

  const requiredFields = normalizeRequiredFields(payload.requiredFields || []);
  if (requiredFields.length === 0) {
    return { ok: false, error: messages.missingFields };
  }

  return {
    ok: true,
    value: {
      code,
      name,
      description: normalizeText(payload.description, 320),
      category: normalizeText(payload.category, 80),
      aliases: normalizeStringArray(payload.aliases || [], 120),
      keywords: normalizeStringArray(payload.keywords || [], 120),
      isActive: payload.isActive !== false,
      requiredFields,
      flowDefinition: normalizeFlowDefinition(payload.flowDefinition),
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    await ensureProcedureCatalogSchema();
    const includeInactive = normalizeLookup(searchParams.get("includeInactive")) === "true";
    const procedures = await listProcedureCatalog({ includeInactive });
    return NextResponse.json({ procedures });
  } catch (_error) {
    return NextResponse.json({ error: messages.listError }, { status: 500 });
  }
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }
    const normalized = normalizeProcedurePayload(body, messages);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const sql = ensureDatabase();
    const [existing] = await sql`
      SELECT id
      FROM chatbot_procedure_catalog
      WHERE code = ${normalized.value.code}
      LIMIT 1;
    `;
    if (existing) {
      return NextResponse.json({ error: messages.duplicateCode }, { status: 409 });
    }

    const [created] = await sql`
      INSERT INTO chatbot_procedure_catalog (
        id,
        code,
        name,
        description,
        category,
        aliases_json,
        keywords_json,
        is_active,
        required_fields_json,
        flow_definition_json,
        updated_at
      )
      VALUES (
        ${randomUUID()},
        ${normalized.value.code},
        ${normalized.value.name},
        ${normalized.value.description},
        ${normalized.value.category},
        ${JSON.stringify(normalized.value.aliases)}::jsonb,
        ${JSON.stringify(normalized.value.keywords)}::jsonb,
        ${normalized.value.isActive},
        ${JSON.stringify(normalized.value.requiredFields)}::jsonb,
        ${JSON.stringify(normalized.value.flowDefinition)}::jsonb,
        NOW()
      )
      RETURNING code;
    `;

    const procedure = await getProcedureCatalogEntryByCode(created?.code || normalized.value.code, {
      includeInactive: true,
    });
    return NextResponse.json(
      { ok: true, code: created?.code || normalized.value.code, procedure },
      { status: 201 }
    );
  } catch (_error) {
    return NextResponse.json({ error: messages.createError }, { status: 500 });
  }
}

export async function PATCH(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const code = normalizeCode(body?.code);
    if (!code) {
      return NextResponse.json({ error: messages.missingCode }, { status: 400 });
    }

    const existingProcedure = await getProcedureCatalogEntryByCode(code, {
      includeInactive: true,
    });
    if (!existingProcedure) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }

    const isStatusOnlyPatch =
      typeof body?.isActive === "boolean" &&
      typeof body?.name !== "string" &&
      typeof body?.description !== "string" &&
      typeof body?.category !== "string" &&
      !Array.isArray(body?.requiredFields) &&
      !Array.isArray(body?.aliases) &&
      !Array.isArray(body?.keywords);

    if (isStatusOnlyPatch) {
      const sql = ensureDatabase();
      const [updated] = await sql`
        UPDATE chatbot_procedure_catalog
        SET
          is_active = ${body.isActive},
          updated_at = NOW()
        WHERE code = ${code}
        RETURNING code;
      `;
      if (!updated) {
        return NextResponse.json({ error: messages.notFound }, { status: 404 });
      }

      const procedure = await getProcedureCatalogEntryByCode(updated.code, {
        includeInactive: true,
      });
      return NextResponse.json({ ok: true, code: updated.code, procedure });
    }

    const normalized = normalizeProcedurePayload(
      {
        ...existingProcedure,
        ...body,
        code,
        isActive:
          typeof body?.isActive === "boolean"
            ? body.isActive
            : Boolean(existingProcedure.isActive),
      },
      messages
    );
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const sql = ensureDatabase();
    const [updated] = await sql`
      UPDATE chatbot_procedure_catalog
      SET
        name = ${normalized.value.name},
        description = ${normalized.value.description},
        category = ${normalized.value.category},
        aliases_json = ${JSON.stringify(normalized.value.aliases)}::jsonb,
        keywords_json = ${JSON.stringify(normalized.value.keywords)}::jsonb,
        is_active = ${normalized.value.isActive},
        required_fields_json = ${JSON.stringify(normalized.value.requiredFields)}::jsonb,
        flow_definition_json = ${JSON.stringify(normalized.value.flowDefinition)}::jsonb,
        updated_at = NOW()
      WHERE code = ${normalized.value.code}
      RETURNING code;
    `;
    if (!updated) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }

    const procedure = await getProcedureCatalogEntryByCode(updated.code, {
      includeInactive: true,
    });
    return NextResponse.json({ ok: true, code: updated.code, procedure });
  } catch (_error) {
    return NextResponse.json({ error: messages.updateError }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const locale = resolveRequestLocale(request, searchParams);
  const messages = PROCEDURE_ADMIN_MESSAGES[locale] || PROCEDURE_ADMIN_MESSAGES.es;

  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: messages.forbidden }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json({ error: messages.dbRequired }, { status: 503 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_error) {
      return NextResponse.json({ error: messages.invalidBody }, { status: 400 });
    }

    const code = normalizeCode(body?.code);
    if (!code) {
      return NextResponse.json({ error: messages.missingCode }, { status: 400 });
    }

    await ensureProcedureCatalogSchema();
    const sql = ensureDatabase();
    const [deleted] = await sql`
      DELETE FROM chatbot_procedure_catalog
      WHERE code = ${code}
      RETURNING code;
    `;
    if (!deleted) {
      return NextResponse.json({ error: messages.notFound }, { status: 404 });
    }

    return NextResponse.json({ ok: true, code: deleted.code });
  } catch (_error) {
    return NextResponse.json({ error: messages.deleteError }, { status: 500 });
  }
}

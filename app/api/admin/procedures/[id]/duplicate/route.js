import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdministrator } from "../../../../../../lib/auth";
import { ensureDatabase, hasDatabase } from "../../../../../../lib/db";
import { ensureProcedureCatalogSchema, getProcedureCatalogEntryById } from "../../../../../../lib/procedureCatalog";
import { ensureProcedureAssignmentsSchema } from "../../../../../../lib/procedureAssignments";

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

function parseJsonColumn(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      return fallback;
    }
  }
  return value;
}

async function codeExists(tx, code) {
  const [row] = await tx`
    SELECT id
    FROM chatbot_procedure_catalog
    WHERE code = ${code}
      AND case_type = 'procedure'
    LIMIT 1;
  `;
  return Boolean(row?.id);
}

async function buildUniqueCode(tx, sourceCode) {
  const base = normalizeCode(`${sourceCode}_copia`) || "procedimiento_copia";
  if (!(await codeExists(tx, base))) {
    return base;
  }
  let index = 1;
  while (index <= 9999) {
    const candidate = normalizeCode(`${base}_copy_${index}`);
    if (candidate && !(await codeExists(tx, candidate))) {
      return candidate;
    }
    index += 1;
  }
  throw new Error("No se pudo generar un código único para el duplicado.");
}

function sanitizeFlowDefinitionForNonCamunda() {
  return {};
}

export async function POST(request, { params }) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!hasDatabase()) {
      return NextResponse.json(
        { error: "La administración del catálogo de procedimientos requiere base de datos configurada." },
        { status: 503 }
      );
    }

    const { id } = await params;
    const sourceProcedureId = normalizeText(id, 80);
    if (!sourceProcedureId) {
      return NextResponse.json({ error: "El id del procedimiento origen es obligatorio." }, { status: 400 });
    }

    let body = {};
    try {
      body = await request.json();
    } catch (_error) {
      body = {};
    }

    const copyFields = body?.copyFields !== false;
    const copyCamunda = body?.copyCamunda === true;
    const copyAssignments = body?.copyAssignments === true;
    if (copyCamunda && !copyFields) {
      return NextResponse.json(
        { error: "No se puede copiar configuración Camunda si no se copian los campos del procedimiento." },
        { status: 400 }
      );
    }

    await ensureProcedureCatalogSchema();
    if (copyAssignments) {
      await ensureProcedureAssignmentsSchema();
    }
    const sql = ensureDatabase();
    const warnings = [];

    const transactionResult = await sql.begin(async (tx) => {
      const [sourceRow] = await tx`
        SELECT
          id,
          code,
          name,
          description,
          category,
          case_type,
          enabled_channels_json,
          required_fields_json,
          flow_definition_json,
          camunda_process_id,
          version
        FROM chatbot_procedure_catalog
        WHERE id = ${sourceProcedureId}
          AND case_type = 'procedure'
        LIMIT 1;
      `;
      if (!sourceRow?.id) {
        const notFoundError = new Error("SOURCE_NOT_FOUND");
        notFoundError.code = "SOURCE_NOT_FOUND";
        throw notFoundError;
      }

      const sourceCode = normalizeCode(sourceRow.code);
      const sourceName = normalizeText(sourceRow.name, 160) || "Procedimiento";
      const requestedName = normalizeText(body?.newName, 160);
      const nextName = requestedName || `${sourceName} - copia`;
      if (!nextName) {
        const invalidNameError = new Error("INVALID_NAME");
        invalidNameError.code = "INVALID_NAME";
        throw invalidNameError;
      }

      const requestedCode = normalizeCode(body?.newCode);
      let nextCode = requestedCode;
      if (!nextCode) {
        nextCode = await buildUniqueCode(tx, sourceCode || "procedimiento");
      } else if (await codeExists(tx, nextCode)) {
        const duplicateError = new Error("DUPLICATE_CODE");
        duplicateError.code = "DUPLICATE_CODE";
        throw duplicateError;
      }

      const sourceFlowDefinition = parseJsonColumn(sourceRow.flow_definition_json, {});
      const sourceEnabledChannels = parseJsonColumn(sourceRow.enabled_channels_json, ["web", "whatsapp"]);
      const sourceRequiredFields = parseJsonColumn(sourceRow.required_fields_json, []);

      const [createdCatalogRow] = await tx`
        INSERT INTO chatbot_procedure_catalog (
          id,
          code,
          name,
          description,
          category,
          case_type,
          aliases_json,
          keywords_json,
          is_active,
          camunda_process_id,
          version,
          enabled_channels_json,
          required_fields_json,
          flow_definition_json,
          metadata_json,
          updated_at
        )
        VALUES (
          ${randomUUID()},
          ${nextCode},
          ${nextName},
          ${normalizeText(sourceRow.description, 320)},
          ${normalizeText(sourceRow.category, 80)},
          'procedure',
          '[]'::jsonb,
          '[]'::jsonb,
          ${false},
          ${copyCamunda ? normalizeText(sourceRow.camunda_process_id, 160) || null : null},
          ${copyCamunda ? normalizeText(sourceRow.version, 80) || null : null},
          ${JSON.stringify(Array.isArray(sourceEnabledChannels) ? sourceEnabledChannels : ["web", "whatsapp"])}::jsonb,
          ${JSON.stringify(copyFields ? (Array.isArray(sourceRequiredFields) ? sourceRequiredFields : []) : [])}::jsonb,
          ${JSON.stringify(copyCamunda ? sourceFlowDefinition : sanitizeFlowDefinitionForNonCamunda())}::jsonb,
          '{}'::jsonb,
          NOW()
        )
        RETURNING id, code;
      `;

      if (!createdCatalogRow?.id) {
        throw new Error("No se pudo crear el procedimiento duplicado.");
      }

      const sourceFields = copyFields
        ? await tx`
            SELECT
              field_key,
              label,
              field_type,
              is_required,
              field_order,
              options_json,
              is_enabled
            FROM chatbot_procedure_fields
            WHERE procedure_type_id = ${sourceProcedureId}
            ORDER BY field_order ASC, created_at ASC;
          `
        : [];
      if (copyFields) {
        const dedupeFieldKeys = new Set();
        for (const field of sourceFields) {
          const normalizedFieldKey = normalizeText(field?.field_key, 60);
          if (!normalizedFieldKey) {
            continue;
          }
          const dedupeKey = normalizedFieldKey.toLowerCase();
          if (dedupeFieldKeys.has(dedupeKey)) {
            const duplicatedKeyError = new Error("DUPLICATED_FIELD_KEYS");
            duplicatedKeyError.code = "DUPLICATED_FIELD_KEYS";
            throw duplicatedKeyError;
          }
          dedupeFieldKeys.add(dedupeKey);
        }
        for (const field of sourceFields) {
          await tx`
            INSERT INTO chatbot_procedure_fields (
              id,
              procedure_type_id,
              field_key,
              label,
              field_type,
              is_required,
              options_json,
              field_order,
              is_enabled,
              updated_at
            )
            VALUES (
              ${randomUUID()},
              ${createdCatalogRow.id},
              ${normalizeText(field?.field_key, 60)},
              ${normalizeText(field?.label, 120)},
              ${normalizeText(field?.field_type, 40) || "text"},
              ${field?.is_required !== false},
              ${JSON.stringify(parseJsonColumn(field?.options_json, []))}::jsonb,
              ${Number.isInteger(field?.field_order) ? field.field_order : 0},
              ${field?.is_enabled !== false},
              NOW()
            );
          `;
        }
      }

      const sourceMappings = copyCamunda
        ? await tx`
            SELECT
              scope,
              camunda_task_definition_key,
              procedure_field_key,
              camunda_variable_name,
              camunda_variable_type,
              is_required,
              is_enabled
            FROM chatbot_procedure_camunda_variable_mappings
            WHERE procedure_type_id = ${sourceProcedureId}
            ORDER BY scope ASC, camunda_task_definition_key ASC NULLS FIRST, camunda_variable_name ASC;
          `
        : [];

      if (copyCamunda) {
        const copiedFieldKeys = new Set(
          sourceFields
            .map((field) => normalizeText(field?.field_key, 60).toLowerCase())
            .filter(Boolean)
        );
        for (const mapping of sourceMappings) {
          const mappingFieldKey = normalizeText(mapping?.procedure_field_key, 60).toLowerCase();
          if (!mappingFieldKey || !copiedFieldKeys.has(mappingFieldKey)) {
            const invalidMappingError = new Error("INVALID_CAMUNDA_MAPPING_FIELD");
            invalidMappingError.code = "INVALID_CAMUNDA_MAPPING_FIELD";
            throw invalidMappingError;
          }
        }
        for (const mapping of sourceMappings) {
          await tx`
            INSERT INTO chatbot_procedure_camunda_variable_mappings (
              id,
              procedure_type_id,
              scope,
              camunda_task_definition_key,
              procedure_field_key,
              camunda_variable_name,
              camunda_variable_type,
              is_required,
              is_enabled,
              updated_at
            )
            VALUES (
              ${randomUUID()},
              ${createdCatalogRow.id},
              ${normalizeText(mapping?.scope, 40)},
              ${normalizeText(mapping?.camunda_task_definition_key, 160) || null},
              ${normalizeText(mapping?.procedure_field_key, 60)},
              ${normalizeText(mapping?.camunda_variable_name, 160)},
              ${normalizeText(mapping?.camunda_variable_type, 40) || "string"},
              ${mapping?.is_required !== false},
              ${mapping?.is_enabled !== false},
              NOW()
            );
          `;
        }
      } else if (normalizeText(sourceRow.camunda_process_id, 160)) {
        warnings.push("La configuración Camunda/BPMN no fue copiada.");
      }

      if (copyAssignments) {
        const sourceAssignments = await tx`
          SELECT user_id
          FROM procedure_type_assignees
          WHERE procedure_type_id = ${sourceProcedureId};
        `;
        for (const assignment of sourceAssignments) {
          await tx`
            INSERT INTO procedure_type_assignees (
              id,
              procedure_type_id,
              user_id,
              created_at,
              created_by
            )
            VALUES (
              ${randomUUID()},
              ${createdCatalogRow.id},
              ${normalizeText(assignment?.user_id, 80)},
              NOW(),
              ${normalizeText(administrator?.id, 80) || null}
            )
            ON CONFLICT (procedure_type_id, user_id) DO NOTHING;
          `;
        }
      }

      return {
        sourceCode,
        newCode: createdCatalogRow.code,
        newProcedureId: createdCatalogRow.id,
      };
    });

    const duplicatedProcedure = await getProcedureCatalogEntryById(transactionResult.newProcedureId, {
      includeInactive: true,
    });
    console.info("[admin:procedure-duplicated]", {
      sourceProcedureId,
      newProcedureId: transactionResult.newProcedureId,
      sourceCode: transactionResult.sourceCode,
      newCode: transactionResult.newCode,
      copyFields,
      copyCamunda,
      copyAssignments,
      actorId: administrator?.id || null,
      occurredAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        sourceProcedureId,
        procedure: duplicatedProcedure
          ? {
              id: duplicatedProcedure.id,
              code: duplicatedProcedure.code,
              name: duplicatedProcedure.name,
              isActive: duplicatedProcedure.isActive,
            }
          : {
              id: transactionResult.newProcedureId,
              code: transactionResult.newCode,
              name: null,
              isActive: false,
            },
        warnings,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error?.code === "SOURCE_NOT_FOUND") {
      return NextResponse.json({ error: "No se encontró el procedimiento origen." }, { status: 404 });
    }
    if (error?.code === "DUPLICATE_CODE") {
      return NextResponse.json({ error: "Ya existe un procedimiento con ese código." }, { status: 409 });
    }
    if (error?.code === "INVALID_NAME") {
      return NextResponse.json({ error: "El nombre del nuevo procedimiento es obligatorio." }, { status: 400 });
    }
    if (error?.code === "DUPLICATED_FIELD_KEYS") {
      return NextResponse.json(
        { error: "No se pudo duplicar porque existen field_key duplicados en los campos configurables." },
        { status: 400 }
      );
    }
    if (error?.code === "INVALID_CAMUNDA_MAPPING_FIELD") {
      return NextResponse.json(
        { error: "Los mappings Camunda hacen referencia a campos inexistentes en el procedimiento duplicado." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "No se pudo duplicar el procedimiento." }, { status: 500 });
  }
}

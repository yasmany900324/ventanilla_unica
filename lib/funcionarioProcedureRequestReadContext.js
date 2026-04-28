import { NextResponse } from "next/server";
import { requireBackofficeUser, userHasRole } from "./auth";
import { ROLES } from "./roles";
import { getProcedureRequestById, resolveFuncionarioAssignmentScopeForProcedureRequest } from "./procedureRequests";

/**
 * Resuelve expediente + permisos de lectura para rutas funcionario (detalle, BPMN, resumen de flujo).
 *
 * @param {Request} request
 * @param {string} procedureRequestId
 * @returns {Promise<
 *   | { ok: true, actor: Record<string, unknown>, procedureRequest: Record<string, unknown>, assignmentScope: string }
 *   | { ok: false, response: NextResponse }
 * >}
 */
export async function resolveFuncionarioProcedureRequestReadContext(request, procedureRequestId) {
  const actor = await requireBackofficeUser(request);
  if (!actor) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado." }, { status: 403 }) };
  }
  const normalizedId = String(procedureRequestId || "").trim();
  if (!normalizedId) {
    return { ok: false, response: NextResponse.json({ error: "Solicitud inválida." }, { status: 400 }) };
  }
  const procedureRequest = await getProcedureRequestById(normalizedId);
  if (!procedureRequest) {
    return { ok: false, response: NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 }) };
  }
  const isAdmin = userHasRole(actor, ROLES.ADMIN);
  const assignmentScope = isAdmin
    ? "admin"
    : await resolveFuncionarioAssignmentScopeForProcedureRequest({
        funcionarioUserId: actor.id,
        procedureRequestId: procedureRequest.id,
      });
  if (!isAdmin && !assignmentScope) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "No tienes permisos para ver este expediente o ya fue tomado por otro funcionario.",
        },
        { status: 403 }
      ),
    };
  }
  return { ok: true, actor, procedureRequest, assignmentScope };
}

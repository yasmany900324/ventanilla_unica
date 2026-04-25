import { NextResponse } from "next/server";
import { requireFuncionario } from "../../../../../../../lib/auth";
import {
  claimProcedureRequestForFuncionarioInbox,
  getProcedureRequestById,
} from "../../../../../../../lib/procedureRequests";

export async function POST(request, { params }) {
  try {
    const funcionario = await requireFuncionario(request);
    if (!funcionario) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    if (!funcionario?.id) {
      return NextResponse.json({ error: "Actor no válido." }, { status: 403 });
    }

    const procedureRequestId = params?.id;
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }

    const result = await claimProcedureRequestForFuncionarioInbox({
      procedureRequestId,
      funcionarioUserId: funcionario.id,
    });
    if (!result?.ok) {
      if (result.status === 403 || result.reason === "procedure_type_not_enabled") {
        return NextResponse.json(
          { error: "No estás habilitado para tomar este tipo de procedimiento." },
          { status: 403 }
        );
      }
      if (result.status === 409 || result.reason === "assigned_to_other") {
        return NextResponse.json(
          { error: "Este expediente ya fue tomado por otro funcionario." },
          { status: 409 }
        );
      }
      if (result.status === 404 || result.reason === "procedure_not_found") {
        return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
      }
      return NextResponse.json({ error: "No se pudo tomar el expediente." }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      idempotent: result.idempotent === true,
      message:
        result.idempotent === true ? "El expediente ya estaba asignado a ti." : "Expediente tomado correctamente.",
      procedureRequest: result.procedureRequest || null,
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo tomar el expediente." }, { status: 500 });
  }
}

import path from "path";
import { NextResponse } from "next/server";
import { requireBackofficeUser, userHasRole } from "../../../../../../../lib/auth";
import { ROLES } from "../../../../../../../lib/roles";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { extractDraftAttachmentRefFromCollectedData } from "../../../../../../../lib/attachments/draftAttachmentRef";
import { getIncidentAttachmentStorageByProvider } from "../../../../../../../lib/attachments/getIncidentAttachmentStorage";
import { getImageMimeFromExtensionOrDefault } from "../../../../../../../lib/imageReference";
import {
  getProcedureRequestById,
  resolveFuncionarioAssignmentScopeForProcedureRequest,
} from "../../../../../../../lib/procedureRequests";

export const runtime = "nodejs";

function mimeForBasename(name) {
  return getImageMimeFromExtensionOrDefault(name, "application/octet-stream");
}

export async function GET(request, { params }) {
  try {
    const actor = await requireBackofficeUser(request);
    if (!actor) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el expediente solicitado." }, { status: 404 });
    }

    const isAdmin = userHasRole(actor, ROLES.ADMIN);
    const assignmentScope = isAdmin
      ? "admin"
      : await resolveFuncionarioAssignmentScopeForProcedureRequest({
          funcionarioUserId: actor.id,
          procedureRequestId: procedureRequest.id,
        });
    if (!isAdmin && !assignmentScope) {
      return NextResponse.json({ error: "No tienes permisos para acceder al adjunto." }, { status: 403 });
    }

    const collectedData =
      procedureRequest.collectedData && typeof procedureRequest.collectedData === "object"
        ? procedureRequest.collectedData
        : {};
    const draftRef = extractDraftAttachmentRefFromCollectedData(collectedData);
    if (!draftRef) {
      return NextResponse.json({ error: "No hay imagen adjunta para este expediente." }, { status: 404 });
    }

    const storage = getIncidentAttachmentStorageByProvider(draftRef.storageProvider);
    const bytesResult = await storage.readDraftAttachmentBytes(draftRef);
    if (!bytesResult?.buffer) {
      return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });
    }

    const contentType =
      bytesResult.mimeType ||
      draftRef.mimeType ||
      mimeForBasename(path.basename(draftRef.storageKey || collectedData.photoAttachmentStoredFilename || ""));

    return new NextResponse(bytesResult.buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (_error) {
    return NextResponse.json({ error: "No se pudo obtener la imagen adjunta." }, { status: 500 });
  }
}

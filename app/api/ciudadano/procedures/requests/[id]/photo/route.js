import path from "path";
import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "../../../../../../../lib/auth";
import { getAppRouteParamString } from "../../../../../../../lib/nextAppRouteParams";
import { extractDraftAttachmentRefFromCollectedData } from "../../../../../../../lib/attachments/draftAttachmentRef";
import { getIncidentAttachmentStorageByProvider } from "../../../../../../../lib/attachments/getIncidentAttachmentStorage";
import { getImageMimeFromExtensionOrDefault } from "../../../../../../../lib/imageReference";
import { getProcedureRequestById } from "../../../../../../../lib/procedureRequests";

export const runtime = "nodejs";

function mimeForBasename(name) {
  return getImageMimeFromExtensionOrDefault(name, "application/octet-stream");
}

export async function GET(request, { params }) {
  try {
    const user = await requireAuthenticatedUser(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const procedureRequestId = await getAppRouteParamString(params, "id");
    const procedureRequest = await getProcedureRequestById(procedureRequestId);
    if (!procedureRequest) {
      return NextResponse.json({ error: "No se encontró el trámite solicitado." }, { status: 404 });
    }
    if (String(procedureRequest.userId || "").trim() !== String(user.id || "").trim()) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const collectedData =
      procedureRequest.collectedData && typeof procedureRequest.collectedData === "object"
        ? procedureRequest.collectedData
        : {};
    const draftRef = extractDraftAttachmentRefFromCollectedData(collectedData);
    if (!draftRef) {
      return NextResponse.json({ error: "No hay imagen adjunta para este trámite." }, { status: 404 });
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

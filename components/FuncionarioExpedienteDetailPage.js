"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { normalizeImageReference } from "../lib/imageReference";
import {
  ACTIVE_TASK_API_MISS_USER_MESSAGE,
  buildCamundaAssigneeResponsibilityLabel,
  buildFunctionalWorkflowStateLabel,
  buildInboxRelationLabelFromOwner,
  buildOperativeStepLabel,
  buildOperationalSituation,
  computeRequiresCamundaRetry,
  deriveCamundaStatus,
  splitOperationalErrors,
} from "../lib/funcionarioExpedienteOperationalCamunda";
import { deriveFuncionarioExpedienteActionUi } from "../lib/funcionarioExpedienteDetailActionUi";
import CaseHeader from "./funcionarioExpedienteDetail/CaseHeader";
import CaseSummaryCard from "./funcionarioExpedienteDetail/CaseSummaryCard";
import CitizenInfoCard from "./funcionarioExpedienteDetail/CitizenInfoCard";
import CaseProgressCard from "./funcionarioExpedienteDetail/CaseProgressCard";
import CaseTramiteStatusCard from "./funcionarioExpedienteDetail/CaseTramiteStatusCard";
import CaseRecentActivityCard from "./funcionarioExpedienteDetail/CaseRecentActivityCard";
import CompleteStepWideCard from "./funcionarioExpedienteDetail/CompleteStepWideCard";
import CurrentActionCard from "./funcionarioExpedienteDetail/CurrentActionCard";
import TechnicalInfoAccordion from "./funcionarioExpedienteDetail/TechnicalInfoAccordion";
import DangerZoneCard from "./funcionarioExpedienteDetail/DangerZoneCard";

const LocationMapPreview = dynamic(() => import("./LocationMapPreview"), { ssr: false });

const LOCAL_STATUS_LABELS = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de sincronización",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  CAMUNDA_ACTIVE_TASK_NOT_FOUND: "Instancia activa (tarea API no resuelta)",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

const CAMUNDA_STATUS_LABELS = {
  ERROR_SYNC: "Error de sincronización",
  TASK_ACTIVE: "Pendiente de revisión",
  SYNC_PENDING: "Pendiente de sincronización",
  ACTIVE_TASK_NOT_FOUND: "Instancia activa (tarea API no resuelta)",
  PROCESS_RUNNING: "Instancia creada (sin tarea activa)",
  PROCESS_COMPLETED: "Finalizado",
  NOT_SYNCED: "No sincronizado",
};

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

class MapRenderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (IS_DEVELOPMENT) {
      console.warn("[quick-preview:location] map render error", error);
    }
    if (typeof this.props.onError === "function") {
      this.props.onError(error);
    }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || null;
    }
    return this.props.children;
  }
}

function hasRole(user, targetRole) {
  const normalizedTarget = String(targetRole || "").trim().toLowerCase();
  const roles = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role];
  return roles.map((role) => String(role || "").trim().toLowerCase()).includes(normalizedTarget);
}

function formatDateTime(value, locale) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString(locale || "es");
}

function parseJsonInput(value, fallback = {}) {
  if (!value || !String(value).trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function getLocalStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  if (key === "PENDING_CAMUNDA_SYNC") {
    return "Pendiente de procesamiento";
  }
  return LOCAL_STATUS_LABELS[key] || value || "-";
}

function getCamundaStatusLabel(value) {
  const key = String(value || "").trim().toUpperCase();
  return CAMUNDA_STATUS_LABELS[key] || value || "-";
}

function getAssignmentScopeLabel(item) {
  if (item?.assignmentScope === "assigned_to_me") {
    return "Asignado a mí";
  }
  if (item?.assignmentScope === "available") {
    return "Disponible para tomar";
  }
  if (item?.assignmentScope === "admin") {
    return null;
  }
  if (item?.assignedToUserId) {
    return "Asignado a otro funcionario";
  }
  return "Disponible para tomar";
}

function buildBandejaRelationSimple(procedureRequest) {
  if (!procedureRequest) {
    return "—";
  }
  if (procedureRequest.assignmentScope === "assigned_to_me") {
    return "Asignado a mí";
  }
  if (procedureRequest.assignmentScope === "available") {
    return "Disponible para tomar";
  }
  if (procedureRequest.assignmentScope === "admin") {
    return "Disponible para todo el equipo";
  }
  if (procedureRequest.assignedToUserId) {
    return "Asignado a otro funcionario";
  }
  return "Disponible para tomar";
}

function resolveActionCardBadge({ isAvailable, functionalWorkflowStateLabel }) {
  if (isAvailable) {
    return { label: "Disponible para tomar", tone: "waiting" };
  }
  const f = String(functionalWorkflowStateLabel || "");
  if (f.includes("Pendiente de tomar")) {
    return { label: "Pendiente de tomar", tone: "warning" };
  }
  if (f.includes("Sin tarea")) {
    return { label: "Sin tarea activa", tone: "neutral" };
  }
  if (f.includes("Completada")) {
    return { label: "Trámite completado", tone: "resolved" };
  }
  return { label: "En gestión", tone: "progress" };
}

function resolveAttachmentValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const candidates = [
    collectedData.photo,
    collectedData.photoUrl,
    collectedData.image,
    collectedData.imageUrl,
    collectedData.attachmentUrl,
    collectedData.photoAttachmentPublicUrl,
    collectedData.photoAttachmentOriginalName,
    collectedData.photoAttachmentStoredFilename,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || null;
}

function getProcedureFieldDefinitions(detail) {
  const fromType = Array.isArray(detail?.procedureType?.fieldDefinitions)
    ? detail.procedureType.fieldDefinitions
    : Array.isArray(detail?.procedureType?.requiredFields)
      ? detail.procedureType.requiredFields
      : [];
  return fromType.filter((field) => field && typeof field === "object");
}

function normalizeFieldType(value) {
  return String(value || "").trim().toLowerCase();
}

function isImageFieldType(type) {
  const normalized = normalizeFieldType(type);
  return normalized === "image" || normalized === "photo";
}

function isLocationFieldType(type) {
  return normalizeFieldType(type) === "location";
}

function resolveTypedFieldValueByMatcher(collectedData, fieldDefinitions, matcher) {
  const candidate = fieldDefinitions.find((field) => matcher(field?.type));
  if (!candidate?.key) {
    return null;
  }
  return collectedData?.[candidate.key] ?? null;
}

function parseCoordinatesCandidate(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

function extractCoordinatesFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const direct = parseCoordinatesCandidate(
    metadata.latitude ?? metadata.lat ?? metadata?.coords?.latitude ?? metadata?.location?.latitude,
    metadata.longitude ??
      metadata.lng ??
      metadata.lon ??
      metadata?.coords?.longitude ??
      metadata?.location?.longitude
  );
  if (direct) {
    return direct;
  }
  if (Array.isArray(metadata.coordinates) && metadata.coordinates.length >= 2) {
    const fromArray = parseCoordinatesCandidate(metadata.coordinates[1], metadata.coordinates[0]);
    if (fromArray) {
      return fromArray;
    }
  }
  return null;
}

function extractCoordinatesFromLocationText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const coordPair = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (coordPair) {
    return parseCoordinatesCandidate(coordPair[1], coordPair[2]);
  }
  const latLonRegex =
    /lat(?:itud|itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)[\s,;/|-]*lon(?:gitud|gitude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i;
  const latLonMatch = text.match(latLonRegex);
  if (latLonMatch) {
    return parseCoordinatesCandidate(latLonMatch[1], latLonMatch[2]);
  }
  return null;
}

function extractCoordinatesFromLocationValue(rawLocation, collectedData, metadata) {
  if (rawLocation && typeof rawLocation === "object") {
    const fromObject = parseCoordinatesCandidate(
      rawLocation.latitude ?? rawLocation.lat ?? rawLocation?.coords?.latitude,
      rawLocation.longitude ?? rawLocation.lng ?? rawLocation.lon ?? rawLocation?.coords?.longitude
    );
    if (fromObject) {
      return fromObject;
    }
    if (Array.isArray(rawLocation.coordinates) && rawLocation.coordinates.length >= 2) {
      const fromCoordinates = parseCoordinatesCandidate(rawLocation.coordinates[1], rawLocation.coordinates[0]);
      if (fromCoordinates) {
        return fromCoordinates;
      }
    }
  }
  const fromText = extractCoordinatesFromLocationText(rawLocation);
  if (fromText) {
    return fromText;
  }
  const fromCommonFields =
    parseCoordinatesCandidate(collectedData?.locationLatitude, collectedData?.locationLongitude) ||
    parseCoordinatesCandidate(collectedData?.lat, collectedData?.lng) ||
    parseCoordinatesCandidate(collectedData?.latitude, collectedData?.longitude);
  if (fromCommonFields) {
    return fromCommonFields;
  }
  return extractCoordinatesFromMetadata(metadata);
}

function resolveLocationValue(collectedData) {
  if (!collectedData || typeof collectedData !== "object") {
    return null;
  }
  const location = collectedData.location ?? collectedData.address ?? null;
  if (!location) {
    return null;
  }
  if (typeof location === "string") {
    return location;
  }
  return stringifyJson(location);
}

function formatLocationForDisplay(rawLocation) {
  if (!rawLocation) {
    return null;
  }
  if (typeof rawLocation === "string") {
    const text = rawLocation.trim();
    return text.length >= 5 ? text : "Formato inválido";
  }
  if (rawLocation && typeof rawLocation === "object") {
    const text = String(rawLocation.text || rawLocation.address || "").trim();
    const latitude = Number(rawLocation.latitude ?? rawLocation.lat);
    const longitude = Number(rawLocation.longitude ?? rawLocation.lng ?? rawLocation.lon);
    if (text) {
      return text;
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `${latitude}, ${longitude}`;
    }
  }
  return "Formato inválido";
}

function buildProcedurePhotoPreviewUrl(procedureRequestId, collectedData) {
  if (!procedureRequestId || !collectedData || typeof collectedData !== "object") {
    return "";
  }
  const catalogPhoto = collectedData.photo && typeof collectedData.photo === "object" ? collectedData.photo : null;
  const catalogUrl =
    catalogPhoto && typeof catalogPhoto.url === "string" ? catalogPhoto.url.trim() : "";
  const publicUrl =
    catalogUrl ||
    (typeof collectedData.photoAttachmentPublicUrl === "string"
      ? collectedData.photoAttachmentPublicUrl.trim()
      : "");
  if (publicUrl) {
    return publicUrl;
  }
  const hasStoredReference = Boolean(
    (typeof collectedData.photoAttachmentStorageKey === "string" &&
      collectedData.photoAttachmentStorageKey.trim()) ||
      (typeof collectedData.photoAttachmentStoredFilename === "string" &&
        collectedData.photoAttachmentStoredFilename.trim())
  );
  if (String(collectedData.photoStatus || "").trim().toLowerCase() !== "provided" || !hasStoredReference) {
    return "";
  }
  return `/api/funcionario/procedures/requests/${encodeURIComponent(procedureRequestId)}/photo`;
}

function formatAttachmentForDisplay(rawAttachment, options = {}) {
  const fallbackLabel =
    typeof options.labelFallback === "string" ? options.labelFallback.trim() : "";
  const explicitPreviewUrl =
    typeof options.previewUrl === "string" ? options.previewUrl.trim() : "";
  const normalized = normalizeImageReference(rawAttachment);
  const resolvedPreviewUrl = explicitPreviewUrl || normalized.url || "";
  const hasAnyAttachmentReference = Boolean(rawAttachment || fallbackLabel);
  let previewReason = "no_image_reference";
  if (hasAnyAttachmentReference) {
    if (resolvedPreviewUrl) {
      previewReason = "preview_ready";
    } else if (!normalized.isValid && !fallbackLabel) {
      previewReason = "unsupported_or_unresolved";
    } else {
      previewReason = "filename_without_public_url";
    }
  }
  return {
    isValid: normalized.isValid || Boolean(resolvedPreviewUrl),
    url: resolvedPreviewUrl || null,
    label: normalized.displayName || fallbackLabel || "",
    previewReason,
  };
}

function buildImagePreviewReasonText(previewReason) {
  if (previewReason === "filename_without_public_url") {
    return "Imagen registrada, pero no hay URL pública disponible para previsualizar.";
  }
  if (previewReason === "unsupported_or_unresolved") {
    return "Referencia de imagen no compatible para vista previa.";
  }
  if (previewReason === "preview_ready") {
    return "Vista previa disponible.";
  }
  return "No se adjuntó imagen.";
}

function buildLocationSearchUrl(value) {
  const rawQuery = String(value || "").trim();
  const query = rawQuery
    // Remove UI/system prefixes that are useful for chat history but noisy for map search.
    .replace(/^ubicaci[oó]n\s+confirmada\s*[·:|-]\s*/i, "")
    .replace(/^location\s+confirmed\s*[·:|-]\s*/i, "")
    .replace(/^localiza[cç][aã]o\s+confirmada\s*[·:|-]\s*/i, "")
    .trim();
  if (!query) {
    return "";
  }
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
}

function buildOpenStreetMapLinkFromCoordinates(coordinates) {
  const lat = Number(coordinates?.lat);
  const lng = Number(coordinates?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(
    lng
  )}#map=17/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
}

function resolvePrimaryDescription(procedureRequest, collectedData) {
  const candidates = [
    collectedData?.description,
    collectedData?.detail,
    collectedData?.details,
    collectedData?.descripcion,
    collectedData?.resumen,
    procedureRequest?.summary,
  ];
  const raw = candidates.find((item) => typeof item === "string" && item.trim()) || "";
  return raw
    .replace(/si está correcto,\s*confirma para continuar\.?/gi, "")
    .replace(/si esta correcto,\s*confirma para continuar\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveContactEmail(procedureRequest, collectedData) {
  const candidates = [
    collectedData?.email,
    collectedData?.contactEmail,
    collectedData?.correo,
    procedureRequest?.userEmail,
  ];
  return candidates.find((item) => typeof item === "string" && item.trim()) || null;
}

function isPendingCamundaSyncStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return key === "PENDING_CAMUNDA_SYNC";
}

function buildFallbackRetryCamundaSyncAction(procedureRequestId, displayLabel) {
  return {
    actionKey: "retry_camunda_sync",
    displayLabel: displayLabel || "Reintentar sincronización",
    endpoint: `/api/funcionario/procedures/requests/${encodeURIComponent(procedureRequestId)}/retry-camunda-sync`,
    method: "POST",
  };
}

function normalizeOperationalAction(action) {
  const normalizedAction = String(action?.action || action?.actionKey || "")
    .trim()
    .toUpperCase();
  const actionKey =
    normalizedAction === "CLAIM_TASK"
      ? "claim_task"
      : normalizedAction === "COMPLETE_TASK"
        ? "complete_task"
        : normalizedAction === "RETRY_CAMUNDA_SYNC"
          ? "retry_camunda_sync"
          : String(action?.actionKey || "").trim().toLowerCase();
  return {
    ...action,
    action: normalizedAction || null,
    actionKey: actionKey || null,
  };
}

function normalizeDetailResponse(payload) {
  const localCase = payload?.localCase || payload?.procedureRequest || null;
  const operationalState = payload?.operationalState || {};
  const rawActiveTask =
    operationalState?.activeTask && operationalState.activeTask.exists ? operationalState.activeTask : null;
  const activeTask = rawActiveTask
    ? {
        id: rawActiveTask.id || rawActiveTask.taskId || null,
        taskId: rawActiveTask.taskId || rawActiveTask.id || null,
        userTaskKey: rawActiveTask.userTaskKey || null,
        taskDefinitionKey: rawActiveTask.taskDefinitionKey || null,
        taskDefinitionName: rawActiveTask.name || null,
        name: rawActiveTask.name || null,
        taskName: rawActiveTask.taskName != null ? String(rawActiveTask.taskName).trim() || null : null,
        label: rawActiveTask.label != null ? String(rawActiveTask.label).trim() || null : null,
        assignee: rawActiveTask.assignee ?? null,
        state: rawActiveTask.state || null,
        createdAt: rawActiveTask.createdAt || null,
      }
    : null;
  const normalizedOperationalActions = Array.isArray(operationalState?.availableActions)
    ? operationalState.availableActions.map(normalizeOperationalAction)
    : Array.isArray(payload?.availableActions)
      ? payload.availableActions.map(normalizeOperationalAction)
      : [];
  return {
    ...payload,
    procedureRequest: localCase,
    operationalState,
    activeTask,
    availableActions: normalizedOperationalActions,
  };
}

/** Pure view-model for expediente detail; keeps SSR/minifier from reordering TDZ-prone const chains in the component. */
function buildFuncionarioExpedientePageViewModel(detail, procedureRequestId, actionLoadingKey, isAdmin, currentUserId) {
  const availableActions = Array.isArray(detail?.availableActions) ? detail.availableActions : [];
  const procedureRequest = detail?.procedureRequest || null;
  const isAvailable = procedureRequest?.assignmentScope === "available";
  const isAssignedToMe = procedureRequest?.assignmentScope === "assigned_to_me";
  const claimAction = availableActions.find((action) => action?.actionKey === "claim_task") || null;
  const retrySyncActionFromApi =
    availableActions.find((action) => action?.actionKey === "retry_camunda_sync") || null;
  const operationalActions = isAvailable
    ? availableActions.filter((action) => action?.actionKey !== "claim_task")
    : availableActions.filter((action) => action?.actionKey !== "retry_camunda_sync");

  const collectedData = procedureRequest?.collectedData || {};
  const fieldDefinitions = getProcedureFieldDefinitions(detail);
  const imageFields = fieldDefinitions.filter((field) => isImageFieldType(field?.type));
  const locationFields = fieldDefinitions.filter((field) => isLocationFieldType(field?.type));
  const imageFieldKey = imageFields[0]?.key || null;
  const locationFieldKey = locationFields[0]?.key || null;
  const hasImageTypeConfigured = fieldDefinitions.some((field) => isImageFieldType(field?.type));
  const hasLocationTypeConfigured = fieldDefinitions.some((field) => isLocationFieldType(field?.type));
  const typedLocation = resolveTypedFieldValueByMatcher(collectedData, fieldDefinitions, isLocationFieldType);
  const typedAttachment = resolveTypedFieldValueByMatcher(collectedData, fieldDefinitions, isImageFieldType);
  const rawAttachment = typedAttachment ?? resolveAttachmentValue(collectedData);
  const attachmentResolvedPreviewUrl = buildProcedurePhotoPreviewUrl(procedureRequestId, collectedData);
  const attachmentDisplay = formatAttachmentForDisplay(rawAttachment, {
    previewUrl: attachmentResolvedPreviewUrl,
    labelFallback:
      String(collectedData?.photoAttachmentOriginalName || "").trim() ||
      String(collectedData?.photoAttachmentStoredFilename || "").trim(),
  });
  const hasAnyImageReference = Boolean(rawAttachment || attachmentResolvedPreviewUrl || attachmentDisplay.label);
  const canPreviewAttachment = Boolean(attachmentDisplay.url && attachmentDisplay.isValid);
  const hasPhotoProvided = String(collectedData?.photoStatus || "").trim().toLowerCase() === "provided";
  const hasPhotoSkipped = ["skipped", "not_requested"].includes(
    String(collectedData?.photoStatus || "").trim().toLowerCase()
  );
  const imagePreviewReason = hasPhotoSkipped
    ? "no_image_reference"
    : attachmentDisplay.previewReason;
  const attachmentSummaryText = hasPhotoSkipped
    ? "No se adjuntó imagen"
    : imagePreviewReason === "preview_ready"
      ? attachmentDisplay.label || "Imagen previsualizable"
      : imagePreviewReason === "filename_without_public_url"
        ? "Imagen registrada, pero no hay URL pública disponible para previsualizar."
        : imagePreviewReason === "unsupported_or_unresolved"
          ? "Referencia de imagen no compatible para vista previa."
          : hasPhotoProvided
            ? "Imagen registrada"
            : "No se adjuntó imagen";
  const rawLocation =
    typedLocation ?? collectedData.location ?? collectedData.address ?? resolveLocationValue(collectedData);
  const locationValue = formatLocationForDisplay(rawLocation);
  const locationCoordinates = extractCoordinatesFromLocationValue(
    rawLocation,
    collectedData,
    procedureRequest?.metadata ?? procedureRequest?.camundaMetadata
  );
  const canPreviewLocationMap = Boolean(locationCoordinates);
  const locationPreviewReason = !rawLocation
    ? "no_location_field_found"
    : canPreviewLocationMap
      ? "coordinates_resolved"
      : "location_text_without_coordinates";
  const locationSearchUrl = buildLocationSearchUrl(locationValue);
  const imageActionLabel = canPreviewAttachment
    ? "Ver imagen"
    : hasAnyImageReference
      ? "Ver datos de imagen"
      : "Sin imagen";
  const locationActionLabel = canPreviewLocationMap
    ? "Ver mapa"
    : locationSearchUrl
      ? "Buscar ubicación"
      : "Ver ubicación registrada";
  const showQuickImageCard = Boolean(hasImageTypeConfigured || hasAnyImageReference || hasPhotoProvided);
  const showQuickLocationCard = Boolean(hasLocationTypeConfigured || rawLocation || locationCoordinates);
  const quickPreviewCards = [
    ...(showQuickImageCard
      ? [
          {
            id: "image",
            title: "Imagen",
            canOpenModal: canPreviewAttachment || Boolean(rawAttachment),
            buttonLabel: "Ampliar",
            placeholderText: buildImagePreviewReasonText(imagePreviewReason),
          },
        ]
      : []),
    ...(showQuickLocationCard
      ? [
          {
            id: "location",
            title: "Ubicación",
            canOpenModal: canPreviewLocationMap || Boolean(locationSearchUrl || locationValue),
            buttonLabel: "Ampliar",
            placeholderText: canPreviewLocationMap
              ? "Ubicación registrada"
              : "Ubicación registrada sin coordenadas para mapa.",
          },
        ]
      : []),
  ];
  const caseDescription = resolvePrimaryDescription(procedureRequest, collectedData);
  const contactEmail = resolveContactEmail(procedureRequest, collectedData);
  const operativeStepLabel = buildOperativeStepLabel(detail?.activeTask);
  const activeTaskDescription = String(detail?.activeTaskDisplay?.description || "").trim();
  const trackingCode = procedureRequest?.requestCode || null;
  const camundaStatusKey = deriveCamundaStatus(procedureRequest, detail);
  const camundaStatusLabel =
    procedureRequest?.camundaStatusLabel || getCamundaStatusLabel(camundaStatusKey);
  const canManageDeletion = Boolean(procedureRequest && (isAssignedToMe || isAdmin));
  const hasActiveTask = Boolean(detail?.activeTask?.taskDefinitionKey);
  const isInitialCamundaSyncPending = Boolean(
    isPendingCamundaSyncStatus(procedureRequest?.status) && !procedureRequest?.camundaProcessInstanceKey
  );
  const requiresCamundaRetry = computeRequiresCamundaRetry({
    procedureRequest,
    camundaStatusKey,
    camundaStatusLabel,
    hasActiveTask,
    isAvailable,
  });
  const retrySyncAction =
    retrySyncActionFromApi ||
    (!isAvailable && (requiresCamundaRetry || isInitialCamundaSyncPending)
      ? buildFallbackRetryCamundaSyncAction(
          procedureRequestId,
          requiresCamundaRetry ? "Reintentar sincronización" : "Sincronizar con Camunda"
        )
      : null);
  const showCamundaSyncAlert = Boolean(
    !isAvailable && retrySyncAction && (requiresCamundaRetry || isInitialCamundaSyncPending)
  );
  const syncPrimaryButtonLabel =
    isInitialCamundaSyncPending && !requiresCamundaRetry
      ? "Sincronizar con Camunda"
      : "Reintentar sincronización con Camunda";
  const syncSecondaryButtonLabel =
    isInitialCamundaSyncPending && !requiresCamundaRetry
      ? "Sincronizar con Camunda"
      : "Reintentar sincronización";
  const retrySyncLoadingKey = retrySyncAction
    ? `${retrySyncAction.actionKey || "action"}:${retrySyncAction.endpoint}`
    : "";
  const isRetrySyncLoading = Boolean(retrySyncLoadingKey && actionLoadingKey === retrySyncLoadingKey);
  const operationalSituation = buildOperationalSituation({
    procedureRequest,
    camundaStatusKey,
    hasActiveTask,
    requiresCamundaRetry,
    isInitialCamundaSyncPending,
  });
  const inboxBandejaRelationLabel = buildInboxRelationLabelFromOwner(
    procedureRequest?.assignedToUserId,
    currentUserId
  );
  const camundaAssigneeResponsibilityLabel = buildCamundaAssigneeResponsibilityLabel(
    detail?.activeTask?.assignee,
    currentUserId
  );
  const processStateUpper = String(detail?.operationalState?.process?.state || "").trim();
  const functionalWorkflowStateLabel = buildFunctionalWorkflowStateLabel({
    hasActiveTask,
    activeTask: detail?.activeTask,
    processStateUpper,
    camundaStatusKey,
  });
  const camundaTaskStateDisplay = hasActiveTask
    ? String(detail?.activeTask?.state || "").trim() || "—"
    : "—";
  const camundaTaskAssigneeCamundaLabel = !hasActiveTask
    ? "—"
    : detail?.activeTask?.assignee != null && String(detail.activeTask.assignee).trim()
      ? String(detail.activeTask.assignee).trim()
      : "Sin asignar";
  const camundaLiveProcessInstanceKey =
    detail?.operationalState?.process?.instanceKey != null &&
    String(detail.operationalState.process.instanceKey).trim()
      ? String(detail.operationalState.process.instanceKey).trim()
      : null;
  const camundaProcessStateDisplay = String(detail?.operationalState?.process?.state || "").trim() || "—";
  const operationalErrors = Array.isArray(detail?.operationalState?.errors)
    ? detail.operationalState.errors
    : [];
  const { blockingErrors, benignActiveTaskMiss } = splitOperationalErrors(operationalErrors);
  const primaryOperationalError = blockingErrors[0] || null;
  const showActiveTaskApiMissBanner = Boolean(
    benignActiveTaskMiss.length > 0 &&
      !showCamundaSyncAlert &&
      Boolean(procedureRequest?.camundaProcessInstanceKey)
  );

  return {
    procedureRequest,
    isAvailable,
    claimAction,
    operationalActions,
    collectedData,
    fieldDefinitions,
    imageFields,
    locationFields,
    imageFieldKey,
    locationFieldKey,
    rawAttachment,
    rawLocation,
    attachmentDisplay,
    attachmentResolvedPreviewUrl,
    hasAnyImageReference,
    imagePreviewReason,
    attachmentSummaryText,
    locationValue,
    locationCoordinates,
    locationPreviewReason,
    locationSearchUrl,
    imageActionLabel,
    locationActionLabel,
    canPreviewAttachment,
    canPreviewLocationMap,
    showQuickImageCard,
    showQuickLocationCard,
    quickPreviewCards,
    caseDescription,
    contactEmail,
    activeTaskDescription,
    trackingCode,
    canManageDeletion,
    showCamundaSyncAlert,
    syncPrimaryButtonLabel,
    syncSecondaryButtonLabel,
    isRetrySyncLoading,
    operationalSituation,
    operativeStepLabel,
    functionalWorkflowStateLabel,
    camundaAssigneeResponsibilityLabel,
    inboxBandejaRelationLabel,
    camundaLiveProcessInstanceKey,
    camundaProcessStateDisplay,
    retrySyncAction,
    operationalErrors,
    primaryOperationalError,
    showActiveTaskApiMissBanner,
    activeTaskApiMissMessage: ACTIVE_TASK_API_MISS_USER_MESSAGE,
    camundaTaskStateDisplay,
    camundaTaskAssigneeCamundaLabel,
  };
}

function BackToBandejaLink() {
  return (
    <p className="small" style={{ marginTop: "1rem" }}>
      <Link href="/funcionario/dashboard" className="button-inline">
        Volver a la bandeja
      </Link>
    </p>
  );
}

function CaseQuickPreviewModal({
  previewState,
  imageLoadError,
  mapRenderError,
  onImageLoadError,
  onMapRenderError,
  onClose,
}) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!previewState?.isOpen) {
      return undefined;
    }
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, previewState?.isOpen]);

  useEffect(() => {
    if (!previewState?.isOpen || !closeButtonRef.current) {
      return;
    }
    closeButtonRef.current.focus();
  }, [previewState?.isOpen]);

  useEffect(() => {
    if (!previewState?.isOpen || typeof document === "undefined") {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [previewState?.isOpen]);

  if (!previewState?.isOpen || typeof document === "undefined") {
    return null;
  }

  const isImagePreview = previewState.type === "image";
  const isMapPreview = previewState.type === "map" && Boolean(previewState.coordinates);
  const isCompactInfoDialog = !isImagePreview && !isMapPreview;
  const panelModeClass = isCompactInfoDialog
    ? "expediente-preview-modal__panel--compact"
    : "expediente-preview-modal__panel--media";
  const mapLink = buildOpenStreetMapLinkFromCoordinates(previewState.coordinates);

  return createPortal(
    <div
      className="admin-roles-confirm-dialog expediente-preview-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="expediente-preview-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className={`admin-roles-confirm-dialog__panel expediente-preview-modal__panel ${panelModeClass}`}>
        <header className="admin-roles-confirm-dialog__header expediente-preview-modal__header">
          <div className="expediente-preview-modal__heading">
            <h2 id="expediente-preview-modal-title" className="admin-roles-confirm-dialog__title">
              {previewState.title}
            </h2>
            <p className="expediente-preview-modal__subtitle">
              {isImagePreview
                ? "Vista previa de la imagen registrada."
                : isMapPreview
                  ? "Ubicación georreferenciada del expediente."
                  : "Información registrada en el expediente."}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="expediente-preview-modal__close"
            onClick={onClose}
            aria-label="Cerrar diálogo de vista rápida"
          >
            ×
          </button>
        </header>
        <div className="expediente-preview-modal__content">
          {previewState.type === "image" ? (
            previewState.imageUrl && !imageLoadError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewState.imageUrl}
                alt={previewState.imageAlt || "Imagen adjunta del expediente"}
                className="expediente-preview-modal__image"
                onError={() => {
                  onImageLoadError();
                  if (IS_DEVELOPMENT) {
                    console.warn("[quick-preview:image] image load error", {
                      src: previewState.imageUrl,
                      fieldKey: previewState.imageFieldKey || null,
                      value: previewState.imageReference,
                    });
                  }
                }}
              />
            ) : (
              <div className="expediente-preview-modal__info">
                <p className="small">No se pudo cargar la imagen.</p>
                {previewState.imageReference ? (
                  <dl className="expediente-preview-modal__meta">
                    <dt>Referencia</dt>
                    <dd className="admin-procedure-table__mono">{previewState.imageReference}</dd>
                  </dl>
                ) : null}
              </div>
            )
          ) : previewState.type === "image_info" ? (
            <div className="expediente-preview-modal__info">
              <p className="small">Imagen registrada, pero no hay URL pública disponible para previsualizar.</p>
              {previewState.imageReference ? (
                <dl className="expediente-preview-modal__meta">
                  <dt>Archivo</dt>
                  <dd className="admin-procedure-table__mono">{previewState.imageReference}</dd>
                </dl>
              ) : null}
            </div>
          ) : previewState.type === "map" ? (
            previewState.coordinates ? (
              mapRenderError ? (
                <div className="expediente-preview-modal__info">
                  <p className="small">No se pudo renderizar el mapa con las coordenadas disponibles.</p>
                </div>
              ) : (
                <div className="expediente-preview-modal__map">
                  <MapRenderErrorBoundary
                    resetKey={`${previewState.coordinates.lat}-${previewState.coordinates.lng}`}
                    fallback={<p className="small">No se pudo renderizar el mapa con las coordenadas disponibles.</p>}
                    onError={onMapRenderError}
                  >
                    <LocationMapPreview
                      latitude={previewState.coordinates.lat}
                      longitude={previewState.coordinates.lng}
                      ariaLabel={previewState.mapAriaLabel || "Vista ampliada de ubicación del expediente"}
                    />
                  </MapRenderErrorBoundary>
                </div>
              )
            ) : (
              <div className="expediente-preview-modal__info">
                <p className="small">No hay coordenadas suficientes para mostrar el mapa.</p>
              </div>
            )
          ) : previewState.type === "location_text" ? (
            <div className="expediente-preview-modal__info">
              <p className="small">Ubicación registrada sin coordenadas para mapa.</p>
              {previewState.locationText ? (
                <dl className="expediente-preview-modal__meta">
                  <dt>Ubicación</dt>
                  <dd>{previewState.locationText}</dd>
                </dl>
              ) : null}
            </div>
          ) : null}
          {isMapPreview && previewState.coordinates ? (
            <dl className="expediente-preview-modal__meta">
              <dt>Coordenadas</dt>
              <dd className="admin-procedure-table__mono">
                {Number(previewState.coordinates.lat).toFixed(6)}, {Number(previewState.coordinates.lng).toFixed(6)}
              </dd>
            </dl>
          ) : null}
          {previewState.type === "map" && mapRenderError && IS_DEVELOPMENT ? (
            <p className="small">
              <span className="admin-procedure-table__mono">[quick-preview:location] map render error</span>
            </p>
          ) : null}
          {previewState.type === "image_info" && IS_DEVELOPMENT ? (
            <p className="small">
              <span className="admin-procedure-table__mono">
                [quick-preview:image] filename found but public URL missing
              </span>
            </p>
          ) : null}
        </div>
        <footer className="expediente-preview-modal__actions">
          {isImagePreview && previewState.imageUrl ? (
            <a
              href={previewState.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="button-inline expediente-preview-modal__action-link"
            >
              Abrir en nueva pestaña
            </a>
          ) : null}
          {isMapPreview && mapLink ? (
            <a href={mapLink} target="_blank" rel="noreferrer" className="button-inline expediente-preview-modal__action-link">
              Abrir en OpenStreetMap
            </a>
          ) : null}
          {!isMapPreview && previewState.locationSearchUrl ? (
            <a
              href={previewState.locationSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="button-inline expediente-preview-modal__action-link"
            >
              Buscar ubicación
            </a>
          ) : null}
          <button type="button" className="button-inline button-inline--compact expediente-preview-modal__action-close" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

export default function FuncionarioExpedienteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const rawParamId = params?.id;
  const procedureRequestId =
    typeof rawParamId === "string"
      ? rawParamId
      : Array.isArray(rawParamId) && rawParamId[0]
        ? String(rawParamId[0])
        : "";
  const { user, isLoadingAuth } = useAuth();
  const { locale } = useLocale();

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [flowSummary, setFlowSummary] = useState(null);
  const [flowSummaryError, setFlowSummaryError] = useState(null);
  const [fatalError, setFatalError] = useState(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoadingKey, setActionLoadingKey] = useState("");
  const [completeVariablesJson, setCompleteVariablesJson] = useState("{}");
  const [internalObservation, setInternalObservation] = useState("");
  const [nextStatus, setNextStatus] = useState("");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteTechnicalDetail, setDeleteTechnicalDetail] = useState("");
  const [quickPreviewModal, setQuickPreviewModal] = useState({
    isOpen: false,
    type: null,
    title: "",
    imageUrl: "",
    imageAlt: "",
    coordinates: null,
    mapAriaLabel: "",
    imageReference: "",
    imageFieldKey: "",
    locationText: "",
    locationSearchUrl: "",
  });
  const [quickImageLoadError, setQuickImageLoadError] = useState(false);
  const [quickModalImageLoadError, setQuickModalImageLoadError] = useState(false);
  const [quickMapRenderError, setQuickMapRenderError] = useState(false);
  const [quickModalMapRenderError, setQuickModalMapRenderError] = useState(false);
  const quickPreviewTriggerRef = useRef(null);

  const isFuncionario = hasRole(user, "agente");
  const isAdmin = hasRole(user, "administrador");
  const isBackofficeManager = isFuncionario || isAdmin;

  useEffect(() => {
    if (isLoadingAuth) {
      return;
    }
    if (!user || !isBackofficeManager) {
      router.replace("/");
    }
  }, [isBackofficeManager, isLoadingAuth, router, user]);

  const loadDetail = useCallback(async (requestId) => {
    if (!requestId) {
      setDetail(null);
      setDetailLoading(false);
      setFatalError({ message: "No se encontró el expediente solicitado." });
      return;
    }
    setDetailLoading(true);
    setFatalError(null);
    setActionError("");
    setSuccessMessage("");
    setDeleteTechnicalDetail("");
    setFlowSummaryError(null);
    try {
      const base = `/api/funcionario/procedures/requests/${encodeURIComponent(requestId)}`;
      const [response, summaryResponse] = await Promise.all([
        fetch(base, { cache: "no-store" }),
        fetch(`${base}/process-flow-summary`, { cache: "no-store" }),
      ]);
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404) {
          setFatalError({ message: "No se encontró el expediente solicitado." });
        } else if (response.status === 403) {
          setFatalError({
            message:
              "No tienes permisos para ver este expediente o no está asignado a tu bandeja.",
          });
        } else {
          setFatalError({ message: data?.error || "No se pudo cargar el detalle del expediente." });
        }
        setDetail(null);
        setFlowSummary(null);
        setFlowSummaryError(null);
        return;
      }
      setDetail(normalizeDetailResponse(data));
      setCompleteVariablesJson("{}");
      setInternalObservation("");
      setNextStatus("");
      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        setFlowSummary(summaryData && typeof summaryData === "object" ? summaryData : null);
        setFlowSummaryError(null);
      } else {
        setFlowSummary(null);
        let msg = "No se pudo cargar el resumen del flujo.";
        try {
          const errBody = await summaryResponse.json();
          if (errBody?.error) {
            msg = String(errBody.error);
          }
        } catch {
          /* ignore */
        }
        setFlowSummaryError(msg);
      }
    } catch (_error) {
      setFatalError({ message: "No se pudo cargar el detalle del expediente." });
      setDetail(null);
      setFlowSummary(null);
      setFlowSummaryError(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoadingAuth || !user || !isBackofficeManager || !procedureRequestId) {
      return;
    }
    loadDetail(procedureRequestId);
  }, [isBackofficeManager, isLoadingAuth, loadDetail, procedureRequestId, user]);

  const expedienteViewModel = useMemo(
    () =>
      buildFuncionarioExpedientePageViewModel(
        detail,
        procedureRequestId,
        actionLoadingKey,
        isAdmin,
        user?.id
      ),
    [actionLoadingKey, detail, isAdmin, procedureRequestId, user?.id]
  );

  const runAction = async (action) => {
    if (!action?.endpoint || !procedureRequestId) {
      return;
    }
    const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
    setActionLoadingKey(actionKey);
    setActionError("");
    setSuccessMessage("");
    try {
      let body = undefined;
      if (action.actionKey === "complete_task") {
        const parsedVariables = parseJsonInput(completeVariablesJson, {});
        if (parsedVariables === null || typeof parsedVariables !== "object") {
          throw new Error("El JSON de variables no es válido.");
        }
        const observation = String(internalObservation || "").trim();
        const mergedVariables = { ...parsedVariables };
        if (observation) {
          mergedVariables.__internalObservation = observation;
        }
        body = {
          collectedData: mergedVariables,
          nextStatus: String(nextStatus || "").trim() || undefined,
          expectedTaskDefinitionKey: action.expectedTaskDefinitionKey || undefined,
          idempotencyKey: `backoffice-${Date.now()}`,
        };
      }
      const response = await fetch(action.endpoint, {
        method: action.method || "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) {
        let message = data?.error || "No se pudo ejecutar la acción.";
        if (action.actionKey === "claim_task" && response.status === 409) {
          message = "Este expediente ya fue tomado por otro funcionario.";
          setFatalError({ message });
          setDetail(null);
          return;
        }
        if (action.actionKey === "retry_camunda_sync") {
          message = data?.error || "No se pudo sincronizar con Camunda. Intenta nuevamente.";
        }
        throw new Error(message);
      }
      if (action.actionKey === "claim_task") {
        setSuccessMessage("Expediente tomado correctamente.");
      } else if (action.actionKey === "retry_camunda_sync") {
        setSuccessMessage("Sincronización solicitada correctamente.");
      } else {
        setSuccessMessage("Acción ejecutada correctamente.");
      }
      setFatalError(null);
      await loadDetail(procedureRequestId);
    } catch (requestError) {
      setActionError(requestError.message || "No se pudo ejecutar la acción.");
    } finally {
      setActionLoadingKey("");
    }
  };

  const {
    procedureRequest,
    isAvailable,
    claimAction,
    operationalActions,
    collectedData,
    fieldDefinitions,
    imageFields,
    locationFields,
    imageFieldKey,
    locationFieldKey,
    rawAttachment,
    rawLocation,
    attachmentDisplay,
    attachmentResolvedPreviewUrl,
    hasAnyImageReference,
    imagePreviewReason,
    attachmentSummaryText,
    locationValue,
    locationCoordinates,
    locationPreviewReason,
    locationSearchUrl,
    canPreviewAttachment,
    canPreviewLocationMap,
    showQuickImageCard,
    showQuickLocationCard,
    caseDescription,
    contactEmail,
    activeTaskDescription,
    trackingCode,
    canManageDeletion,
    showCamundaSyncAlert,
    syncPrimaryButtonLabel,
    isRetrySyncLoading,
    operationalSituation,
    operativeStepLabel,
    functionalWorkflowStateLabel,
    camundaAssigneeResponsibilityLabel,
    camundaLiveProcessInstanceKey,
    camundaProcessStateDisplay,
    retrySyncAction,
    operationalErrors,
    primaryOperationalError,
    showActiveTaskApiMissBanner,
    activeTaskApiMissMessage,
    camundaTaskStateDisplay,
    camundaTaskAssigneeCamundaLabel,
  } = expedienteViewModel;

  const actionCardBadge = useMemo(
    () => resolveActionCardBadge({ isAvailable, functionalWorkflowStateLabel }),
    [functionalWorkflowStateLabel, isAvailable]
  );

  const expedienteActionLayout = useMemo(() => {
    const scope = procedureRequest?.assignmentScope;
    const assignedToMe = scope === "assigned_to_me";
    const actionUi = deriveFuncionarioExpedienteActionUi({
      showCamundaSyncAlert,
      assignmentScope: scope,
      isAvailable,
      isAssignedToMe: assignedToMe,
      isAdmin,
      currentUserId: user?.id,
      activeTask: detail?.activeTask,
      operationalActions,
      claimAction,
      procedureRequest,
      detail,
    });
    return {
      mode: actionUi.mode,
      siguienteAccionLabel: actionUi.siguienteAccionLabel,
      wideCompleteAction: actionUi.completeActionForWide,
      railOperationalActions: actionUi.railOperationalActions,
      showClaimExpediente: actionUi.showClaimExpediente,
      blockingMessage: actionUi.blockingMessage,
    };
  }, [
    claimAction,
    detail,
    isAdmin,
    isAvailable,
    operationalActions,
    procedureRequest,
    showCamundaSyncAlert,
    user?.id,
  ]);

  const actionLead = useMemo(() => {
    const mode = expedienteActionLayout.mode;
    if (mode === "process_finished") {
      return "El trámite ya completó su flujo en el motor de procesos. Solo resta consulta o archivo según corresponda.";
    }
    if (mode === "blocked_other_assignee" || mode === "blocked_other_inbox") {
      return "La gestión depende del funcionario asignado o de la liberación de la tarea activa.";
    }
    if (mode === "take_camunda_task") {
      return "La tarea del proceso está pendiente de responsable: tomala para continuar.";
    }
    if (isAvailable) {
      return "Este expediente está en la bandeja general: tomalo para empezar a gestionarlo desde tu espacio.";
    }
    if (showCamundaSyncAlert) {
      return "Antes de avanzar con tareas, sincronizá el expediente con el motor de procesos.";
    }
    if (primaryOperationalError) {
      return "Hay un inconveniente operativo. Revisá el mensaje y, si corresponde, contactá a sistemas.";
    }
    if (expedienteActionLayout.wideCompleteAction) {
      return "Completá el formulario debajo de «Seguimiento del trámite» y confirmá con el botón al pie.";
    }
    return "Seguí las acciones disponibles y completá los datos solicitados para avanzar el trámite.";
  }, [
    expedienteActionLayout.mode,
    expedienteActionLayout.wideCompleteAction,
    isAvailable,
    primaryOperationalError,
    showCamundaSyncAlert,
  ]);

  useEffect(() => {
    if (!IS_DEVELOPMENT || !procedureRequestId) {
      return;
    }
    console.groupCollapsed("[FuncionarioExpedienteDetail] quick preview diagnostics");
    console.log("requestId", procedureRequestId);
    console.log("fieldDefinitions", fieldDefinitions);
    console.log("caseData", collectedData);
    console.log("imageFields", imageFields);
    console.log("locationFields", locationFields);
    console.log("resolvedImagePreview", {
      rawAttachment,
      imageFieldKey,
      attachmentResolvedPreviewUrl,
      display: attachmentDisplay,
      hasAnyImageReference,
      canPreviewAttachment,
    });
    console.log("resolvedLocationPreview", {
      rawLocation,
      locationFieldKey,
      locationValue,
      locationCoordinates,
      canPreviewLocationMap,
      locationSearchUrl,
    });
    console.log("imagePreviewReason", imagePreviewReason);
    console.log("locationPreviewReason", locationPreviewReason);
    console.groupEnd();
  }, [
    attachmentDisplay,
    canPreviewAttachment,
    canPreviewLocationMap,
    hasAnyImageReference,
    collectedData,
    fieldDefinitions,
    imageFields,
    imageFieldKey,
    imagePreviewReason,
    attachmentResolvedPreviewUrl,
    locationCoordinates,
    locationFields,
    locationPreviewReason,
    locationFieldKey,
    locationSearchUrl,
    locationValue,
    procedureRequestId,
    rawAttachment,
    rawLocation,
  ]);

  useEffect(() => {
    if (!IS_DEVELOPMENT) {
      return;
    }
    if (!rawAttachment) {
      console.warn("[quick-preview:image] no image field found");
      return;
    }
    if (imagePreviewReason === "filename_without_public_url") {
      console.warn("[quick-preview:image] filename found but public URL missing", {
        rawAttachment,
        fieldKey: imageFieldKey,
        displayName: attachmentDisplay.label,
      });
      return;
    }
    if (imagePreviewReason === "unsupported_or_unresolved") {
      console.warn("[quick-preview:image] unsupported or unresolved image reference", {
        rawAttachment,
        fieldKey: imageFieldKey,
      });
      return;
    }
    if (!canPreviewAttachment) {
      console.warn("[quick-preview:image] image reference exists but no public URL could be resolved", {
        rawAttachment,
        fieldKey: imageFieldKey,
      });
    }
  }, [attachmentDisplay.label, canPreviewAttachment, imageFieldKey, imagePreviewReason, rawAttachment]);

  useEffect(() => {
    if (!IS_DEVELOPMENT) {
      return;
    }
    if (!rawLocation) {
      console.warn("[quick-preview:location] no location field found");
      return;
    }
    if (locationCoordinates) {
      console.log("[quick-preview:location] coordinates resolved", locationCoordinates);
      return;
    }
    console.warn("[quick-preview:location] location text found but coordinates missing", {
      rawLocation,
      locationValue,
    });
    console.warn("[quick-preview:location] map render skipped because coordinates are missing");
  }, [locationCoordinates, locationValue, rawLocation]);

  useEffect(() => {
    if (!IS_DEVELOPMENT || !quickPreviewModal?.isOpen) {
      return;
    }
    if (quickPreviewModal.type === "image" && !quickPreviewModal.imageUrl) {
      console.warn("[quick-preview:image] modal opened with incomplete image data", quickPreviewModal);
    }
    if (quickPreviewModal.type === "map" && !quickPreviewModal.coordinates) {
      console.warn("[quick-preview:location] modal opened with incomplete map data", quickPreviewModal);
    }
  }, [quickPreviewModal]);

  useEffect(() => {
    setQuickImageLoadError(false);
  }, [attachmentDisplay.url]);

  useEffect(() => {
    setQuickMapRenderError(false);
  }, [locationCoordinates?.lat, locationCoordinates?.lng]);

  useEffect(() => {
    if (!quickPreviewModal?.isOpen) {
      setQuickModalImageLoadError(false);
      setQuickModalMapRenderError(false);
    }
  }, [quickPreviewModal?.isOpen]);

  const handleRetryCamundaSync = () => {
    if (!retrySyncAction || isRetrySyncLoading) {
      return;
    }
    void runAction(retrySyncAction);
  };

  const handleQuickMapRenderError = useCallback((error) => {
    setQuickMapRenderError(true);
    if (IS_DEVELOPMENT) {
      console.warn("[quick-preview:location] map render error", error);
    }
  }, []);

  const handleQuickModalMapRenderError = useCallback((error) => {
    setQuickModalMapRenderError(true);
    if (IS_DEVELOPMENT) {
      console.warn("[quick-preview:location] map render error", error);
    }
  }, []);

  const openQuickPreview = (event, previewType) => {
    if (event?.currentTarget instanceof HTMLElement) {
      quickPreviewTriggerRef.current = event.currentTarget;
    } else {
      quickPreviewTriggerRef.current = null;
    }
    if (previewType === "image") {
      if (!hasAnyImageReference) {
        return;
      }
      const modalType = canPreviewAttachment && attachmentDisplay.url ? "image" : "image_info";
      setQuickPreviewModal({
        isOpen: true,
        type: modalType,
        title: "Imagen adjunta",
        imageUrl: attachmentDisplay.url || "",
        imageAlt: attachmentSummaryText || "Imagen adjunta del expediente",
        coordinates: null,
        mapAriaLabel: "",
        imageReference: attachmentDisplay.label || String(rawAttachment || "").trim(),
        imageFieldKey: imageFieldKey || "",
        locationText: "",
        locationSearchUrl: "",
      });
      return;
    }
    if (previewType === "location") {
      if (!locationValue && !locationSearchUrl && !locationCoordinates) {
        return;
      }
      const modalType = canPreviewLocationMap && locationCoordinates ? "map" : "location_text";
      setQuickPreviewModal({
        isOpen: true,
        type: modalType,
        title: modalType === "map" ? "Ubicación en mapa" : "Ubicación registrada",
        imageUrl: "",
        imageAlt: "",
        coordinates: locationCoordinates,
        mapAriaLabel: locationValue || "Vista de ubicación registrada",
        imageReference: "",
        imageFieldKey: "",
        locationText: locationValue || "",
        locationSearchUrl: locationSearchUrl || "",
      });
    }
  };

  const closeQuickPreview = useCallback(() => {
    setQuickPreviewModal({
      isOpen: false,
      type: null,
      title: "",
      imageUrl: "",
      imageAlt: "",
      coordinates: null,
      mapAriaLabel: "",
      imageReference: "",
      imageFieldKey: "",
      locationText: "",
      locationSearchUrl: "",
    });
    if (quickPreviewTriggerRef.current instanceof HTMLElement) {
      quickPreviewTriggerRef.current.focus();
    }
  }, []);

  const handleDeleteExpediente = async () => {
    if (!procedureRequest?.id || deleteLoading) {
      return;
    }
    setDeleteLoading(true);
    setActionError("");
    setSuccessMessage("");
    setDeleteTechnicalDetail("");
    try {
      const response = await fetch(`/api/funcionario/expedientes/${encodeURIComponent(procedureRequest.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          response.status === 409 && String(data?.error || "").toLowerCase().includes("camunda")
            ? "No se pudo eliminar la instancia en Camunda. El expediente no fue eliminado."
            : data?.error || "No se pudo eliminar el expediente.";
        setActionError(message);
        if (data?.technicalDetails) {
          setDeleteTechnicalDetail(stringifyJson(data.technicalDetails));
        }
        return;
      }
      setSuccessMessage("Expediente eliminado correctamente.");
      setIsDeleteConfirmOpen(false);
      router.push("/funcionario/dashboard");
    } catch (error) {
      setActionError("No se pudo eliminar el expediente.");
      setDeleteTechnicalDetail(stringifyJson({ message: error?.message || "network_error" }));
    } finally {
      setDeleteLoading(false);
    }
  };

  const quickImageSlot = showQuickImageCard ? (
    <article className="expediente-summary-card">
      <p className="small expediente-summary-card__title">Imagen</p>
      {canPreviewAttachment && attachmentDisplay.url && !quickImageLoadError ? (
        <button
          type="button"
          className="expediente-summary-card__preview-button"
          onClick={(event) => openQuickPreview(event, "image")}
          aria-label="Ver imagen adjunta ampliada"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentDisplay.url}
            alt={attachmentSummaryText || "Imagen adjunta"}
            className="expediente-summary-card__image"
            onError={() => {
              setQuickImageLoadError(true);
              if (IS_DEVELOPMENT) {
                console.warn("[quick-preview:image] image load error", {
                  src: attachmentDisplay.url,
                  fieldKey: imageFieldKey,
                  value: rawAttachment,
                });
              }
            }}
          />
        </button>
      ) : (
        <div className="expediente-summary-card__placeholder">
          <p className="small">
            {quickImageLoadError
              ? "No se pudo cargar la imagen"
              : buildImagePreviewReasonText(imagePreviewReason)}
          </p>
          {attachmentDisplay.label ? (
            <p className="small">
              <span className="admin-procedure-table__mono">{attachmentDisplay.label}</span>
            </p>
          ) : null}
        </div>
      )}
      <button
        type="button"
        className="button-inline button-inline--compact"
        onClick={(event) => openQuickPreview(event, "image")}
        disabled={!hasAnyImageReference}
      >
        {canPreviewAttachment ? "Ver imagen" : "Ver datos"}
      </button>
    </article>
  ) : null;

  const quickLocationSlot = showQuickLocationCard ? (
    <article className="expediente-summary-card">
      <p className="small expediente-summary-card__title">Ubicación</p>
      {canPreviewLocationMap && locationCoordinates && !quickMapRenderError ? (
        <button
          type="button"
          className="expediente-summary-card__preview-button"
          onClick={(event) => openQuickPreview(event, "location")}
          aria-label="Ver mapa ampliado de ubicación"
        >
          <MapRenderErrorBoundary
            resetKey={`${locationCoordinates.lat}-${locationCoordinates.lng}`}
            fallback={<p className="small">No se pudo renderizar el mapa.</p>}
            onError={handleQuickMapRenderError}
          >
            <LocationMapPreview
              latitude={locationCoordinates.lat}
              longitude={locationCoordinates.lng}
              ariaLabel={locationValue || "Vista rápida de ubicación"}
            />
          </MapRenderErrorBoundary>
        </button>
      ) : (
        <div className="expediente-summary-card__placeholder">
          <p className="small">
            {quickMapRenderError
              ? "No se pudo renderizar el mapa con las coordenadas disponibles."
              : "Ubicación registrada sin coordenadas para mapa."}
          </p>
        </div>
      )}
      <button
        type="button"
        className="button-inline button-inline--compact"
        onClick={(event) => openQuickPreview(event, "location")}
        disabled={!canPreviewLocationMap && !locationSearchUrl && !locationValue}
      >
        {canPreviewLocationMap ? "Ver mapa" : locationSearchUrl ? "Buscar ubicación" : "Ver datos"}
      </button>
    </article>
  ) : null;

  if (isLoadingAuth) {
    return (
      <main className="page page--dashboard" lang={locale}>
        <section className="card dashboard-header">
          <p className="info-message">Cargando…</p>
        </section>
      </main>
    );
  }

  if (!user || !isBackofficeManager) {
    return null;
  }

  if (fatalError) {
    return (
      <main className="page page--dashboard" lang={locale}>
        <section className="card dashboard-header">
          <div>
            <p className="eyebrow">ÁREA DEL FUNCIONARIO</p>
            <h1>Detalle del expediente</h1>
          </div>
          <p className="small" style={{ marginTop: "0.75rem" }}>
            <Link href="/funcionario/dashboard" className="portal-action-link">
              ← Volver a la bandeja
            </Link>
          </p>
        </section>
        <section className="card dashboard-section">
          <p className="error-message">{fatalError.message}</p>
          <BackToBandejaLink />
        </section>
      </main>
    );
  }

  return (
    <main className="page page--dashboard dashboard-onify funcionario-expediente-detail" lang={locale}>
      {successMessage ? (
        <section className="dashboard-onify-card dashboard-onify-section">
          <p className="info-message">{successMessage}</p>
        </section>
      ) : null}
      {actionError ? (
        <section className="dashboard-onify-card dashboard-onify-section">
          <p className="error-message">{actionError}</p>
        </section>
      ) : null}

      {detailLoading ? (
        <section className="dashboard-onify-card dashboard-onify-section">
          <p className="info-message">Cargando detalle…</p>
        </section>
      ) : null}

      {!detailLoading && procedureRequest ? (
        <>
          <CaseHeader
            trackingCode={trackingCode}
            procedureName={procedureRequest.procedureName || procedureRequest.procedureCode || ""}
            channel={procedureRequest.channel || ""}
            createdAtLabel={formatDateTime(procedureRequest.createdAt, locale)}
            expedienteStatusLabel={getLocalStatusLabel(procedureRequest.status)}
            assignmentLabel={getAssignmentScopeLabel(procedureRequest)}
          />

          <div className="funcionario-expediente-detail__columns dashboard-onify-detail-layout">
            <div className="funcionario-expediente-detail__col-main">
              <CaseSummaryCard
                procedureName={procedureRequest.procedureName || procedureRequest.procedureCode || "—"}
                caseDescription={caseDescription}
                locationValue={locationValue}
                attachmentSummaryText={attachmentSummaryText}
                channel={procedureRequest.channel || "—"}
                createdAtLabel={formatDateTime(procedureRequest.createdAt, locale)}
                quickImageSlot={quickImageSlot}
                quickLocationSlot={quickLocationSlot}
              />
              <CitizenInfoCard
                userId={procedureRequest.userId}
                whatsappPhone={procedureRequest.whatsappPhone}
                email={contactEmail}
              />
              <CaseProgressCard
                procedureRequestId={procedureRequestId}
                summary={flowSummary}
                summaryLoading={detailLoading}
                summaryError={flowSummaryError}
                camundaProcessState={detail?.operationalState?.process?.state || null}
              />
              {expedienteActionLayout.wideCompleteAction ? (
                <CompleteStepWideCard
                  action={expedienteActionLayout.wideCompleteAction}
                  onRunAction={runAction}
                  actionLoadingKey={actionLoadingKey}
                  completeVariablesJson={completeVariablesJson}
                  setCompleteVariablesJson={setCompleteVariablesJson}
                  internalObservation={internalObservation}
                  setInternalObservation={setInternalObservation}
                  nextStatus={nextStatus}
                  setNextStatus={setNextStatus}
                />
              ) : null}
              <CaseRecentActivityCard
                events={detail?.history}
                locale={locale}
                operativeStepLabel={operativeStepLabel}
              />
            </div>
            <aside className="funcionario-expediente-detail__col-rail">
              <CaseTramiteStatusCard
                currentStepLabel={flowSummary?.current?.label || null}
                operativeStepLabel={operativeStepLabel}
                expedienteStatusLabel={getLocalStatusLabel(procedureRequest.status)}
                taskAssigneeLabel={camundaAssigneeResponsibilityLabel}
                bandejaLabel={buildBandejaRelationSimple(procedureRequest)}
                siguienteAccionLabel={expedienteActionLayout.siguienteAccionLabel}
              />
              <CurrentActionCard
                headline={operativeStepLabel}
                leadText={actionLead}
                statusBadgeLabel={actionCardBadge.label}
                statusBadgeTone={actionCardBadge.tone}
                primaryOperationalError={primaryOperationalError}
                showActiveTaskApiMissBanner={showActiveTaskApiMissBanner}
                activeTaskApiMissMessage={activeTaskApiMissMessage}
                showCamundaSyncAlert={showCamundaSyncAlert}
                syncPrimaryButtonLabel={syncPrimaryButtonLabel}
                onRetryCamundaSync={handleRetryCamundaSync}
                isRetrySyncLoading={isRetrySyncLoading}
                isAvailable={isAvailable}
                claimHint={
                  expedienteActionLayout.showClaimExpediente
                    ? "Tomá el expediente para asignarlo a tu bandeja y habilitar las tareas del proceso."
                    : null
                }
                claimAction={claimAction}
                operationalActions={expedienteActionLayout.railOperationalActions}
                railBlockMessage={expedienteActionLayout.blockingMessage}
                railFinishedMessage={expedienteActionLayout.mode === "process_finished" ? "Proceso finalizado" : null}
                showExpedienteClaimSection={expedienteActionLayout.showClaimExpediente}
                onRunAction={runAction}
                actionLoadingKey={actionLoadingKey}
                completeVariablesJson={completeVariablesJson}
                setCompleteVariablesJson={setCompleteVariablesJson}
                internalObservation={internalObservation}
                setInternalObservation={setInternalObservation}
                nextStatus={nextStatus}
                setNextStatus={setNextStatus}
                emptyOperationalMessage="No hay acciones disponibles para este expediente en este momento."
              />
            </aside>
          </div>

          <TechnicalInfoAccordion
            extraOperationalErrors={operationalErrors.length > 1 ? operationalErrors.slice(1) : []}
            camundaProcessStateDisplay={camundaProcessStateDisplay}
            camundaTaskStateDisplay={camundaTaskStateDisplay}
            activeTaskId={detail?.activeTask?.id || detail?.activeTask?.taskId}
            taskDefinitionKey={detail?.activeTask?.taskDefinitionKey}
            camundaLiveProcessInstanceKey={camundaLiveProcessInstanceKey}
            camundaTaskAssigneeCamundaLabel={camundaTaskAssigneeCamundaLabel}
            operationalSituation={operationalSituation}
            activeTaskDisplayTitle={detail?.activeTaskDisplay?.title}
            procedureRequestId={procedureRequest.id}
            assignedToUserId={procedureRequest.assignedToUserId}
            collectedDataJson={stringifyJson(collectedData)}
            camundaProcessInstanceKey={procedureRequest.camundaProcessInstanceKey}
            camundaProcessDefinitionId={procedureRequest.camundaProcessDefinitionId}
            camundaError={procedureRequest.camundaError}
            camundaMetadataJson={stringifyJson(procedureRequest.camundaMetadata)}
            historyJson={stringifyJson(detail?.history || [])}
          />

          {canManageDeletion ? (
            <DangerZoneCard onRequestDelete={() => setIsDeleteConfirmOpen(true)} deleteLoading={deleteLoading} />
          ) : null}
        </>
      ) : !detailLoading ? (
        <p className="dashboard-onify-empty">No se pudo mostrar el expediente.</p>
      ) : null}

      {deleteTechnicalDetail ? (
        <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__card--technical">
          <details className="funcionario-expediente-detail__details">
            <summary>Detalle técnico de eliminación</summary>
            <pre className="admin-procedure-table__mono funcionario-expediente-detail__pre">{deleteTechnicalDetail}</pre>
          </details>
        </section>
      ) : null}

      <CaseQuickPreviewModal
        previewState={quickPreviewModal}
        imageLoadError={quickModalImageLoadError}
        mapRenderError={quickModalMapRenderError}
        onImageLoadError={() => setQuickModalImageLoadError(true)}
        onMapRenderError={handleQuickModalMapRenderError}
        onClose={closeQuickPreview}
      />

      {isDeleteConfirmOpen && procedureRequest ? (
        <div
          className="admin-roles-confirm-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-expediente-title"
          onClick={(event) => {
            if (event.target === event.currentTarget && !deleteLoading) {
              setIsDeleteConfirmOpen(false);
            }
          }}
        >
          <section className="admin-roles-confirm-dialog__panel" onClick={(event) => event.stopPropagation()}>
            <header className="admin-roles-confirm-dialog__header">
              <h2 id="delete-expediente-title" className="admin-roles-confirm-dialog__title">
                Confirmar eliminación del expediente
              </h2>
            </header>
            <p className="admin-roles-confirm-dialog__lead">
              Esta acción eliminará el expediente del sistema. Si existe una instancia asociada en Camunda, primero
              se intentará eliminar/cancelar esa instancia. Esta acción no se puede deshacer.
            </p>
            <dl className="admin-roles-confirm-dialog__details">
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Número de expediente</dt>
                <dd>{procedureRequest.requestCode || "-"}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Estado local</dt>
                <dd>{getLocalStatusLabel(procedureRequest.status)}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Instancia Camunda</dt>
                <dd>{procedureRequest.camundaProcessInstanceKey || "-"}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Definición Camunda</dt>
                <dd>{procedureRequest.camundaProcessDefinitionId || "-"}</dd>
              </div>
            </dl>
            <div className="admin-roles-confirm-dialog__actions">
              <button
                type="button"
                className="admin-roles-confirm-dialog__button admin-roles-confirm-dialog__button--ghost"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={deleteLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="admin-roles-confirm-dialog__button"
                onClick={handleDeleteExpediente}
                disabled={deleteLoading}
                style={{ background: "#b91c1c", borderColor: "#b91c1c" }}
              >
                {deleteLoading ? "Eliminando..." : "Sí, eliminar expediente"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

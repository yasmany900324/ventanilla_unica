"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthProvider";
import { useLocale } from "./LocaleProvider";
import { normalizeImageReference } from "../lib/imageReference";

const LocationMapPreview = dynamic(() => import("./LocationMapPreview"), { ssr: false });

const LOCAL_STATUS_LABELS = {
  DRAFT: "Borrador",
  PENDING_CONFIRMATION: "Pendiente de confirmación",
  PENDING_CAMUNDA_SYNC: "Pendiente de sincronización",
  IN_PROGRESS: "En progreso",
  PENDING_BACKOFFICE_ACTION: "Pendiente de revisión",
  WAITING_CITIZEN_INFO: "Esperando información ciudadana",
  ERROR_CAMUNDA_SYNC: "Error de sincronización",
  RESOLVED: "Resuelto",
  REJECTED: "Rechazado",
  CLOSED: "Cerrado",
  ARCHIVED: "Archivado",
};

const CAMUNDA_STATUS_LABELS = {
  ERROR_SYNC: "Error de sincronización",
  TASK_ACTIVE: "Pendiente de revisión",
  SYNC_PENDING: "Pendiente de sincronización",
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

function humanizeTaskKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Sin tarea activa";
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
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
    return "Disponible";
  }
  return "Sin relación";
}

function buildActionTitle(action) {
  if (action?.displayLabel) {
    return action.displayLabel;
  }
  if (action?.actionKey === "claim_task") {
    return "Tomar expediente";
  }
  if (action?.actionKey === "complete_task") {
    return "Completar tarea";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reintentar sincronización";
  }
  return action?.label || "Acción";
}

function buildActionDescription(action) {
  if (typeof action?.description === "string" && action.description.trim()) {
    return action.description.trim();
  }
  if (action?.actionKey === "claim_task") {
    return "Asigna este expediente a tu bandeja para habilitar la gestión y acciones de Camunda.";
  }
  if (action?.actionKey === "retry_camunda_sync") {
    return "Reenvía el expediente a Camunda cuando hubo error de sincronización.";
  }
  if (action?.actionKey === "complete_task") {
    return `Avanza el flujo de Camunda para: ${action.taskDisplayName || "tarea activa"}.`;
  }
  return action?.label || "";
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

function formatAttachmentForDisplay(rawAttachment) {
  const normalized = normalizeImageReference(rawAttachment);
  let previewReason = "no_image_reference";
  if (rawAttachment) {
    if (!normalized.isValid) {
      previewReason = "unsupported_or_unresolved";
    } else if (normalized.url) {
      previewReason = "preview_ready";
    } else {
      previewReason = "filename_without_public_url";
    }
  }
  return {
    isValid: normalized.isValid,
    url: normalized.url,
    label: normalized.displayName || "",
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

function deriveCamundaStatus(procedureRequest, detail) {
  const existing = String(procedureRequest?.camundaStatus || "").trim();
  if (existing) {
    return existing;
  }
  const hasTask = Boolean(detail?.activeTask?.taskDefinitionKey || procedureRequest?.currentTaskDefinitionKey);
  if (procedureRequest?.camundaError) {
    return "ERROR_SYNC";
  }
  if (hasTask) {
    return "TASK_ACTIVE";
  }
  if (procedureRequest?.camundaProcessInstanceKey) {
    const localStatus = String(procedureRequest?.status || "").trim().toUpperCase();
    if (["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"].includes(localStatus)) {
      return "PROCESS_COMPLETED";
    }
    return "PROCESS_RUNNING";
  }
  if (String(procedureRequest?.status || "").trim().toUpperCase() === "PENDING_CAMUNDA_SYNC") {
    return "SYNC_PENDING";
  }
  return "NOT_SYNCED";
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

function isFailedCamundaSyncStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return key === "ERROR_CAMUNDA_SYNC" || key === "CAMUNDA_SYNC_FAILED";
}

const TERMINAL_PROCEDURE_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED", "ARCHIVED"]);

function isTerminalProcedureStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return TERMINAL_PROCEDURE_STATUSES.has(key);
}

function normalizeForSyncHeuristic(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ");
}

function textIndicatesSyncFailure(value) {
  const n = normalizeForSyncHeuristic(value);
  if (!n) {
    return false;
  }
  if (n.includes("error") && (n.includes("sincronizacion") || n.includes("sync"))) {
    return true;
  }
  if (n.includes("sync error") || n.includes("sync_error") || n.includes("camunda sync")) {
    return true;
  }
  if (/\bfailed\b/.test(n) || /\berror\b/.test(n)) {
    if (n.includes("camunda") || n.includes("sync")) {
      return true;
    }
  }
  return false;
}

function camundaStatusIndicatesSyncFailure(camundaStatusKey) {
  const key = String(camundaStatusKey || "").trim().toUpperCase();
  return key === "ERROR_SYNC";
}

function buildOperationalSituation({
  procedureRequest,
  camundaStatusKey,
  hasActiveTask,
  requiresCamundaRetry,
  isInitialCamundaSyncPending,
}) {
  if (requiresCamundaRetry) {
    return "No hay una tarea activa asociada en Camunda. Se recomienda reintentar la sincronización.";
  }
  if (isInitialCamundaSyncPending) {
    return "El expediente está pendiente de sincronización inicial con Camunda.";
  }
  if (hasActiveTask) {
    return "El expediente está sincronizado y cuenta con una tarea operativa activa.";
  }
  if (String(camundaStatusKey || "").trim().toUpperCase() === "PROCESS_RUNNING") {
    return "La instancia de Camunda está activa, pero todavía no se generó una tarea operativa.";
  }
  return "Estado operativo estable sin alertas de sincronización.";
}

function computeRequiresCamundaRetry({
  procedureRequest,
  camundaStatusKey,
  camundaStatusLabel,
  hasActiveTask,
  isAvailable,
}) {
  if (!procedureRequest || isAvailable || isTerminalProcedureStatus(procedureRequest.status)) {
    return false;
  }
  if (procedureRequest?.camundaError) {
    return true;
  }
  if (isFailedCamundaSyncStatus(procedureRequest?.status)) {
    return true;
  }
  if (camundaStatusIndicatesSyncFailure(camundaStatusKey)) {
    return true;
  }
  if (textIndicatesSyncFailure(getLocalStatusLabel(procedureRequest?.status))) {
    return true;
  }
  if (textIndicatesSyncFailure(camundaStatusLabel)) {
    return true;
  }
  if (!hasActiveTask && procedureRequest?.camundaProcessInstanceKey) {
    return false;
  }
  return false;
}

function buildFallbackRetryCamundaSyncAction(procedureRequestId, displayLabel) {
  return {
    actionKey: "retry_camunda_sync",
    displayLabel: displayLabel || "Reintentar sincronización",
    endpoint: `/api/funcionario/procedures/requests/${encodeURIComponent(procedureRequestId)}/retry-camunda-sync`,
    method: "POST",
  };
}

/** Pure view-model for expediente detail; keeps SSR/minifier from reordering TDZ-prone const chains in the component. */
function buildFuncionarioExpedientePageViewModel(detail, procedureRequestId, actionLoadingKey, isAdmin) {
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
  const attachmentDisplay = formatAttachmentForDisplay(rawAttachment);
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
    : rawAttachment
      ? "Ver datos de imagen"
      : "Sin imagen";
  const locationActionLabel = canPreviewLocationMap
    ? "Ver mapa"
    : locationSearchUrl
      ? "Buscar ubicación"
      : "Ver ubicación registrada";
  const showQuickImageCard = Boolean(hasImageTypeConfigured || rawAttachment || hasPhotoProvided);
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
  const activeTaskLabel =
    detail?.activeTaskDisplay?.title ||
    detail?.activeTask?.taskDefinitionName ||
    humanizeTaskKey(detail?.activeTask?.taskDefinitionKey);
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
  const responsibleLabel = procedureRequest?.assignedToUserId
    ? "Funcionario asignado"
    : "Sin funcionario asignado";
  const relationLabel =
    getAssignmentScopeLabel(procedureRequest) === "Sin relación"
      ? "No asignado a mi bandeja"
      : getAssignmentScopeLabel(procedureRequest);
  const activeTaskOperationalLabel =
    activeTaskLabel === "Sin tarea activa" ? "No hay tarea activa disponible" : activeTaskLabel;

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
    responsibleLabel,
    relationLabel,
    activeTaskOperationalLabel,
    retrySyncAction,
  };
}

function ProcedureFieldVariables({ requiredVariables }) {
  if (!Array.isArray(requiredVariables) || requiredVariables.length === 0) {
    return null;
  }
  return (
    <>
      <p className="small">Variables requeridas para esta tarea:</p>
      <ul className="admin-procedure-fields__list">
        {requiredVariables.map((item, index) => (
          <li key={`${item.procedureFieldKey || "field"}-${index}`} className="admin-procedure-fields__item">
            <p className="small">
              <strong>{item.fieldLabel || item.procedureFieldKey}</strong>
            </p>
            <p className="small">
              Variable Camunda: {item.camundaVariableName} ({item.camundaVariableType || "string"})
            </p>
            <p className="small">Obligatoria: {item.required ? "Sí" : "No"}</p>
          </li>
        ))}
      </ul>
    </>
  );
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

function ActionCards({ actions, onRunAction, actionLoadingKey, completeVariablesJson, setCompleteVariablesJson, internalObservation, setInternalObservation, nextStatus, setNextStatus }) {
  if (!actions.length) {
    return null;
  }
  return actions.map((action) => {
    const actionKey = `${action.actionKey || "action"}:${action.endpoint}`;
    const actionTitle = buildActionTitle(action);
    const actionDescription = buildActionDescription(action);
    return (
      <div key={actionKey} className="admin-procedure-fields__item">
        <p className="small">
          <strong>{actionTitle}</strong>
        </p>
        {actionDescription ? <p className="small">{actionDescription}</p> : null}
        {action.actionKey === "complete_task" ? (
          <>
            <label className="small">Variables para avanzar (JSON)</label>
            <textarea
              rows={6}
              value={completeVariablesJson}
              onChange={(event) => setCompleteVariablesJson(event.target.value)}
            />
            <label className="small">Observaciones internas</label>
            <textarea
              rows={3}
              value={internalObservation}
              onChange={(event) => setInternalObservation(event.target.value)}
            />
            <label className="small">Cambio de estado local (opcional)</label>
            <input
              type="text"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value)}
              placeholder="Ej: PENDING_BACKOFFICE_ACTION"
            />
            <ProcedureFieldVariables requiredVariables={action.requiredVariables} />
          </>
        ) : null}
        <button
          type="button"
          className="button-inline"
          onClick={() => onRunAction(action)}
          disabled={actionLoadingKey === actionKey}
        >
          {actionLoadingKey === actionKey ? "Procesando..." : actionTitle}
        </button>
      </div>
    );
  });
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

  const isCompactInfoDialog =
    previewState.type === "image_info" ||
    previewState.type === "location_text" ||
    (previewState.type === "map" && !previewState.coordinates);
  const panelInlineStyle = isCompactInfoDialog
    ? { width: "min(92vw, 520px)", maxWidth: "520px", minHeight: "auto" }
    : undefined;
  const titleInlineStyle = isCompactInfoDialog ? { whiteSpace: "nowrap", marginRight: "0.5rem" } : undefined;

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
      <section
        className="admin-roles-confirm-dialog__panel expediente-preview-modal__panel"
        style={panelInlineStyle}
      >
        <header className="admin-roles-confirm-dialog__header expediente-preview-modal__header">
          <h2
            id="expediente-preview-modal-title"
            className="admin-roles-confirm-dialog__title"
            style={titleInlineStyle}
          >
            {previewState.title}
          </h2>
          {!isCompactInfoDialog ? (
            <button
              ref={closeButtonRef}
              type="button"
              className="button-inline button-inline--compact"
              onClick={onClose}
              style={{ marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              Cerrar
            </button>
          ) : null}
        </header>
        <div
          className="expediente-preview-modal__content"
          style={isCompactInfoDialog ? { minHeight: "auto", paddingBottom: "0.35rem" } : undefined}
        >
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
              <>
                <p className="small">No se pudo cargar la imagen.</p>
                {previewState.imageReference ? (
                  <p className="small">
                    Referencia técnica:{" "}
                    <span className="admin-procedure-table__mono">{previewState.imageReference}</span>
                  </p>
                ) : null}
              </>
            )
          ) : previewState.type === "image_info" ? (
            <>
              <p className="small">Imagen registrada, pero no hay URL pública disponible para previsualizar.</p>
              {previewState.imageReference ? (
                <p className="small">
                  Referencia técnica:{" "}
                  <span className="admin-procedure-table__mono">{previewState.imageReference}</span>
                </p>
              ) : null}
            </>
          ) : previewState.type === "map" ? (
            previewState.coordinates ? (
              mapRenderError ? (
                <p className="small">No se pudo renderizar el mapa con las coordenadas disponibles.</p>
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
              <p className="small">No hay coordenadas suficientes para mostrar el mapa.</p>
            )
          ) : previewState.type === "location_text" ? (
            <>
              <p className="small">Ubicación registrada sin coordenadas para mapa.</p>
              {previewState.locationText ? <p className="small">{previewState.locationText}</p> : null}
            </>
          ) : null}
          {previewState.type === "map" && mapRenderError && previewState.locationSearchUrl ? (
            <p className="small" style={{ marginTop: "0.5rem" }}>
              <a href={previewState.locationSearchUrl} target="_blank" rel="noreferrer" className="button-inline">
                Buscar ubicación
              </a>
            </p>
          ) : null}
          {previewState.type === "map" && mapRenderError && IS_DEVELOPMENT ? (
            <p className="small">
              <span className="admin-procedure-table__mono">[quick-preview:location] map render error</span>
            </p>
          ) : null}
          {previewState.type === "map" && !previewState.coordinates && previewState.locationSearchUrl ? (
            <p className="small" style={{ marginTop: "0.5rem" }}>
              <a href={previewState.locationSearchUrl} target="_blank" rel="noreferrer" className="button-inline">
                Buscar ubicación
              </a>
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
        {isCompactInfoDialog ? (
          <footer
            className="admin-roles-confirm-dialog__actions"
            style={{ justifyContent: "flex-end", gap: "0.5rem", paddingTop: "0.25rem" }}
          >
            {previewState.locationSearchUrl ? (
              <a href={previewState.locationSearchUrl} target="_blank" rel="noreferrer" className="button-inline">
                Buscar ubicación
              </a>
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              className="button-inline button-inline--compact"
              onClick={onClose}
            >
              Cerrar
            </button>
          </footer>
        ) : null}
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
    try {
      const response = await fetch(`/api/funcionario/procedures/requests/${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
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
        return;
      }
      setDetail(data);
      setCompleteVariablesJson("{}");
      setInternalObservation("");
      setNextStatus("");
    } catch (_error) {
      setFatalError({ message: "No se pudo cargar el detalle del expediente." });
      setDetail(null);
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
    () => buildFuncionarioExpedientePageViewModel(detail, procedureRequestId, actionLoadingKey, isAdmin),
    [actionLoadingKey, detail, isAdmin, procedureRequestId]
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
    responsibleLabel,
    relationLabel,
    activeTaskOperationalLabel,
    retrySyncAction,
  } = expedienteViewModel;

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
      display: attachmentDisplay,
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
    collectedData,
    fieldDefinitions,
    imageFields,
    imageFieldKey,
    imagePreviewReason,
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
      if (!rawAttachment) {
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
        title: "Ubicación en mapa",
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
    <main className="page page--dashboard" lang={locale}>
      <section className="card dashboard-header">
        <div>
          <p className="eyebrow">ÁREA DEL FUNCIONARIO</p>
          <h1>Detalle del expediente</h1>
          <p className="description">
            {trackingCode ? (
              <>
                Número de expediente:{" "}
                <span className="admin-procedure-table__mono">{trackingCode}</span>
              </>
            ) : (
              "Expediente"
            )}
          </p>
          {procedureRequest ? (
            <>
              <p className="small" style={{ marginTop: "0.5rem" }}>
                <span
                  className={`badge ${
                    isAvailable ? "badge--recibido" : "badge--en-revision"
                  }`}
                >
                  {getAssignmentScopeLabel(procedureRequest)}
                </span>
              </p>
              <p className="small" style={{ marginTop: "0.5rem" }}>
                <strong>Tipo:</strong> {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}{" "}
                {" · "}
                <strong>Canal:</strong> {procedureRequest.channel || "-"} {" · "}
                <strong>Creado:</strong> {formatDateTime(procedureRequest.createdAt, locale)} {" · "}
                <strong>Estado:</strong> {getLocalStatusLabel(procedureRequest.status)}
              </p>
            </>
          ) : null}
        </div>
        <p className="small" style={{ marginTop: "0.75rem" }}>
          <Link href="/funcionario/dashboard" className="portal-action-link">
            ← Volver a la bandeja
          </Link>
        </p>
      </section>

      {successMessage ? (
        <section className="card">
          <p className="info-message">{successMessage}</p>
        </section>
      ) : null}
      {actionError ? (
        <section className="card">
          <p className="error-message">{actionError}</p>
        </section>
      ) : null}

      {detailLoading ? (
        <section className="card dashboard-section">
          <p className="info-message">Cargando detalle...</p>
        </section>
      ) : null}

      {!detailLoading && procedureRequest ? (
        <>
          {isAvailable ? (
            <section className="card dashboard-section">
              <h3>Expediente disponible</h3>
              <p className="small">
                Este expediente está disponible para ser tomado. Para gestionarlo, primero debes asignarlo a tu
                bandeja.
              </p>
              {claimAction ? (
                <button
                  type="button"
                  className="button-inline"
                  onClick={() => runAction(claimAction)}
                  disabled={actionLoadingKey === `${claimAction.actionKey}:${claimAction.endpoint}`}
                >
                  {actionLoadingKey === `${claimAction.actionKey}:${claimAction.endpoint}`
                    ? "Procesando..."
                    : "Tomar expediente"}
                </button>
              ) : null}
            </section>
          ) : null}

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Resumen del caso</h3>
            <div className="expediente-summary-layout">
              <div className="expediente-summary-layout__main">
                <p className="small">
                  <strong>Tipo de procedimiento:</strong>{" "}
                  {procedureRequest.procedureName || procedureRequest.procedureCode || "-"}
                </p>
                <p className="small">
                  <strong>Descripción:</strong> {caseDescription || "Sin descripción informada."}
                </p>
                <p className="small">
                  <strong>Ubicación:</strong> {locationValue || "No informada"}
                  {showQuickLocationCard ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="button-inline button-inline--compact"
                        onClick={(event) => openQuickPreview(event, "location")}
                        disabled={!canPreviewLocationMap && !locationSearchUrl && !locationValue}
                        title={
                          canPreviewLocationMap
                            ? "Ver mapa"
                            : locationSearchUrl
                              ? "Buscar ubicación textual"
                              : "Ubicación registrada sin coordenadas para mapa"
                        }
                      >
                        {locationActionLabel}
                      </button>
                    </>
                  ) : null}
                </p>
                <p className="small">
                  <strong>Imagen adjunta:</strong> {attachmentSummaryText}
                  {showQuickImageCard ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="button-inline button-inline--compact"
                        onClick={(event) => openQuickPreview(event, "image")}
                        disabled={!rawAttachment}
                        title={canPreviewAttachment ? "Ver imagen" : "Ver datos de imagen registrada"}
                      >
                        {imageActionLabel}
                      </button>
                    </>
                  ) : null}
                </p>
                <p className="small">
                  <strong>Canal de origen:</strong> {procedureRequest.channel || "-"}
                </p>
                <p className="small">
                  <strong>Fecha de creación:</strong> {formatDateTime(procedureRequest.createdAt, locale)}
                </p>
              </div>
              <aside className="expediente-summary-layout__quick">
                <h4>Vista rápida</h4>
                {quickPreviewCards.length ? (
                  <div className="expediente-summary-layout__quick-list">
                    {showQuickImageCard ? (
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
                          disabled={!rawAttachment}
                        >
                          {canPreviewAttachment ? "Ampliar" : "Ver datos"}
                        </button>
                      </article>
                    ) : null}

                    {showQuickLocationCard ? (
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
                          {canPreviewLocationMap ? "Ampliar" : locationSearchUrl ? "Buscar ubicación" : "Ver datos"}
                        </button>
                      </article>
                    ) : null}
                  </div>
                ) : (
                  <p className="small">No hay adjuntos o ubicaciones para vista rápida.</p>
                )}
              </aside>
            </div>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Datos del ciudadano / contacto</h3>
            <p className="small">
              <strong>Ciudadano asociado:</strong> {procedureRequest.userId || "No asociado"}
            </p>
            <p className="small">
              <strong>Número de WhatsApp:</strong> {procedureRequest.whatsappPhone || "No informado"}
            </p>
            <p className="small">
              <strong>Email:</strong> {contactEmail || "No informado"}
            </p>
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Estado operativo</h3>
            {showCamundaSyncAlert ? (
              <div
                className="admin-roles-confirm-dialog__lead"
                style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "10px", padding: "0.75rem" }}
              >
                <p className="small" style={{ margin: 0 }}>
                  Este expediente requiere revisión de sincronización con Camunda.
                </p>
                <button
                  type="button"
                  className="button-inline"
                  onClick={handleRetryCamundaSync}
                  disabled={isRetrySyncLoading}
                  style={{ marginTop: "0.65rem" }}
                >
                  {isRetrySyncLoading ? "Sincronizando..." : syncPrimaryButtonLabel}
                </button>
              </div>
            ) : null}
            <dl className="admin-roles-confirm-dialog__details" style={{ marginTop: "0.85rem" }}>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Estado del expediente</dt>
                <dd>
                  <span className={`badge ${showCamundaSyncAlert ? "badge--en-revision" : "badge--recibido"}`}>
                    {getLocalStatusLabel(procedureRequest.status)}
                  </span>
                </dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Situación</dt>
                <dd>{operationalSituation}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Tarea activa</dt>
                <dd>{activeTaskOperationalLabel}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Responsable</dt>
                <dd>{responsibleLabel}</dd>
              </div>
              <div className="admin-roles-confirm-dialog__detail-row">
                <dt>Relación con mi bandeja</dt>
                <dd>{relationLabel}</dd>
              </div>
            </dl>
            {activeTaskDescription ? (
              <p className="small">
                <strong>Detalle de tarea:</strong> {activeTaskDescription}
              </p>
            ) : null}
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Acciones operativas</h3>
            {isAvailable ? (
              <p className="small">
                Hasta tomar el expediente no se habilitan acciones de gestión ni avances de Camunda.
              </p>
            ) : (
              <p className="small">
                Acciones habilitadas para este expediente asignado a tu bandeja.
              </p>
            )}
            <ActionCards
              actions={operationalActions}
              onRunAction={runAction}
              actionLoadingKey={actionLoadingKey}
              completeVariablesJson={completeVariablesJson}
              setCompleteVariablesJson={setCompleteVariablesJson}
              internalObservation={internalObservation}
              setInternalObservation={setInternalObservation}
              nextStatus={nextStatus}
              setNextStatus={setNextStatus}
            />
            {showCamundaSyncAlert ? (
              <button
                type="button"
                className="button-inline"
                onClick={handleRetryCamundaSync}
                disabled={isRetrySyncLoading}
                style={{ marginTop: "0.4rem" }}
              >
                {isRetrySyncLoading ? "Sincronizando..." : syncSecondaryButtonLabel}
              </button>
            ) : null}
            {!isAvailable && !showCamundaSyncAlert && operationalActions.length === 0 ? (
              <p className="empty-message">No hay acciones operativas disponibles para este expediente.</p>
            ) : null}
          </section>

          <section className="card dashboard-section admin-procedure-fields">
            <h3>Información técnica</h3>

            <details>
              <summary>Ver datos técnicos del expediente</summary>
              <p className="small">
                <strong>ID interno:</strong>{" "}
                <span className="admin-procedure-table__mono">{procedureRequest.id}</span>
              </p>
              <p className="small">
                <strong>UUID responsable:</strong>{" "}
                <span className="admin-procedure-table__mono">{procedureRequest.assignedToUserId || "-"}</span>
              </p>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(collectedData)}
              </pre>
            </details>

            <details>
              <summary>Ver variables de Camunda</summary>
              <p className="small">
                <strong>Instancia:</strong> {procedureRequest.camundaProcessInstanceKey || "-"}
              </p>
              <p className="small">
                <strong>Definición:</strong> {procedureRequest.camundaProcessDefinitionId || "-"}
              </p>
              <p className="small">
                <strong>Error de sincronización:</strong> {procedureRequest.camundaError || "Sin errores"}
              </p>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(procedureRequest.camundaMetadata)}
              </pre>
            </details>

            <details>
              <summary>Ver historial técnico</summary>
              <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
                {stringifyJson(detail.history || [])}
              </pre>
            </details>
          </section>

          {canManageDeletion ? (
            <section className="card dashboard-section admin-procedure-fields">
              <h3>Zona de peligro</h3>
              <p className="small">
                Esta acción es destructiva. El expediente se elimina en forma permanente y no puede recuperarse.
              </p>
              <button
                type="button"
                className="button-inline button-inline--danger"
                onClick={() => setIsDeleteConfirmOpen(true)}
                disabled={deleteLoading}
              >
                {deleteLoading ? "Eliminando..." : "Eliminar expediente"}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {deleteTechnicalDetail ? (
        <section className="card dashboard-section admin-procedure-fields">
          <details>
            <summary>Detalle técnico de eliminación</summary>
            <pre className="admin-procedure-table__mono" style={{ whiteSpace: "pre-wrap" }}>
              {deleteTechnicalDetail}
            </pre>
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

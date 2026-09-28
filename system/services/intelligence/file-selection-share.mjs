import { assertIntelligenceContextSharePort } from "../../contracts/intelligence-context-share.mjs";
import { encodeIntelligenceHandoffTarget } from "../../contracts/intelligence-handoff.mjs";
import { createDocumentIntelligenceContext } from "./client-actions.mjs";

export const FILE_SELECTION_CONTEXT_SOURCE_ID = "file-selection";
const SOURCE_APP_ID = "files";
const MAX_FILE_NAME_CHARS = 255;
const MAX_DISPLAY_LABEL_CHARS = 160;

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function fileTargetId(name, size, modifiedAt) {
  const encodedName = encodeURIComponent(name);
  const suffix = `:${modifiedAt}:${size}`;
  const available = Math.max(1, 256 - "file:".length - suffix.length);
  return `file:${encodedName.slice(0, available)}${suffix}`;
}

export function offerFileSelectionToIntelligence(
  contextShareValue,
  {
    name,
    size,
    modifiedAt,
    text,
  } = {},
) {
  const contextShare = assertIntelligenceContextSharePort(contextShareValue);
  const fileName = boundedText(name, "Intelligence file selection name", MAX_FILE_NAME_CHARS);
  const fileSize = nonNegativeSafeInteger(size, "Intelligence file selection size");
  const fileModifiedAt = nonNegativeSafeInteger(
    modifiedAt,
    "Intelligence file selection modified time",
  );
  const fileText = boundedText(text, "Intelligence file selection text", 65536);
  const target = Object.freeze({
    kind: "document",
    id: fileTargetId(fileName, fileSize, fileModifiedAt),
  });
  const displayLabel = fileName.slice(0, MAX_DISPLAY_LABEL_CHARS);
  const contextId = `file-selection-${fileModifiedAt}-${fileSize}`.slice(0, 160);

  return contextShare.offer({
    sourceAppId: SOURCE_APP_ID,
    sourceId: FILE_SELECTION_CONTEXT_SOURCE_ID,
    target,
    displayLabel,
    context: createDocumentIntelligenceContext({
      id: contextId,
      title: fileName,
      text: fileText,
      provenance: "ordax:files:user-authorized-selection",
    }),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function createFileSelectionIntelligenceHandoff(
  sharedSelection,
  {
    mode = "ask",
    suggestedPrompt = "Analise este arquivo usando somente o contexto compartilhado.",
  } = {},
) {
  if (!sharedSelection || typeof sharedSelection !== "object" || Array.isArray(sharedSelection)) {
    throw new TypeError("Shared file selection is required");
  }
  const prompt = boundedText(suggestedPrompt, "Intelligence file selection prompt", 2000);
  return encodeIntelligenceHandoffTarget({
    sourceAppId: SOURCE_APP_ID,
    mode,
    target: sharedSelection.target,
    displayLabel: sharedSelection.displayLabel,
    suggestedPrompt: prompt,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

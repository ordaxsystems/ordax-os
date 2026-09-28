import { assertIntelligenceContextSharePort } from "../../contracts/intelligence-context-share.mjs";
import { encodeIntelligenceHandoffTarget } from "../../contracts/intelligence-handoff.mjs";
import { validateWorkspaceRecord } from "../../contracts/workspace-store.mjs";

export const WORKSPACE_SELECTION_CONTEXT_SOURCE_ID = "workspace-selection";
const SOURCE_APP_ID = "system";
const MAX_DISPLAY_LABEL_CHARS = 160;

function activeArea(record) {
  const area = record.areas.find((candidate) => candidate.id === record.activeAreaId) ?? null;
  if (!area) {
    throw new TypeError("Active workspace area is unavailable");
  }
  return area;
}

function sanitizedWorkspaceSnapshot(area) {
  const appIds = [...new Set(area.windows.map((windowState) => windowState.appId))].sort();
  const visibleAppIds = [...new Set(
    area.windows
      .filter((windowState) => !windowState.minimized)
      .map((windowState) => windowState.appId),
  )].sort();
  const activeWindow = area.activeWindowId === null
    ? null
    : area.windows.find((windowState) => windowState.id === area.activeWindowId) ?? null;

  return Object.freeze({
    areaOrdinal: area.ordinal,
    windowCount: area.windows.length,
    visibleWindowCount: area.windows.filter((windowState) => !windowState.minimized).length,
    activeAppId: activeWindow?.appId ?? null,
    appIds: Object.freeze(appIds),
    visibleAppIds: Object.freeze(visibleAppIds),
  });
}

export function createWorkspaceSelectionIntelligenceContext(workspaceRecordValue) {
  const record = validateWorkspaceRecord(workspaceRecordValue);
  const area = activeArea(record);
  const snapshot = sanitizedWorkspaceSnapshot(area);
  return Object.freeze({
    target: Object.freeze({ kind: "workspace", id: area.id }),
    displayLabel: `Área ${area.ordinal}`.slice(0, MAX_DISPLAY_LABEL_CHARS),
    context: Object.freeze([Object.freeze({
      id: `workspace-area-${area.ordinal}`,
      scope: "workspace",
      text: JSON.stringify(snapshot),
      provenance: "ordax:system:user-authorized-workspace-selection",
    })]),
  });
}

export function offerWorkspaceSelectionToIntelligence(
  contextShareValue,
  workspaceRecordValue,
) {
  const contextShare = assertIntelligenceContextSharePort(contextShareValue);
  const selection = createWorkspaceSelectionIntelligenceContext(workspaceRecordValue);
  return contextShare.offer({
    sourceAppId: SOURCE_APP_ID,
    sourceId: WORKSPACE_SELECTION_CONTEXT_SOURCE_ID,
    target: selection.target,
    displayLabel: selection.displayLabel,
    context: selection.context,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function createWorkspaceSelectionIntelligenceHandoff(
  sharedSelection,
  {
    mode = "plan",
    suggestedPrompt = "Planeje os próximos passos usando somente a estrutura da área atual.",
  } = {},
) {
  if (!sharedSelection || typeof sharedSelection !== "object" || Array.isArray(sharedSelection)) {
    throw new TypeError("Shared workspace selection is required");
  }
  if (typeof suggestedPrompt !== "string" || !suggestedPrompt.trim() || suggestedPrompt.length > 2000) {
    throw new TypeError("Intelligence workspace selection prompt is outside its allowed bounds");
  }
  return encodeIntelligenceHandoffTarget({
    sourceAppId: SOURCE_APP_ID,
    mode,
    target: sharedSelection.target,
    displayLabel: sharedSelection.displayLabel,
    suggestedPrompt: suggestedPrompt.trim(),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

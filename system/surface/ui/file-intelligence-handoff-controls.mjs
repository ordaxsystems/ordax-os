import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  MAX_TEXT_FILE_BYTES,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../contracts/file-space.mjs";
import { assertIntelligenceContextSharePort } from "../../contracts/intelligence-context-share.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import {
  createFileSelectionIntelligenceHandoff,
  offerFileSelectionToIntelligence,
} from "../../services/intelligence/file-selection-share.mjs";
import { getDefaultIntelligenceContextSharingRuntime } from "../../services/intelligence/context-sharing-runtime.mjs";

const FILE_WINDOW_SELECTOR = '[data-window-id="files"]';
const FILE_EXTENSION_SELECTOR = '[data-app-extension="file-space"]';
const SELECTED_FILE_SELECTOR = '[data-file-select-path][data-selected="true"][data-kind="file"]';
const ACTIONS_SELECTOR = ".ordax-files-details-actions";
const ACTION_SELECTOR = "[data-file-intelligence-handoff-action]";
const STATUS_SELECTOR = "[data-file-intelligence-handoff-status]";

function parentPath(path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function fileName(path) {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function matchingEntry(listing, path) {
  const name = fileName(path);
  return listing.entries.find((entry) => entry.name === name && entry.kind === "file") ?? null;
}

export function mountFileIntelligenceHandoffControls(
  root,
  fileSpace = null,
  appActivation = null,
  surfaceLifecycle = null,
  { intelligenceContextShare = null } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Files Intelligence handoff controls require a Surface root");
  }

  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activation = appActivation === null ? null : assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  if (port === null || activation === null) {
    return Object.freeze({ destroy() {} });
  }

  const contextShare = assertIntelligenceContextSharePort(
    intelligenceContextShare ?? getDefaultIntelligenceContextSharingRuntime().share,
  );
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let destroyed = false;
  let pending = false;
  let requestOrdinal = 0;
  let statusMessageId = null;
  let renderQueued = false;

  const slot = () => root.querySelector(`${FILE_WINDOW_SELECTOR} ${FILE_EXTENSION_SELECTOR}`);
  const selectedFilePath = () => slot()?.querySelector(SELECTED_FILE_SELECTOR)?.dataset.fileSelectPath ?? null;

  const clearStatus = () => {
    statusMessageId = null;
  };

  const setStatus = (messageId) => {
    statusMessageId = messageId;
  };

  const revokeShared = (shared) => {
    if (!shared) return;
    try {
      const authorization = contextShare.take({
        sourceAppId: "files",
        target: shared.target,
      });
      if (authorization) contextShare.revoke(authorization);
    } catch {
      // The grant is short-lived and one-shot; cleanup must not mask the original failure.
    }
  };

  const scheduleRender = () => {
    if (destroyed || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      render();
    });
  };

  const render = () => {
    if (destroyed) return;
    const currentSlot = slot();
    if (!currentSlot) return;

    const selectedPath = selectedFilePath();
    const actions = currentSlot.querySelector(ACTIONS_SELECTOR);
    let action = currentSlot.querySelector(ACTION_SELECTOR);
    let status = currentSlot.querySelector(STATUS_SELECTOR);

    if (!selectedPath || !actions) {
      action?.remove();
      status?.remove();
      return;
    }

    if (!action) {
      action = documentObject.createElement("button");
      action.type = "button";
      action.className = "ordax-files-action ordax-files-intelligence-action";
      action.dataset.fileIntelligenceHandoffAction = "";
      actions.prepend(action);
    }
    const label = `↗  ${t("app.intelligence.title")}`;
    if (action.textContent !== label) action.textContent = label;
    action.disabled = pending;
    action.setAttribute("aria-busy", String(pending));

    if (statusMessageId === null) {
      status?.remove();
      return;
    }
    if (!status) {
      status = documentObject.createElement("p");
      status.className = "ordax-files-message";
      status.dataset.fileIntelligenceHandoffStatus = "";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      actions.insertAdjacentElement("afterend", status);
    }
    const message = t(statusMessageId);
    if (status.textContent !== message) status.textContent = message;
  };

  const shareSelectedFile = async () => {
    if (pending || destroyed) return;
    const path = selectedFilePath();
    if (!path) return;

    const ordinal = ++requestOrdinal;
    let shared = null;
    pending = true;
    clearStatus();
    render();

    try {
      const directory = parentPath(path);
      const before = validateFileListing(await port.list(directory));
      if (destroyed || ordinal !== requestOrdinal || selectedFilePath() !== path) return;

      const beforeEntry = matchingEntry(before, path);
      if (!beforeEntry) {
        setStatus("files.common.missing");
        return;
      }
      if (beforeEntry.size > MAX_TEXT_FILE_BYTES) {
        setStatus("files.preview.tooLarge");
        return;
      }

      const textFile = validateTextFile(await port.readTextFile(path));
      if (destroyed || ordinal !== requestOrdinal || selectedFilePath() !== path) return;

      const after = validateFileListing(await port.list(directory));
      if (destroyed || ordinal !== requestOrdinal || selectedFilePath() !== path) return;
      const afterEntry = matchingEntry(after, path);
      if (
        !afterEntry
        || textFile.path !== path
        || afterEntry.size !== beforeEntry.size
        || afterEntry.modifiedAt !== beforeEntry.modifiedAt
        || textFile.size !== afterEntry.size
      ) {
        setStatus("files.common.missing");
        return;
      }

      shared = offerFileSelectionToIntelligence(contextShare, {
        name: afterEntry.name,
        size: afterEntry.size,
        modifiedAt: afterEntry.modifiedAt,
        text: textFile.text,
      });
      if (destroyed || ordinal !== requestOrdinal || selectedFilePath() !== path) {
        revokeShared(shared);
        shared = null;
        return;
      }

      activation.publish({
        appId: "intelligence",
        target: createFileSelectionIntelligenceHandoff(shared),
      });
      shared = null;
    } catch (error) {
      revokeShared(shared);
      shared = null;
      if (destroyed || ordinal !== requestOrdinal) return;
      const detail = error instanceof Error ? error.message : String(error);
      if (/\b413\b/.test(detail)) {
        setStatus("files.preview.tooLarge");
      } else if (/\b415\b/.test(detail)) {
        setStatus("files.preview.invalidUtf8");
      } else if (/\b404\b/.test(detail)) {
        setStatus("files.common.missing");
      } else {
        setStatus("files.preview.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        render();
      }
    }
  };

  const onClick = (event) => {
    const action = event.target?.closest?.(ACTION_SELECTOR);
    if (!action || !root.contains(action)) return;
    void shareSelectedFile();
  };

  const observer = new MutationObserver(scheduleRender);
  observer.observe(root, { childList: true, subtree: true });
  const unsubscribeRender = lifecycle.subscribeRender(scheduleRender);
  const unsubscribeLocalization = localization.subscribe(scheduleRender);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestOrdinal += 1;
      observer.disconnect();
      unsubscribeLocalization();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      slot()?.querySelector(ACTION_SELECTOR)?.remove();
      slot()?.querySelector(STATUS_SELECTOR)?.remove();
    },
  });
}

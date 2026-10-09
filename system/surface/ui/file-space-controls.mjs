import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import {
  MAX_FILE_COPY_BYTES,
  MAX_FILE_EXPORT_BYTES,
  MAX_FILE_IMPORT_BYTES,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
  validateTrashListing,
} from "../../contracts/file-space.mjs";
import { assertNotesFileImporter } from "../../contracts/notes-file-importer.mjs";
import {
  assertRecentFilesPort,
  validateRecentFilesSnapshot,
} from "../../contracts/recent-files.mjs";
import {
  MAX_PROJECT_NAME_LENGTH,
  assertProjectCatalogReader,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import { assertProjectMutations } from "../../contracts/project-mutations.mjs";
import {
  createFileNotesActionPresentation,
  importSelectedFileToNotes,
} from "./file-notes-action.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const FILE_WINDOW_SELECTOR = '[data-window-id="files"]';
const FILE_EXTENSION_SELECTOR = '[data-app-extension="file-space"]';
const MAX_NAVIGATION_HISTORY = 64;
const LOCATIONS = Object.freeze([
  Object.freeze({ messageId: "files.location.mySpace", path: "/" }),
  Object.freeze({ messageId: "files.location.documents", path: "/Documentos" }),
  Object.freeze({ messageId: "files.location.pictures", path: "/Imagens" }),
  Object.freeze({ messageId: "files.location.downloads", path: "/Downloads" }),
]);

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function joinPath(path, name) {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function suggestedCopyName(name, suffix) {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    return `${name.slice(0, dot)} - ${suffix}${name.slice(dot)}`;
  }
  return `${name} - ${suffix}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatModifiedAt(epochMilliseconds, locale = "pt-BR") {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(epochMilliseconds));
}

function locationIsActive(currentPath, locationPath) {
  if (locationPath === "/") return currentPath === "/";
  return currentPath === locationPath || currentPath.startsWith(`${locationPath}/`);
}

function breadcrumbParts(path) {
  if (path === "/") return [];
  return path.split("/").filter(Boolean);
}

export function mountFileSpaceControls(
  root,
  fileSpace = null,
  appActivation = null,
  surfaceLifecycle = null,
  resources = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("File-space controls require a Surface root Element");
  }
  const port = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  if (!port) {
    return Object.freeze({ destroy() {} });
  }
  const recentFiles = resources?.recentFiles ?? null;
  const projects = resources?.projects ?? null;
  const projectMutations = resources?.projectMutations ?? null;
  const notesFileImporter = resources?.notesFileImporter ?? null;
  const recentPort = recentFiles === null ? null : assertRecentFilesPort(recentFiles);
  if ((projects === null) !== (projectMutations === null)) {
    throw new TypeError("File-space Project controls require reader and mutation authority together");
  }
  const projectReader = projects === null ? null : assertProjectCatalogReader(projects);
  const projectMutationPort = projectMutations === null ? null : assertProjectMutations(projectMutations);
  const notesImporterPort = notesFileImporter === null ? null : assertNotesFileImporter(notesFileImporter);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const locale = () => localization.getLocale();
  const documentObject = root.ownerDocument;

  let listing = null;
  let pending = false;
  let message = null;
  let messageId = null;
  let messageParams = Object.freeze({});
  let destroyed = false;
  let requestOrdinal = 0;
  let mountedSlot = null;
  let creatingDirectory = false;
  let directoryDraft = "";
  let textPreview = null;
  let previewPending = false;
  let previewRequestOrdinal = 0;
  let selectedPath = null;
  let renamingPath = null;
  let renameDraft = "";
  let copyingPath = null;
  let copyDraft = "";
  let transferEntry = null;
  let searchQuery = "";
  let sortKey = "name";
  let sortDirection = "asc";
  let navigationHistory = [];
  let navigationIndex = -1;
  let focusRequest = null;
  let recentSnapshot = recentPort?.getSnapshot() ?? null;
  let recentMode = false;
  let selectedRecentPath = null;
  let trashListing = null;
  let trashMode = false;
  let selectedTrashId = null;
  let recentSearchQuery = "";
  let projectSnapshot = projectReader?.getSnapshot() ?? null;
  let creatingProject = false;
  let projectDraft = "";
  let renamingProjectId = null;
  let projectRenameDraft = "";
  let failedProjectResume = null;
  let notesImportPending = false;

  const findSlot = () =>
    root.querySelector(`${FILE_WINDOW_SELECTOR} ${FILE_EXTENSION_SELECTOR}`);

  const clearMessage = () => {
    message = null;
    messageId = null;
    messageParams = Object.freeze({});
  };

  const setMessage = (id, params = {}) => {
    message = null;
    messageId = id;
    messageParams = Object.freeze({ ...params });
  };

  const renderedMessage = () =>
    message !== null ? message : (messageId ? t(messageId, messageParams) : null);

  const interactionContext = () =>
    trashMode ? "trash" : recentMode ? "recent" : `path:${listing?.path ?? ""}`;

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.fileRecentSearch !== undefined) {
      return Object.freeze({ kind: "recent-search", value: "" });
    }
    if (element.dataset.fileRecentPath) {
      return Object.freeze({ kind: "recent-row", value: element.dataset.fileRecentPath });
    }
    if (element.dataset.fileTrashId) {
      return Object.freeze({ kind: "trash-row", value: element.dataset.fileTrashId });
    }
    if (element.dataset.fileSearch !== undefined) {
      return Object.freeze({ kind: "search", value: "" });
    }
    if (element.dataset.fileProjectRenameName !== undefined) {
      return Object.freeze({ kind: "project-rename-name", value: renamingProjectId ?? "" });
    }
    if (element.dataset.fileProjectName !== undefined) {
      return Object.freeze({ kind: "project-name", value: "" });
    }
    if (element.dataset.fileDirectoryName !== undefined) {
      return Object.freeze({ kind: "directory-name", value: "" });
    }
    if (element.dataset.fileRenameName !== undefined) {
      return Object.freeze({ kind: "rename-name", value: renamingPath ?? "" });
    }
    if (element.dataset.fileCopyName !== undefined) {
      return Object.freeze({ kind: "copy-name", value: copyingPath ?? "" });
    }
    if (element.dataset.fileSelectPath) {
      return Object.freeze({ kind: "row", value: element.dataset.fileSelectPath });
    }
    if (element.dataset.fileSortKey) {
      return Object.freeze({ kind: "sort", value: element.dataset.fileSortKey });
    }
    return null;
  };

  const findFocusTarget = (slot, identity) => {
    if (!identity) return null;
    for (const element of slot.querySelectorAll("button, input")) {
      const candidate = focusIdentity(element);
      if (
        candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
      ) {
        return element;
      }
    }
    return null;
  };

  const captureInteractionState = (slot) => {
    const windowBody = slot.closest(".ordax-window-body");
    const list = slot.querySelector(".ordax-files-list");
    const preview = slot.querySelector(".ordax-files-preview-content");
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && slot.contains(activeElement);
    const identity = activeInside ? focusIdentity(activeElement) : null;
    const selection =
      activeInside
      && activeElement instanceof HTMLInputElement
      && identity
        ? Object.freeze({
            identity,
            start: activeElement.selectionStart,
            end: activeElement.selectionEnd,
          })
        : null;
    return Object.freeze({
      context: slot.dataset.fileSpaceContext ?? "",
      windowScrollTop: windowBody?.scrollTop ?? 0,
      windowScrollLeft: windowBody?.scrollLeft ?? 0,
      listScrollTop: list?.scrollTop ?? 0,
      listScrollLeft: list?.scrollLeft ?? 0,
      previewScrollTop: preview?.scrollTop ?? 0,
      previewScrollLeft: preview?.scrollLeft ?? 0,
      focus: identity,
      selection,
    });
  };

  const requestFocus = (kind, value = "") => {
    focusRequest = Object.freeze({ kind, value });
  };

  const restoreInteractionState = (slot, snapshot) => {
    const sameContext =
      Boolean(snapshot)
      && snapshot.context === interactionContext();
    const windowBody = slot.closest(".ordax-window-body");
    if (windowBody && sameContext) {
      windowBody.scrollTop = snapshot.windowScrollTop;
      windowBody.scrollLeft = snapshot.windowScrollLeft;
    }

    const list = slot.querySelector(".ordax-files-list");
    if (list && sameContext) {
      list.scrollTop = snapshot.listScrollTop;
      list.scrollLeft = snapshot.listScrollLeft;
    }

    const preview = slot.querySelector(".ordax-files-preview-content");
    if (preview && sameContext) {
      preview.scrollTop = snapshot.previewScrollTop;
      preview.scrollLeft = snapshot.previewScrollLeft;
    }

    const requested = focusRequest;
    focusRequest = null;
    const identity = requested ?? (sameContext ? snapshot?.focus : null) ?? null;
    const target = findFocusTarget(slot, identity);
    if (!target || target.disabled) return;

    target.focus({ preventScroll: true });
    if (!(target instanceof HTMLInputElement)) return;

    const savedSelection =
      sameContext
      && snapshot?.selection
      && snapshot.selection.identity.kind === identity.kind
      && snapshot.selection.identity.value === identity.value
        ? snapshot.selection
        : null;
    if (savedSelection?.start !== null && savedSelection?.end !== null) {
      const length = target.value.length;
      target.setSelectionRange(
        Math.min(savedSelection.start, length),
        Math.min(savedSelection.end, length),
      );
      return;
    }

    if (requested) {
      const caret = target.value.length;
      target.setSelectionRange?.(caret, caret);
    }
  };

  const renderLocations = (container) => {
    const heading = node(documentObject, "p", "ordax-files-section-label", t("files.location.section"));
    container.append(heading);
    LOCATIONS.forEach((location, index) => {
      const button = node(
        documentObject,
        "button",
        "ordax-files-location",
        t(location.messageId),
      );
      button.type = "button";
      button.dataset.fileOpenPath = location.path;
      const active = Boolean(
        !recentMode && !trashMode && listing && locationIsActive(listing.path, location.path),
      );
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "page" : "false");
      container.append(button);

      if (index === 0) {
        if (recentPort) {
          const recent = node(
            documentObject,
            "button",
            "ordax-files-location",
            t("files.location.recents"),
          );
          recent.type = "button";
          recent.dataset.fileOpenRecent = "";
          recent.dataset.active = String(recentMode);
          recent.setAttribute("aria-current", recentMode ? "page" : "false");
          container.append(recent);
        }
        const trash = node(
          documentObject,
          "button",
          "ordax-files-location",
          t("files.location.trash"),
        );
        trash.type = "button";
        trash.dataset.fileOpenTrash = "";
        trash.dataset.active = String(trashMode);
        trash.setAttribute("aria-current", trashMode ? "page" : "false");
        container.append(trash);
      }
    });

    if (projectReader) {
      container.append(
        node(documentObject, "p", "ordax-files-section-label", t("files.location.projects")),
      );
      for (const project of projectSnapshot?.projects ?? []) {
        const button = node(documentObject, "button", "ordax-files-location", project.name);
        button.type = "button";
        button.dataset.fileOpenProject = project.id;
        button.title = project.path;
        const active = Boolean(!recentMode && !trashMode && listing?.path === project.path);
        button.dataset.active = String(active);
        button.setAttribute("aria-current", active ? "page" : "false");
        container.append(button);
      }
    }
  };

  const parentPath = (path) => {
    if (typeof path !== "string" || path === "/") return "/";
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    return parts.length === 0 ? "/" : `/${parts.join("/")}`;
  };

  const projectForFilePath = (path) => {
    if (!projectReader || typeof path !== "string") return null;
    let match = null;
    for (const project of projectSnapshot?.projects ?? []) {
      if (!path.startsWith(`${project.path}/`)) continue;
      if (!match || project.path.length > match.path.length) match = project;
    }
    return match;
  };

  const canGoBack = () => navigationIndex > 0;
  const canGoForward = () =>
    navigationIndex >= 0 && navigationIndex < navigationHistory.length - 1;

  const recordNavigation = (path) => {
    if (navigationHistory[navigationIndex] === path) return;
    navigationHistory = navigationHistory.slice(0, navigationIndex + 1);
    navigationHistory.push(path);
    if (navigationHistory.length > MAX_NAVIGATION_HISTORY) {
      navigationHistory = navigationHistory.slice(-MAX_NAVIGATION_HISTORY);
    }
    navigationIndex = navigationHistory.length - 1;
  };

  const renderBreadcrumb = (container) => {
    const rootButton = node(
      documentObject,
      "button",
      "ordax-files-crumb",
      t("files.location.mySpace"),
    );
    rootButton.type = "button";
    rootButton.dataset.fileOpenPath = "/";
    container.append(rootButton);

    let current = "";
    for (const part of breadcrumbParts(listing?.path ?? "/")) {
      container.append(node(documentObject, "span", "ordax-files-crumb-separator", "/"));
      current += `/${part}`;
      const button = node(documentObject, "button", "ordax-files-crumb", part);
      button.type = "button";
      button.dataset.fileOpenPath = current;
      container.append(button);
    }
  };

  const renderCreateDirectory = (container) => {
    if (!creatingDirectory) return;
    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.placeholder = t("files.form.newFolderName");
    input.value = directoryDraft;
    input.dataset.fileDirectoryName = "";
    input.setAttribute("aria-label", t("files.form.newFolderName"));
    const confirm = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", t("files.form.create"));
    confirm.type = "button";
    confirm.dataset.fileCreateDirectory = "";
    confirm.disabled = pending;
    const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
    cancel.type = "button";
    cancel.dataset.fileCreateCancel = "";
    cancel.disabled = pending;
    form.append(input, confirm, cancel);
    container.append(form);
  };

  const renderCreateProject = (container) => {
    if (!creatingProject || !projectReader || !projectMutationPort || !listing || recentMode) return;
    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = MAX_PROJECT_NAME_LENGTH;
    input.autocomplete = "off";
    input.placeholder = t("files.form.projectName");
    input.value = projectDraft;
    input.dataset.fileProjectName = "";
    input.setAttribute("aria-label", t("files.form.projectName"));
    const confirm = node(documentObject, "button", "ordax-files-action ordax-files-action-primary", t("files.form.add"));
    confirm.type = "button";
    confirm.dataset.fileProjectCreate = "";
    const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
    cancel.type = "button";
    cancel.dataset.fileProjectCreateCancel = "";
    form.append(input, confirm, cancel);
    container.append(form);
  };

  const renderRenameProject = (container) => {
    if (!renamingProjectId || !projectReader || !projectMutationPort || !listing || recentMode) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === renamingProjectId);
    if (!project || project.path !== listing.path) return;

    const form = node(documentObject, "div", "ordax-files-create");
    const input = node(documentObject, "input", "ordax-files-create-input");
    input.type = "text";
    input.maxLength = MAX_PROJECT_NAME_LENGTH;
    input.autocomplete = "off";
    input.placeholder = t("files.form.projectRename");
    input.value = projectRenameDraft;
    input.dataset.fileProjectRenameName = "";
    input.setAttribute("aria-label", t("files.form.projectRenameAria", { name: project.name }));

    const confirm = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      t("files.form.saveName"),
    );
    confirm.type = "button";
    confirm.dataset.fileProjectRenameConfirm = "";

    const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
    cancel.type = "button";
    cancel.dataset.fileProjectRenameCancel = "";

    const note = node(
      documentObject,
      "p",
      "ordax-files-boundary",
      t("files.form.projectRenameHint", { path: project.path }),
    );
    form.append(input, confirm, cancel, note);
    container.append(form);
  };

  const selectedEntry = () => {
    if (!listing || !selectedPath) return null;
    const entry = listing.entries.find((candidate) => joinPath(listing.path, candidate.name) === selectedPath);
    return entry ? Object.freeze({ ...entry, path: selectedPath }) : null;
  };

  const focusSelectedRow = () => {
    if (!selectedPath) return;
    queueMicrotask(() => {
      if (destroyed) return;
      const slot = findSlot();
      const row = slot?.querySelector("[data-file-select-path]");
      if (!row) return;
      for (const candidate of slot.querySelectorAll("[data-file-select-path]")) {
        if (candidate.dataset.fileSelectPath === selectedPath) {
          candidate.focus();
          return;
        }
      }
    });
  };

  const selectPath = (path, { focus = false } = {}) => {
    if (!listing || typeof path !== "string") return;
    const entry = listing.entries.find((candidate) => joinPath(listing.path, candidate.name) === path);
    if (!entry) return;
    selectedPath = path;
    if (renamingPath !== path) {
      renamingPath = null;
      renameDraft = "";
    }
    if (copyingPath !== path) {
      copyingPath = null;
      copyDraft = "";
    }
    clearMessage();
    if (textPreview?.path !== path) {
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
    }
    replaceView();
    if (focus) focusSelectedRow();
  };

  const normalizedSearchQuery = () =>
    searchQuery.trim().toLocaleLowerCase(locale());

  const compareEntryNames = (left, right) =>
    left.name.localeCompare(right.name, locale(), {
      numeric: true,
      sensitivity: "base",
    });

  const visibleEntries = () => {
    if (!listing) return [];
    const query = normalizedSearchQuery();
    const filtered = query
      ? listing.entries.filter((entry) =>
          entry.name.toLocaleLowerCase(locale()).includes(query),
        )
      : [...listing.entries];

    const direction = sortDirection === "desc" ? -1 : 1;
    filtered.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      let compared = 0;
      if (sortKey === "type") {
        compared = left.kind.localeCompare(right.kind, "en");
      } else if (sortKey === "size") {
        compared = left.size - right.size;
      } else if (sortKey === "modified") {
        compared = left.modifiedAt - right.modifiedAt;
      } else {
        compared = compareEntryNames(left, right);
      }
      if (compared === 0) compared = compareEntryNames(left, right);
      return compared * direction;
    });
    return filtered;
  };

  const changeSort = (key) => {
    if (!["name", "type", "size", "modified"].includes(key)) return;
    if (sortKey === key) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDirection = "asc";
    }
    replaceView();
  };

  const sortButton = (label, key) => {
    const button = node(documentObject, "button", "ordax-files-sort");
    button.type = "button";
    button.dataset.fileSortKey = key;
    const active = sortKey === key;
    button.dataset.active = String(active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute(
      "aria-label",
      active
        ? t("files.sort.aria", {
            label,
            direction: sortDirection === "asc"
              ? t("files.sort.ascending")
              : t("files.sort.descending"),
          })
        : t("files.sort.orderBy", { label: label.toLocaleLowerCase(locale()) }),
    );
    button.append(
      node(documentObject, "span", "", label),
      node(
        documentObject,
        "span",
        "ordax-files-sort-indicator",
        active ? (sortDirection === "asc" ? "↑" : "↓") : "",
      ),
    );
    return button;
  };

  const selectionIsVisible = () => {
    if (!listing || !selectedPath) return true;
    return visibleEntries().some(
      (entry) => joinPath(listing.path, entry.name) === selectedPath,
    );
  };

  const operationStatus = (error) => {
    if (Number.isInteger(error?.status)) return error.status;
    const detail = error instanceof Error ? error.message : String(error);
    const match = detail.match(/\b(4\d\d|5\d\d)\b/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const transferDestinationState = () => {
    if (!transferEntry || !listing) {
      return Object.freeze({
        allowed: false,
        reasonMessageId: "files.transfer.chooseDestination",
      });
    }
    if (listing.path === transferEntry.sourcePath) {
      return Object.freeze({
        allowed: false,
        reasonMessageId: transferEntry.mode === "copy"
          ? "files.transfer.copyOtherFolder"
          : "files.transfer.moveOtherFolder",
      });
    }
    if (
      transferEntry.mode === "move" &&
      transferEntry.kind === "directory" &&
      (listing.path === transferEntry.sourceFullPath ||
        listing.path.startsWith(`${transferEntry.sourceFullPath}/`))
    ) {
      return Object.freeze({
        allowed: false,
        reasonMessageId: "files.transfer.cannotMoveIntoSelf",
      });
    }
    return Object.freeze({ allowed: true, reasonMessageId: null });
  };

  const renderTransferOperation = (container) => {
    if (!transferEntry) return;
    const destination = transferDestinationState();
    const isCopy = transferEntry.mode === "copy";
    const panel = node(documentObject, "section", "ordax-files-transfer");
    panel.setAttribute(
      "aria-label",
      t(isCopy ? "files.transfer.ariaCopy" : "files.transfer.ariaMove"),
    );

    const summary = node(documentObject, "div", "ordax-files-transfer-copy");
    summary.append(
      node(
        documentObject,
        "strong",
        "ordax-files-transfer-title",
        t(isCopy ? "files.transfer.titleCopy" : "files.transfer.titleMove", {
          name: transferEntry.name,
        }),
      ),
      node(
        documentObject,
        "span",
        "ordax-files-transfer-meta",
        listing
          ? t("files.transfer.currentDestination", { path: listing.path })
          : t("files.transfer.openingDestination"),
      ),
      node(
        documentObject,
        "span",
        "ordax-files-transfer-guidance",
        destination.allowed
          ? t(isCopy ? "files.transfer.copyGuidance" : "files.transfer.moveGuidance")
          : t(destination.reasonMessageId),
      ),
    );

    const actions = node(documentObject, "div", "ordax-files-transfer-actions");
    const confirm = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      t(isCopy ? "files.transfer.confirmCopy" : "files.transfer.confirmMove"),
    );
    confirm.type = "button";
    confirm.dataset.fileTransferConfirm = "";
    confirm.disabled = pending || !destination.allowed;

    const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
    cancel.type = "button";
    cancel.dataset.fileTransferCancel = "";
    cancel.disabled = pending;

    actions.append(confirm, cancel);
    panel.append(summary, actions);
    container.append(panel);
  };

  const renderEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    list.setAttribute("aria-label", t("files.folder.items.aria"));
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      sortButton(t("files.column.name"), "name"),
      sortButton(t("files.column.type"), "type"),
      sortButton(t("files.column.size"), "size"),
      sortButton(t("files.column.modified"), "modified"),
    );
    list.append(header);

    if (!listing) {
      const empty = node(
        documentObject,
        "div",
        "ordax-files-empty",
        pending ? t("files.empty.opening") : t("files.empty.unavailable"),
      );
      list.append(empty);
      container.append(list);
      return;
    }

    if (listing.entries.length === 0) {
      list.append(node(documentObject, "div", "ordax-files-empty", t("files.empty.folder")));
      container.append(list);
      return;
    }

    const entries = visibleEntries();
    if (entries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          t("files.empty.search"),
        ),
      );
      container.append(list);
      return;
    }

    for (const entry of entries) {
      const path = joinPath(listing.path, entry.name);
      const selected = selectedPath === path;
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      row.dataset.fileSelectPath = path;
      row.dataset.kind = entry.kind;
      row.dataset.selected = String(selected);
      row.setAttribute("aria-pressed", String(selected));
      const localizedKind = entry.kind === "directory"
        ? t("files.kind.folderLower")
        : t("files.kind.fileLower");
      row.setAttribute(
        "aria-label",
        t(selected ? "files.row.ariaSelected" : "files.row.aria", {
          name: entry.name,
          kind: localizedKind,
        }),
      );

      const nameCell = node(documentObject, "span", "ordax-file-name");
      const icon = node(documentObject, "span", "ordax-file-icon");
      icon.dataset.kind = entry.kind;
      icon.setAttribute("aria-hidden", "true");
      nameCell.append(icon, node(documentObject, "span", "", entry.name));

      row.append(
        nameCell,
        node(
          documentObject,
          "span",
          "ordax-file-meta",
          entry.kind === "directory" ? t("files.kind.folder") : t("files.kind.file"),
        ),
        node(documentObject, "span", "ordax-file-meta", entry.kind === "directory" ? "—" : formatSize(entry.size)),
        node(documentObject, "span", "ordax-file-meta", formatModifiedAt(entry.modifiedAt, locale())),
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderSelectionDetails = (container) => {
    if (transferEntry) return;
    const selected = selectedEntry();
    if (!selected) return;

    const details = node(documentObject, "section", "ordax-files-details");
    details.setAttribute("aria-label", t("files.details.aria"));

    const summary = node(documentObject, "div", "ordax-files-details-summary");
    summary.append(
      node(documentObject, "strong", "ordax-files-details-title", selected.name),
      node(
        documentObject,
        "span",
        "ordax-files-details-meta",
        selected.kind === "directory"
          ? t("files.kind.folder")
          : `${t("files.kind.file")} · ${formatSize(selected.size)}`,
      ),
      node(documentObject, "span", "ordax-files-details-path", selected.path),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        t("files.details.modifiedAt", { date: formatModifiedAt(selected.modifiedAt, locale()) }),
      ),
    );

    const actions = node(documentObject, "div", "ordax-files-details-actions");
    const itemBusy = pending || previewPending || notesImportPending;
    let duplicate = null;
    let copyTo = null;
    let exportFile = null;
    let createNote = null;
    if (selected.kind === "file") {
      duplicate = node(documentObject, "button", "ordax-files-action", t("files.action.duplicate"));
      duplicate.type = "button";
      duplicate.dataset.fileCopyToggle = "";
      duplicate.disabled = itemBusy;
      copyTo = node(documentObject, "button", "ordax-files-action", t("files.action.copyTo"));
      copyTo.type = "button";
      copyTo.dataset.fileCopyToToggle = "";
      copyTo.disabled = itemBusy || selected.size > MAX_FILE_COPY_BYTES;
      if (selected.size > MAX_FILE_COPY_BYTES) {
        copyTo.title = t("files.action.copyLimit");
      }
      exportFile = node(documentObject, "button", "ordax-files-action", t("files.action.export"));
      exportFile.type = "button";
      exportFile.dataset.fileExport = "";
      exportFile.disabled = itemBusy || selected.size > MAX_FILE_EXPORT_BYTES;
      if (selected.size > MAX_FILE_EXPORT_BYTES) {
        exportFile.title = t("files.action.exportLimit");
      }
      const notesAction = createFileNotesActionPresentation({
        importerAvailable: Boolean(notesImporterPort),
        busy: notesImportPending,
        selected,
      });
      if (notesAction.visible) {
        createNote = node(documentObject, "button", "ordax-files-action", t(notesAction.labelMessageId));
        createNote.type = "button";
        createNote.dataset.fileCreateNote = "";
        createNote.disabled = itemBusy || notesAction.disabled;
        createNote.title = t(notesAction.titleMessageId);
      }
    }
    const move = node(documentObject, "button", "ordax-files-action", t("files.action.move"));
    move.type = "button";
    move.dataset.fileMoveToggle = "";
    move.disabled = itemBusy;
    const rename = node(documentObject, "button", "ordax-files-action", t("files.action.rename"));
    rename.type = "button";
    rename.dataset.fileRenameToggle = "";
    rename.disabled = itemBusy;
    const trash = node(documentObject, "button", "ordax-files-action", t("files.action.moveToTrash"));
    trash.type = "button";
    trash.dataset.fileTrashSelected = "";
    trash.disabled = itemBusy;
    const open = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      selected.kind === "directory" ? t("files.action.openFolder") : t("files.action.previewText"),
    );
    open.type = "button";
    open.dataset.fileActivateSelected = "";
    open.disabled = itemBusy;
    if (duplicate) actions.append(duplicate);
    if (copyTo) actions.append(copyTo);
    if (exportFile) actions.append(exportFile);
    if (createNote) actions.append(createNote);
    actions.append(move, rename, trash, open);

    details.append(summary, actions);
    container.append(details);

    if (copyingPath === selected.path && selected.kind === "file") {
      const form = node(documentObject, "div", "ordax-files-copy");
      const input = node(documentObject, "input", "ordax-files-copy-input");
      input.type = "text";
      input.maxLength = 255;
      input.autocomplete = "off";
      input.value = copyDraft;
      input.dataset.fileCopyName = "";
      input.setAttribute("aria-label", t("files.form.copyNameAria", { name: selected.name }));

      const confirm = node(
        documentObject,
        "button",
        "ordax-files-action ordax-files-action-primary",
        t("files.form.copyCreate"),
      );
      confirm.type = "button";
      confirm.dataset.fileCopyConfirm = "";
      confirm.disabled = pending;

      const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
      cancel.type = "button";
      cancel.dataset.fileCopyCancel = "";
      cancel.disabled = pending;

      form.append(input, confirm, cancel);
      container.append(form);
    }

    if (renamingPath === selected.path) {
      const form = node(documentObject, "div", "ordax-files-rename");
      const input = node(documentObject, "input", "ordax-files-rename-input");
      input.type = "text";
      input.maxLength = 255;
      input.autocomplete = "off";
      input.value = renameDraft;
      input.dataset.fileRenameName = "";
      input.setAttribute("aria-label", t("files.form.renameAria", { name: selected.name }));

      const confirm = node(
        documentObject,
        "button",
        "ordax-files-action ordax-files-action-primary",
        t("files.form.saveName"),
      );
      confirm.type = "button";
      confirm.dataset.fileRenameConfirm = "";
      confirm.disabled = pending;

      const cancel = node(documentObject, "button", "ordax-files-action", t("files.form.cancel"));
      cancel.type = "button";
      cancel.dataset.fileRenameCancel = "";
      cancel.disabled = pending;

      form.append(input, confirm, cancel);
      container.append(form);
    }
  };

  const renderTextPreview = (container) => {
    if (!previewPending && !textPreview) return;
    const preview = node(documentObject, "section", "ordax-files-preview");
    preview.setAttribute("aria-label", t("files.preview.aria"));

    if (previewPending) {
      const loading = node(documentObject, "div", "ordax-files-preview-loading", t("files.preview.opening"));
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-live", "polite");
      preview.append(loading);
      container.append(preview);
      return;
    }

    const header = node(documentObject, "header", "ordax-files-preview-header");
    const identity = node(documentObject, "div", "ordax-files-preview-identity");
    const parts = textPreview.path.split("/");
    const name = parts[parts.length - 1] || textPreview.path;
    identity.append(
      node(documentObject, "strong", "ordax-files-preview-title", name),
      node(documentObject, "span", "ordax-files-preview-meta", t("files.preview.readOnly", { size: formatSize(textPreview.size) })),
    );
    const close = node(documentObject, "button", "ordax-files-action", t("files.preview.close"));
    close.type = "button";
    close.dataset.filePreviewClose = "";
    header.append(identity, close);

    const content = node(documentObject, "pre", "ordax-files-preview-content", textPreview.text);
    content.tabIndex = 0;
    const note = node(
      documentObject,
      "p",
      "ordax-files-preview-note",
      t("files.preview.boundary"),
    );
    preview.append(header, content, note);
    container.append(preview);
  };

  const visibleRecentEntries = () => {
    const entries = recentSnapshot?.entries ?? [];
    const query = recentSearchQuery.trim().toLocaleLowerCase(locale());
    if (!query) return [...entries];
    return entries.filter((entry) =>
      entry.name.toLocaleLowerCase(locale()).includes(query)
      || entry.path.toLocaleLowerCase(locale()).includes(query),
    );
  };

  const selectedRecentEntry = () =>
    recentSnapshot?.entries.find((entry) => entry.path === selectedRecentPath) ?? null;

  const renderRecentEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    list.setAttribute("aria-label", t("files.recents.aria"));
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      node(documentObject, "span", "", t("files.column.name")),
      node(documentObject, "span", "", t("files.column.type")),
      node(documentObject, "span", "", t("files.column.location")),
      node(documentObject, "span", "", t("files.column.opened")),
    );
    list.append(header);

    const allEntries = recentSnapshot?.entries ?? [];
    const entries = visibleRecentEntries();
    if (allEntries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          t("files.recents.empty"),
        ),
      );
      container.append(list);
      return;
    }
    if (entries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          t("files.recents.emptySearch"),
        ),
      );
      container.append(list);
      return;
    }

    for (const entry of entries) {
      const selected = selectedRecentPath === entry.path;
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      row.dataset.fileRecentPath = entry.path;
      row.dataset.kind = "file";
      row.dataset.selected = String(selected);
      row.setAttribute("aria-pressed", String(selected));
      row.setAttribute(
        "aria-label",
        t(selected ? "files.recents.rowSelected" : "files.recents.row", { name: entry.name }),
      );

      const nameCell = node(documentObject, "span", "ordax-file-name");
      const icon = node(documentObject, "span", "ordax-file-icon");
      icon.dataset.kind = "file";
      icon.setAttribute("aria-hidden", "true");
      nameCell.append(icon, node(documentObject, "span", "", entry.name));
      row.append(
        nameCell,
        node(documentObject, "span", "ordax-file-meta", t("files.kind.file")),
        node(documentObject, "span", "ordax-file-meta", parentPath(entry.path)),
        node(documentObject, "span", "ordax-file-meta", formatModifiedAt(entry.openedAt, locale())),
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderRecentDetails = (container) => {
    const selected = selectedRecentEntry();
    if (!selected) return;
    const details = node(documentObject, "section", "ordax-files-details");
    details.setAttribute("aria-label", t("files.recents.detailsAria"));
    const summary = node(documentObject, "div", "ordax-files-details-summary");
    summary.append(
      node(documentObject, "strong", "ordax-files-details-title", selected.name),
      node(documentObject, "span", "ordax-files-details-meta", t("files.recents.openedBy")),
      node(documentObject, "span", "ordax-files-details-path", selected.path),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        t("files.recents.openedAt", { date: formatModifiedAt(selected.openedAt, locale()) }),
      ),
    );
    const actions = node(documentObject, "div", "ordax-files-details-actions");
    const open = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      t("files.recents.open"),
    );
    open.type = "button";
    open.dataset.fileRecentOpen = "";
    open.disabled = previewPending;
    const reveal = node(documentObject, "button", "ordax-files-action", t("files.recents.reveal"));
    reveal.type = "button";
    reveal.dataset.fileRecentReveal = "";
    reveal.disabled = pending || previewPending;
    const remove = node(documentObject, "button", "ordax-files-action", t("files.recents.remove"));
    remove.type = "button";
    remove.dataset.fileRecentRemove = "";
    remove.disabled = previewPending;
    actions.append(open, reveal, remove);
    details.append(summary, actions);
    container.append(details);
  };

  const renderRecentContent = (content) => {
    const toolbar = node(documentObject, "header", "ordax-files-toolbar");
    const title = node(documentObject, "div", "ordax-files-breadcrumb");
    title.append(node(documentObject, "strong", "", t("files.location.recents")));

    const search = node(documentObject, "div", "ordax-files-search");
    const searchInput = node(documentObject, "input", "ordax-files-search-input");
    searchInput.type = "search";
    searchInput.maxLength = 120;
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = t("files.search.recents.placeholder");
    searchInput.value = recentSearchQuery;
    searchInput.dataset.fileRecentSearch = "";
    searchInput.setAttribute("aria-label", t("files.search.recents.aria"));
    search.append(searchInput);
    if (recentSearchQuery) {
      const clearSearch = node(documentObject, "button", "ordax-files-search-clear", t("files.action.clear"));
      clearSearch.type = "button";
      clearSearch.dataset.fileRecentSearchClear = "";
      search.append(clearSearch);
    }

    const actions = node(documentObject, "div", "ordax-files-actions");
    const clearHistory = node(documentObject, "button", "ordax-files-action", t("files.recents.clearHistory"));
    clearHistory.type = "button";
    clearHistory.dataset.fileRecentClear = "";
    clearHistory.disabled = (recentSnapshot?.entries.length ?? 0) === 0 || previewPending;
    actions.append(clearHistory);
    toolbar.append(title, search, actions);
    content.append(toolbar);

    const allEntries = recentSnapshot?.entries ?? [];
    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      t("files.recents.status", {
        prefix: recentSearchQuery ? `${visibleRecentEntries().length} / ` : "",
        count: allEntries.length,
        unit: allEntries.length === 1 ? t("files.recents.file") : t("files.recents.files"),
        persistence: recentSnapshot?.persistence === "device"
          ? t("files.recents.persisted")
          : t("files.recents.session"),
      }),
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);
    {
      const currentMessage = renderedMessage();
      if (currentMessage) {
        content.append(node(documentObject, "p", "ordax-files-message", currentMessage));
      }
    }
    renderRecentEntries(content);
    renderRecentDetails(content);
    renderTextPreview(content);
    content.append(
      node(
        documentObject,
        "p",
        "ordax-files-boundary",
        t("files.recents.boundary"),
      ),
    );
  };

  const selectedTrashEntry = () =>
    trashListing?.entries.find((entry) => entry.id === selectedTrashId) ?? null;

  const renderTrashEntries = (container) => {
    const list = node(documentObject, "div", "ordax-files-list");
    list.setAttribute("aria-label", t("files.trash.aria"));
    const header = node(documentObject, "div", "ordax-files-list-header");
    header.append(
      node(documentObject, "span", "", t("files.column.name")),
      node(documentObject, "span", "", t("files.column.type")),
      node(documentObject, "span", "", t("files.column.origin")),
      node(documentObject, "span", "", t("files.column.removed")),
    );
    list.append(header);

    const entries = trashListing?.entries ?? [];
    if (entries.length === 0) {
      list.append(
        node(
          documentObject,
          "div",
          "ordax-files-empty",
          pending ? t("files.trash.reading") : t("files.trash.empty"),
        ),
      );
      container.append(list);
      return;
    }

    for (const entry of entries) {
      const selected = selectedTrashId === entry.id;
      const row = node(documentObject, "button", "ordax-file-row");
      row.type = "button";
      row.dataset.fileTrashId = entry.id;
      row.dataset.kind = entry.kind;
      row.dataset.selected = String(selected);
      row.setAttribute("aria-pressed", String(selected));
      const localizedKind = entry.kind === "directory"
        ? t("files.kind.folderLower")
        : t("files.kind.fileLower");
      row.setAttribute(
        "aria-label",
        t(selected ? "files.trash.rowSelected" : "files.trash.row", {
          name: entry.name,
          kind: localizedKind,
        }),
      );

      const nameCell = node(documentObject, "span", "ordax-file-name");
      const icon = node(documentObject, "span", "ordax-file-icon");
      icon.dataset.kind = entry.kind;
      icon.setAttribute("aria-hidden", "true");
      nameCell.append(icon, node(documentObject, "span", "", entry.name));
      row.append(
        nameCell,
        node(
          documentObject,
          "span",
          "ordax-file-meta",
          entry.kind === "directory" ? t("files.kind.folder") : formatSize(entry.size),
        ),
        node(documentObject, "span", "ordax-file-meta", parentPath(entry.originalPath)),
        node(documentObject, "span", "ordax-file-meta", formatModifiedAt(entry.trashedAt, locale())),
      );
      list.append(row);
    }
    container.append(list);
  };

  const renderTrashDetails = (container) => {
    const selected = selectedTrashEntry();
    if (!selected) return;
    const details = node(documentObject, "section", "ordax-files-details");
    details.setAttribute("aria-label", t("files.trash.detailsAria"));
    const summary = node(documentObject, "div", "ordax-files-details-summary");
    summary.append(
      node(documentObject, "strong", "ordax-files-details-title", selected.name),
      node(
        documentObject,
        "span",
        "ordax-files-details-meta",
        selected.kind === "directory"
          ? t("files.trash.folderRecoverable")
          : t("files.trash.fileRecoverable", { size: formatSize(selected.size) }),
      ),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        t("files.trash.origin", { path: selected.originalPath }),
      ),
      node(
        documentObject,
        "span",
        "ordax-files-details-path",
        t("files.trash.movedAt", { date: formatModifiedAt(selected.trashedAt, locale()) }),
      ),
    );
    const actions = node(documentObject, "div", "ordax-files-details-actions");
    const restore = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      pending ? t("files.trash.restoring") : t("files.trash.restore"),
    );
    restore.type = "button";
    restore.dataset.fileTrashRestore = "";
    restore.disabled = pending;
    actions.append(restore);
    details.append(summary, actions);
    container.append(details);
  };

  const renderTrashContent = (content) => {
    const toolbar = node(documentObject, "header", "ordax-files-toolbar");
    const title = node(documentObject, "div", "ordax-files-breadcrumb");
    title.append(node(documentObject, "strong", "", t("files.location.trash")));
    const actions = node(documentObject, "div", "ordax-files-actions");
    const refresh = node(
      documentObject,
      "button",
      "ordax-files-action",
      pending ? t("files.action.refreshing") : t("files.action.refresh"),
    );
    refresh.type = "button";
    refresh.dataset.fileTrashRefresh = "";
    refresh.disabled = pending;
    actions.append(refresh);
    toolbar.append(title, actions);
    content.append(toolbar);

    const count = trashListing?.entries.length ?? 0;
    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      pending
        ? t("files.trash.statusUpdating")
        : t("files.trash.status", {
            count,
            unit: count === 1 ? t("files.trash.item") : t("files.trash.items"),
          }),
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);
    {
      const currentMessage = renderedMessage();
      if (currentMessage) {
        content.append(node(documentObject, "p", "ordax-files-message", currentMessage));
      }
    }
    renderTrashEntries(content);
    renderTrashDetails(content);
    content.append(
      node(
        documentObject,
        "p",
        "ordax-files-boundary",
        t("files.trash.boundary"),
      ),
    );
  };

  const createProject = async () => {
    if (!projectMutationPort || !listing || listing.path === "/" || pending) return;
    try {
      projectSnapshot = await projectMutationPort.create({ name: projectDraft, path: listing.path });
      if (destroyed) return;
      creatingProject = false;
      projectDraft = "";
      setMessage("files.project.added");
    } catch {
      if (destroyed) return;
      setMessage("files.project.addFailed");
    }
    replaceView();
  };

  const renameProject = async () => {
    if (!projectMutationPort || !renamingProjectId || !listing) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === renamingProjectId);
    if (!project || project.path !== listing.path) {
      renamingProjectId = null;
      projectRenameDraft = "";
      setMessage("files.project.unavailableHere");
      replaceView();
      return;
    }
    try {
      projectSnapshot = await projectMutationPort.rename(renamingProjectId, projectRenameDraft);
      if (destroyed) return;
      const renamed = projectSnapshot.projects.find((candidate) => candidate.id === project.id);
      renamingProjectId = null;
      projectRenameDraft = "";
      setMessage("files.project.renamed", { name: renamed?.name ?? project.name, path: project.path });
    } catch {
      if (destroyed) return;
      setMessage("files.project.renameFailed");
    }
    replaceView();
  };

  const openProject = async (projectId) => {
    if (!projectReader || !projectMutationPort) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    const loaded = await load(project.path);
    if (destroyed) return;
    if (!loaded) {
      setMessage("files.project.folderUnavailable");
      replaceView();
      return;
    }
    try {
      projectSnapshot = await projectMutationPort.recordOpened(projectId);
      if (destroyed) return;
    } catch {
      if (destroyed) return;
      setMessage("files.project.activityUpdateFailed");
      replaceView();
    }
  };

  const removeProject = async (projectId) => {
    if (!projectMutationPort) return;
    try {
      projectSnapshot = await projectMutationPort.remove(projectId);
      if (destroyed) return;
      if (renamingProjectId === projectId) {
        renamingProjectId = null;
        projectRenameDraft = "";
      }
      if (failedProjectResume?.projectId === projectId) {
        failedProjectResume = null;
      }
      setMessage("files.project.removed");
    } catch {
      if (destroyed) return;
      setMessage("files.project.removeFailed");
    }
    replaceView();
  };

  const clearFailedProjectResume = async (projectId) => {
    if (!projectMutationPort || !failedProjectResume || failedProjectResume.projectId !== projectId) return;
    const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
    if (!project || project.lastFilePath !== failedProjectResume.path) {
      failedProjectResume = null;
      setMessage("files.project.lastFileChanged");
      replaceView();
      return;
    }
    try {
      projectSnapshot = await projectMutationPort.clearLastFile(projectId);
      if (destroyed) return;
      failedProjectResume = null;
      setMessage("files.project.lastFileForgotten");
    } catch {
      if (destroyed) return;
      setMessage("files.project.lastFileForgetFailed");
    }
    replaceView();
  };

  const enterRecentMode = () => {
    if (!recentPort) return;
    requestOrdinal += 1;
    pending = false;
    trashMode = false;
    selectedTrashId = null;
    recentMode = true;
    selectedRecentPath = null;
    clearMessage();
    transferEntry = null;
    creatingDirectory = false;
    creatingProject = false;
    projectDraft = "";
    renamingProjectId = null;
    projectRenameDraft = "";
    failedProjectResume = null;
    renamingPath = null;
    copyingPath = null;
    previewRequestOrdinal += 1;
    previewPending = false;
    textPreview = null;
    replaceView();
  };

  const enterTrashMode = async () => {
    const ordinal = ++requestOrdinal;
    recentMode = false;
    selectedRecentPath = null;
    trashMode = true;
    selectedTrashId = null;
    pending = true;
    clearMessage();
    transferEntry = null;
    creatingDirectory = false;
    creatingProject = false;
    projectDraft = "";
    renamingProjectId = null;
    projectRenameDraft = "";
    failedProjectResume = null;
    renamingPath = null;
    renameDraft = "";
    copyingPath = null;
    copyDraft = "";
    previewRequestOrdinal += 1;
    previewPending = false;
    textPreview = null;
    replaceView();
    try {
      const next = validateTrashListing(await port.listTrash());
      if (destroyed || ordinal !== requestOrdinal) return false;
      trashListing = next;
      return true;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return false;
      trashListing = null;
      setMessage("files.trash.openFailed");
      return false;
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const revealRecent = async () => {
    const selected = selectedRecentEntry();
    if (!selected) return;
    const targetPath = selected.path;
    recentMode = false;
    selectedRecentPath = null;
    previewRequestOrdinal += 1;
    previewPending = false;
    textPreview = null;
    const loaded = await load(parentPath(targetPath));
    if (destroyed || !loaded) return;
    const exists = listing?.entries.some(
      (entry) => joinPath(listing.path, entry.name) === targetPath,
    );
    if (exists) {
      selectPath(targetPath, { focus: true });
      return;
    }
    selectedPath = null;
    setMessage("files.recents.revealMissing");
    replaceView();
  };

  const paint = (slot, interaction = null) => {
    slot.replaceChildren();
    slot.dataset.ordaxFileSpaceView = "";
    slot.dataset.fileSpacePath = recentMode || trashMode ? "" : (listing?.path ?? "");
    slot.dataset.fileSpaceContext = interactionContext();

    const view = node(documentObject, "div", "ordax-files-view");
    const locations = node(documentObject, "nav", "ordax-files-locations");
    locations.setAttribute("aria-label", t("files.location.aria"));
    renderLocations(locations);

    const content = node(documentObject, "section", "ordax-files-content");
    if (trashMode) {
      renderTrashContent(content);
      view.append(locations, content);
      slot.append(view);
      restoreInteractionState(slot, interaction);
      return;
    }
    if (recentMode) {
      renderRecentContent(content);
      view.append(locations, content);
      slot.append(view);
      restoreInteractionState(slot, interaction);
      return;
    }
    const toolbar = node(documentObject, "header", "ordax-files-toolbar");
    const navigation = node(documentObject, "div", "ordax-files-navigation");

    const back = node(documentObject, "button", "ordax-files-nav-action", "←");
    back.type = "button";
    back.dataset.fileHistoryBack = "";
    back.setAttribute("aria-label", t("files.nav.back"));
    back.title = t("files.nav.back");
    back.disabled = pending || !canGoBack();

    const forward = node(documentObject, "button", "ordax-files-nav-action", "→");
    forward.type = "button";
    forward.dataset.fileHistoryForward = "";
    forward.setAttribute("aria-label", t("files.nav.forward"));
    forward.title = t("files.nav.forward");
    forward.disabled = pending || !canGoForward();

    const up = node(documentObject, "button", "ordax-files-nav-action", "↑");
    up.type = "button";
    up.dataset.fileHistoryUp = "";
    up.setAttribute("aria-label", t("files.nav.up"));
    up.title = t("files.nav.up");
    up.disabled = pending || !listing || listing.path === "/";

    navigation.append(back, forward, up);

    const breadcrumb = node(documentObject, "nav", "ordax-files-breadcrumb");
    breadcrumb.setAttribute("aria-label", t("files.nav.currentPath"));
    renderBreadcrumb(breadcrumb);

    const search = node(documentObject, "div", "ordax-files-search");
    const searchInput = node(documentObject, "input", "ordax-files-search-input");
    searchInput.type = "search";
    searchInput.maxLength = 120;
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.placeholder = t("files.search.folder.placeholder");
    searchInput.value = searchQuery;
    searchInput.dataset.fileSearch = "";
    searchInput.disabled = pending || !listing;
    searchInput.setAttribute("aria-label", t("files.search.folder.aria"));
    search.append(searchInput);
    if (searchQuery) {
      const clearSearch = node(documentObject, "button", "ordax-files-search-clear", t("files.action.clear"));
      clearSearch.type = "button";
      clearSearch.dataset.fileSearchClear = "";
      clearSearch.disabled = pending;
      search.append(clearSearch);
    }

    const actions = node(documentObject, "div", "ordax-files-actions");
    const refresh = node(
      documentObject,
      "button",
      "ordax-files-action",
      pending ? t("files.action.refreshing") : t("files.action.refresh"),
    );
    refresh.type = "button";
    refresh.dataset.fileRefresh = "";
    refresh.disabled = pending;

    const importFile = node(documentObject, "button", "ordax-files-action", t("files.action.import"));
    importFile.type = "button";
    importFile.dataset.fileImportToggle = "";
    importFile.disabled = pending || !listing;

    const importPicker = node(documentObject, "input", "ordax-files-import-picker");
    importPicker.type = "file";
    importPicker.multiple = false;
    importPicker.hidden = true;
    importPicker.dataset.fileImportPicker = "";
    importPicker.setAttribute("aria-label", t("files.action.importPicker"));

    const addProject = node(documentObject, "button", "ordax-files-action", t("files.action.addProject"));
    addProject.type = "button";
    addProject.dataset.fileProjectCreateStart = "";
    addProject.disabled = Boolean(
      pending
      || !projectReader
      || !projectMutationPort
      || !listing
      || listing.path === "/"
      || projectSnapshot?.projects.some((project) => project.path === listing.path)
    );
    const create = node(
      documentObject,
      "button",
      "ordax-files-action ordax-files-action-primary",
      t("files.action.newFolder"),
    );
    create.type = "button";
    create.dataset.fileCreateToggle = "";
    create.disabled = pending || !listing;
    actions.append(refresh, importFile, addProject);
    const currentProject = projectSnapshot?.projects.find((project) => project.path === listing?.path);
    if (currentProject) {
      if (currentProject.lastFilePath) {
        const resumeProjectButton = node(
          documentObject,
          "button",
          "ordax-files-action ordax-files-action-primary",
          t("files.action.resumeProject"),
        );
        resumeProjectButton.type = "button";
        resumeProjectButton.dataset.fileProjectResume = currentProject.id;
        resumeProjectButton.disabled = pending || previewPending;
        resumeProjectButton.title = currentProject.lastFilePath;
        actions.append(resumeProjectButton);
        if (
          failedProjectResume?.projectId === currentProject.id
          && failedProjectResume.path === currentProject.lastFilePath
        ) {
          const forgetProjectButton = node(
            documentObject,
            "button",
            "ordax-files-action",
            t("files.action.forgetProject"),
          );
          forgetProjectButton.type = "button";
          forgetProjectButton.dataset.fileProjectForgetStale = currentProject.id;
          forgetProjectButton.disabled = pending || previewPending;
          forgetProjectButton.title = t("files.action.forgetProjectTitle");
          actions.append(forgetProjectButton);
        }
      }
      const renameProjectButton = node(
        documentObject,
        "button",
        "ordax-files-action",
        t("files.action.renameProject"),
      );
      renameProjectButton.type = "button";
      renameProjectButton.dataset.fileProjectRenameStart = currentProject.id;
      renameProjectButton.disabled = pending;
      const removeProjectButton = node(
        documentObject,
        "button",
        "ordax-files-action",
        t("files.action.removeProject"),
      );
      removeProjectButton.type = "button";
      removeProjectButton.dataset.fileProjectRemove = currentProject.id;
      removeProjectButton.disabled = pending;
      actions.append(renameProjectButton, removeProjectButton);
    }
    actions.append(create, importPicker);
    toolbar.append(navigation, breadcrumb, search, actions);
    content.append(toolbar);

    const status = node(
      documentObject,
      "div",
      "ordax-files-status",
      pending
        ? t("files.status.updating")
        : listing
          ? normalizedSearchQuery()
            ? t("files.status.countSearch", {
                visible: visibleEntries().length,
                total: listing.entries.length,
              })
            : t("files.status.count", {
                count: listing.entries.length,
                unit: listing.entries.length === 1
                  ? t("files.status.item")
                  : t("files.status.items"),
              })
          : t("files.status.preparing"),
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    content.append(status);

    renderTransferOperation(content);
    renderCreateDirectory(content);
    renderCreateProject(content);
    renderRenameProject(content);
    {
      const currentMessage = renderedMessage();
      if (currentMessage) {
        content.append(node(documentObject, "p", "ordax-files-message", currentMessage));
      }
    }
    renderEntries(content);
    renderSelectionDetails(content);
    renderTextPreview(content);
    content.append(
      node(
        documentObject,
        "p",
        "ordax-files-boundary",
        t("files.boundary.userSpace"),
      ),
    );

    view.append(locations, content);
    slot.append(view);
    restoreInteractionState(slot, interaction);
  };

  const renderView = (force = false) => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }
    if (!force && slot === mountedSlot) return;
    const interaction =
      force && slot === mountedSlot ? captureInteractionState(slot) : null;
    mountedSlot = slot;
    paint(slot, interaction);
  };

  const replaceView = () => renderView(true);

  const load = async (path, { recordHistory = true } = {}) => {
    recentMode = false;
    selectedRecentPath = null;
    trashMode = false;
    selectedTrashId = null;
    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateFileListing(await port.list(path));
      if (destroyed || ordinal !== requestOrdinal) return false;
      lifecycle.setAppTarget("files", next.path);
      const changedPath = Boolean(listing && listing.path !== next.path);
      if (changedPath) {
        searchQuery = "";
        selectedPath = null;
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        creatingDirectory = false;
        directoryDraft = "";
        creatingProject = false;
        projectDraft = "";
        renamingProjectId = null;
        projectRenameDraft = "";
        failedProjectResume = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      listing = next;
      if (recordHistory) recordNavigation(next.path);
      if (
        selectedPath &&
        !listing.entries.some((entry) => joinPath(listing.path, entry.name) === selectedPath)
      ) {
        selectedPath = null;
      }
      return true;
    } catch {
      if (destroyed || ordinal !== requestOrdinal) return false;
      setMessage("files.location.openFailed");
      return false;
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const navigateHistory = async (targetIndex) => {
    if (
      pending ||
      targetIndex < 0 ||
      targetIndex >= navigationHistory.length ||
      targetIndex === navigationIndex
    ) {
      return;
    }
    const targetPath = navigationHistory[targetIndex];
    const previousIndex = navigationIndex;
    const loaded = await load(targetPath, { recordHistory: false });
    if (destroyed) return;
    if (loaded) {
      navigationIndex = targetIndex;
    } else {
      navigationIndex = previousIndex;
    }
    replaceView();
  };

  const openTextFile = async (path, { source = "direct", projectId = null } = {}) => {
    const ordinal = ++previewRequestOrdinal;
    failedProjectResume = null;
    previewPending = true;
    textPreview = null;
    clearMessage();
    replaceView();
    try {
      const next = validateTextFile(await port.readTextFile(path));
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      textPreview = next;
      if (recentPort) recentPort.recordOpened(next.path);
      const project = projectForFilePath(next.path);
      if (projectMutationPort && project) {
        try {
          projectSnapshot = await projectMutationPort.recordFileOpened(project.id, next.path);
          if (destroyed || ordinal !== previewRequestOrdinal) return;
        } catch {
          if (destroyed || ordinal !== previewRequestOrdinal) return;
          setMessage("files.preview.projectActivityFailed");
        }
      }
    } catch (error) {
      if (destroyed || ordinal !== previewRequestOrdinal) return;
      const status = operationStatus(error);
      if (source === "project-resume") {
        const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
        if (project?.lastFilePath === path && project.path === listing?.path) {
          failedProjectResume = Object.freeze({ projectId: project.id, path });
        }
        if (status === 404) {
          setMessage("files.preview.projectResumeMissing");
        } else if (status === 413) {
          setMessage("files.preview.projectResumeTooLarge");
        } else if (status === 415) {
          setMessage("files.preview.projectResumeInvalidUtf8");
        } else {
          setMessage("files.preview.projectResumeFailed");
        }
      } else if (status === 413) {
        setMessage("files.preview.tooLarge");
      } else if (status === 415) {
        setMessage("files.preview.invalidUtf8");
      } else {
        setMessage("files.preview.failed");
      }
    } finally {
      if (!destroyed && ordinal === previewRequestOrdinal) {
        previewPending = false;
        replaceView();
      }
    }
  };

  const activateSelectedPath = () => {
    const selected = selectedEntry();
    if (!selected) return;
    if (selected.kind === "directory") {
      void load(selected.path);
    } else {
      void openTextFile(selected.path);
    }
  };

  const createNoteFromSelected = async () => {
    const selected = selectedEntry();
    if (!notesImporterPort || !selected || selected.kind !== "file" || notesImportPending) return;
    const source = Object.freeze({ kind: "file", path: selected.path, name: selected.name });
    notesImportPending = true;
    clearMessage();
    replaceView();
    try {
      const outcome = await importSelectedFileToNotes(notesImporterPort, source);
      if (destroyed) return;
      setMessage(outcome.presentation.messageId, outcome.presentation.messageParams);
      if (outcome.presentation.openNotes && activationPort) {
        activationPort.publish({ appId: "notes", target: null });
      }
    } catch {
      if (destroyed) return;
      setMessage("files.notes.createFailed");
    } finally {
      if (!destroyed) {
        notesImportPending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const transferToCurrentDirectory = async () => {
    if (!transferEntry || !listing) return;
    const destination = transferDestinationState();
    if (!destination.allowed) {
      setMessage(destination.reasonMessageId);
      replaceView();
      return;
    }

    const source = transferEntry;
    const destinationPath = listing.path;
    const nextPath = joinPath(destinationPath, source.name);
    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const operation =
        source.mode === "copy"
          ? port.copyFile(
              source.sourcePath,
              source.name,
              destinationPath,
              source.name,
            )
          : port.moveEntry(source.sourcePath, source.name, destinationPath);
      const next = validateFileListing(await operation);
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      if (source.mode === "move" && recentPort) {
        recentPort.relocate(source.sourceFullPath, nextPath);
      }
      transferEntry = null;
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      copyingPath = null;
      copyDraft = "";
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      setMessage(
        source.mode === "copy" ? "files.transfer.copied" : "files.transfer.moved",
        { name: source.name, path: destinationPath },
      );
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.transfer.conflict");
      } else if (status === 412) {
        setMessage(source.mode === "copy" ? "files.transfer.sourceChangedCopy" : "files.transfer.sourceChangedMove");
      } else if (status === 413) {
        setMessage(source.mode === "copy" ? "files.copy.tooLarge" : "files.transfer.moveCrossVolumeTooLarge");
      } else if (status === 422) {
        setMessage("files.transfer.folderCrossVolumeUnsupported");
      } else if (status === 507) {
        setMessage("files.transfer.noSpace");
      } else if (status === 404) {
        setMessage("files.transfer.missing");
      } else if (status === 403) {
        setMessage(source.mode === "copy" ? "files.copy.forbidden" : "files.transfer.moveForbidden");
      } else if (status === 400) {
        setMessage(source.mode === "copy" ? "files.transfer.invalidCopyDestination" : "files.transfer.invalidMoveDestination");
      } else {
        setMessage(source.mode === "copy" ? "files.transfer.copyFailed" : "files.transfer.moveFailed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const importSelectedFile = async (file) => {
    if (!listing || !file) return;
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      setMessage("files.import.invalidSize");
      replaceView();
      return;
    }
    if (file.size > MAX_FILE_IMPORT_BYTES) {
      setMessage("files.import.tooLarge");
      replaceView();
      return;
    }
    if (typeof file.name !== "string" || file.name.length === 0 || file.name.length > 255) {
      setMessage("files.import.invalidName");
      replaceView();
      return;
    }

    const targetPath = listing.path;
    const targetName = file.name;
    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const buffer = await file.arrayBuffer();
      if (destroyed || ordinal !== requestOrdinal) return;
      if (buffer.byteLength !== file.size) {
        throw new TypeError("Selected file size changed while reading");
      }
      const next = validateFileListing(
        await port.importFile(targetPath, targetName, new Uint8Array(buffer)),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      selectedPath = joinPath(targetPath, targetName);
      if (!selectionIsVisible()) selectedPath = null;
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      setMessage("files.import.imported", { name: targetName, path: targetPath });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.common.conflict");
      } else if (status === 413) {
        setMessage("files.import.tooLarge");
      } else if (status === 403) {
        setMessage("files.import.forbidden");
      } else if (status === 404) {
        setMessage("files.import.destinationMissing");
      } else if (status === 507) {
        setMessage("files.import.noSpace");
      } else if (status === 400) {
        setMessage("files.import.invalid");
      } else {
        setMessage("files.import.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const trashSelected = async () => {
    const selected = selectedEntry();
    if (!selected || !listing || pending) return;
    const ordinal = ++requestOrdinal;
    const previousPath = selected.path;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateFileListing(
        await port.trashEntry(listing.path, selected.name),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      if (recentPort) {
        for (const recent of recentSnapshot?.entries ?? []) {
          if (
            recent.path === previousPath
            || recent.path.startsWith(`${previousPath}/`)
          ) {
            recentPort.remove(recent.path);
          }
        }
      }
      trashListing = null;
      selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      copyingPath = null;
      copyDraft = "";
      transferEntry = null;
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      setMessage("files.trash.moved", { name: selected.name });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 422) {
        setMessage("files.trash.crossVolume");
      } else if (status === 404) {
        setMessage("files.common.missing");
      } else if (status === 403) {
        setMessage("files.trash.forbidden");
      } else if (status === 409) {
        setMessage("files.trash.reservationFailed");
      } else if (status === 400) {
        setMessage("files.trash.invalid");
      } else {
        setMessage("files.trash.moveFailed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const restoreSelectedTrash = async () => {
    const selected = selectedTrashEntry();
    if (!selected || pending) return;
    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateTrashListing(await port.restoreTrashEntry(selected.id));
      if (destroyed || ordinal !== requestOrdinal) return;
      trashListing = next;
      selectedTrashId = null;
      setMessage("files.trash.restored", { name: selected.name, path: selected.originalPath });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.trash.restoreConflict");
      } else if (status === 404) {
        setMessage("files.trash.restoreMissing");
      } else if (status === 422) {
        setMessage("files.trash.restoreCrossVolume");
      } else if (status === 403) {
        setMessage("files.trash.restoreForbidden");
      } else if (status === 400) {
        setMessage("files.trash.restoreInvalid");
      } else {
        setMessage("files.trash.restoreFailed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const exportSelected = async () => {
    const selected = selectedEntry();
    if (!selected || selected.kind !== "file") return;
    if (selected.size > MAX_FILE_EXPORT_BYTES) {
      setMessage("files.export.tooLarge");
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      await port.exportFile(selected.path);
      if (destroyed || ordinal !== requestOrdinal) return;
      setMessage("files.export.started", { name: selected.name });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 413) {
        setMessage("files.export.tooLarge");
      } else if (status === 412) {
        setMessage("files.export.sourceChanged");
      } else if (status === 404) {
        setMessage("files.export.missing");
      } else if (status === 403) {
        setMessage("files.export.forbidden");
      } else if (status === 400) {
        setMessage("files.export.invalid");
      } else {
        setMessage("files.export.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const copySelected = async () => {
    const selected = selectedEntry();
    if (!selected || !listing || selected.kind !== "file") return;

    if (selected.size > MAX_FILE_COPY_BYTES) {
      setMessage("files.copy.tooLarge");
      copyingPath = null;
      copyDraft = "";
      replaceView();
      return;
    }

    const newName = String(copyDraft ?? "");
    if (!newName) {
      setMessage("files.copy.nameRequired");
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    const nextPath = joinPath(listing.path, newName);
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateFileListing(
        await port.copyFile(listing.path, selected.name, listing.path, newName),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      copyingPath = null;
      copyDraft = "";
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      setMessage("files.copy.created", { name: newName });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.common.conflict");
      } else if (status === 412) {
        setMessage("files.copy.sourceChanged");
      } else if (status === 413) {
        setMessage("files.copy.tooLarge");
      } else if (status === 507) {
        setMessage("files.copy.noSpace");
      } else if (status === 403) {
        setMessage("files.copy.forbidden");
      } else if (status === 404) {
        setMessage("files.copy.sourceMissing");
      } else if (status === 400) {
        setMessage("files.copy.invalidName");
      } else {
        setMessage("files.copy.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const renameSelected = async () => {
    const selected = selectedEntry();
    if (!selected || !listing) return;

    const newName = String(renameDraft ?? "");
    if (!newName) {
      setMessage("files.rename.nameRequired");
      replaceView();
      return;
    }
    if (newName === selected.name) {
      renamingPath = null;
      renameDraft = "";
      setMessage("files.rename.unchanged");
      replaceView();
      return;
    }

    const ordinal = ++requestOrdinal;
    const previousPath = selected.path;
    const nextPath = joinPath(listing.path, newName);
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateFileListing(
        await port.renameEntry(listing.path, selected.name, newName),
      );
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      if (recentPort) recentPort.relocate(previousPath, nextPath);
      selectedPath = nextPath;
      if (!selectionIsVisible()) selectedPath = null;
      renamingPath = null;
      renameDraft = "";
      if (textPreview?.path === previousPath) {
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      setMessage("files.rename.renamed", { oldName: selected.name, newName });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.common.conflict");
      } else if (status === 403) {
        setMessage("files.rename.forbidden");
      } else if (status === 404) {
        setMessage("files.common.missing");
      } else if (status === 400) {
        setMessage("files.rename.invalidName");
      } else {
        setMessage("files.rename.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
        focusSelectedRow();
      }
    }
  };

  const createDirectory = async (name) => {
    const trimmed = String(name ?? "").trim();
    if (!listing || !trimmed) {
      setMessage("files.directory.nameRequired");
      replaceView();
      return;
    }
    const ordinal = ++requestOrdinal;
    pending = true;
    clearMessage();
    replaceView();
    try {
      const next = validateFileListing(await port.createDirectory(listing.path, trimmed));
      if (destroyed || ordinal !== requestOrdinal) return;
      listing = next;
      creatingDirectory = false;
      directoryDraft = "";
      setMessage("files.directory.created", { name: trimmed });
    } catch (error) {
      if (destroyed || ordinal !== requestOrdinal) return;
      const status = operationStatus(error);
      if (status === 409) {
        setMessage("files.common.conflict");
      } else if (status === 403) {
        setMessage("files.directory.forbidden");
      } else if (status === 507) {
        setMessage("files.directory.noSpace");
      } else if (status === 400) {
        setMessage("files.directory.invalidName");
      } else {
        setMessage("files.directory.failed");
      }
    } finally {
      if (!destroyed && ordinal === requestOrdinal) {
        pending = false;
        replaceView();
      }
    }
  };

  const onClick = (event) => {
    const projectLocation = event.target.closest("[data-file-open-project]");
    if (projectLocation && root.contains(projectLocation) && projectReader) {
      void openProject(projectLocation.dataset.fileOpenProject);
      return;
    }
    const projectStart = event.target.closest("[data-file-project-create-start]");
    if (projectStart && root.contains(projectStart) && projectReader && projectMutationPort && listing && listing.path !== "/") {
      creatingProject = true;
      projectDraft = breadcrumbParts(listing.path).at(-1) ?? t("files.project.defaultName");
      renamingProjectId = null;
      projectRenameDraft = "";
      clearMessage();
      requestFocus("project-name");
      replaceView();
      return;
    }
    const projectCreate = event.target.closest("[data-file-project-create]");
    if (projectCreate && root.contains(projectCreate)) {
      void createProject();
      return;
    }
    const projectCancel = event.target.closest("[data-file-project-create-cancel]");
    if (projectCancel && root.contains(projectCancel)) {
      creatingProject = false;
      projectDraft = "";
      clearMessage();
      replaceView();
      return;
    }
    const projectResume = event.target.closest("[data-file-project-resume]");
    if (projectResume && root.contains(projectResume) && projectReader && listing && !previewPending) {
      const projectId = projectResume.dataset.fileProjectResume;
      const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
      if (project?.lastFilePath && project.path === listing.path) {
        void openTextFile(project.lastFilePath, { source: "project-resume", projectId: project.id });
      }
      return;
    }
    const projectForgetStale = event.target.closest("[data-file-project-forget-stale]");
    if (projectForgetStale && root.contains(projectForgetStale) && projectMutationPort && !previewPending) {
      void clearFailedProjectResume(projectForgetStale.dataset.fileProjectForgetStale);
      return;
    }
    const projectRenameStart = event.target.closest("[data-file-project-rename-start]");
    if (projectRenameStart && root.contains(projectRenameStart) && projectReader && projectMutationPort && listing) {
      const projectId = projectRenameStart.dataset.fileProjectRenameStart;
      const project = projectSnapshot?.projects.find((candidate) => candidate.id === projectId);
      if (project && project.path === listing.path) {
        creatingProject = false;
        projectDraft = "";
        renamingProjectId = project.id;
        projectRenameDraft = project.name;
        clearMessage();
        requestFocus("project-rename-name", project.id);
        replaceView();
      }
      return;
    }
    const projectRenameConfirm = event.target.closest("[data-file-project-rename-confirm]");
    if (projectRenameConfirm && root.contains(projectRenameConfirm)) {
      void renameProject();
      return;
    }
    const projectRenameCancel = event.target.closest("[data-file-project-rename-cancel]");
    if (projectRenameCancel && root.contains(projectRenameCancel)) {
      renamingProjectId = null;
      projectRenameDraft = "";
      clearMessage();
      replaceView();
      return;
    }
    const projectRemove = event.target.closest("[data-file-project-remove]");
    if (projectRemove && root.contains(projectRemove) && projectMutationPort) {
      void removeProject(projectRemove.dataset.fileProjectRemove);
      return;
    }
    const recentLocation = event.target.closest("[data-file-open-recent]");
    if (recentLocation && root.contains(recentLocation) && recentPort) {
      enterRecentMode();
      return;
    }
    const trashLocation = event.target.closest("[data-file-open-trash]");
    if (trashLocation && root.contains(trashLocation)) {
      void enterTrashMode();
      return;
    }
    const trashRefresh = event.target.closest("[data-file-trash-refresh]");
    if (trashRefresh && root.contains(trashRefresh) && trashMode && !pending) {
      void enterTrashMode();
      return;
    }
    const trashRow = event.target.closest("[data-file-trash-id]");
    if (trashRow && root.contains(trashRow) && trashMode) {
      selectedTrashId = trashRow.dataset.fileTrashId ?? null;
      clearMessage();
      replaceView();
      return;
    }
    const trashRestore = event.target.closest("[data-file-trash-restore]");
    if (trashRestore && root.contains(trashRestore) && trashMode) {
      void restoreSelectedTrash();
      return;
    }
    const recentRow = event.target.closest("[data-file-recent-path]");
    if (recentRow && root.contains(recentRow) && recentMode) {
      const path = recentRow.dataset.fileRecentPath;
      if (selectedRecentPath === path) {
        if (!previewPending) void openTextFile(path);
      } else {
        selectedRecentPath = path;
        clearMessage();
        if (textPreview?.path !== path) {
          previewRequestOrdinal += 1;
          previewPending = false;
          textPreview = null;
        }
        replaceView();
      }
      return;
    }
    const recentOpen = event.target.closest("[data-file-recent-open]");
    if (recentOpen && root.contains(recentOpen)) {
      const selected = selectedRecentEntry();
      if (selected && !previewPending) void openTextFile(selected.path);
      return;
    }
    const recentReveal = event.target.closest("[data-file-recent-reveal]");
    if (recentReveal && root.contains(recentReveal)) {
      void revealRecent();
      return;
    }
    const recentRemove = event.target.closest("[data-file-recent-remove]");
    if (recentRemove && root.contains(recentRemove) && recentPort) {
      const selected = selectedRecentEntry();
      if (selected) {
        setMessage("files.recents.removedMessage", { name: selected.name });
        selectedRecentPath = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
        recentPort.remove(selected.path);
        replaceView();
      }
      return;
    }
    const recentClear = event.target.closest("[data-file-recent-clear]");
    if (recentClear && root.contains(recentClear) && recentPort) {
      setMessage("files.recents.clearedMessage");
      selectedRecentPath = null;
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      recentPort.clear();
      replaceView();
      return;
    }
    const recentSearchClear = event.target.closest("[data-file-recent-search-clear]");
    if (recentSearchClear && root.contains(recentSearchClear)) {
      recentSearchQuery = "";
      clearMessage();
      requestFocus("recent-search");
      replaceView();
      return;
    }
    const sort = event.target.closest("[data-file-sort-key]");
    if (sort && root.contains(sort) && !pending) {
      changeSort(sort.dataset.fileSortKey);
      return;
    }
    const selected = event.target.closest("[data-file-select-path]");
    if (selected && root.contains(selected)) {
      if (selectedPath === selected.dataset.fileSelectPath) {
        activateSelectedPath();
      } else {
        selectPath(selected.dataset.fileSelectPath, { focus: true });
      }
      return;
    }
    const trashSelectedButton = event.target.closest("[data-file-trash-selected]");
    if (trashSelectedButton && root.contains(trashSelectedButton) && !trashMode && !recentMode) {
      void trashSelected();
      return;
    }
    const createNote = event.target.closest("[data-file-create-note]");
    if (createNote && root.contains(createNote)) {
      void createNoteFromSelected();
      return;
    }
    const exportFile = event.target.closest("[data-file-export]");
    if (exportFile && root.contains(exportFile)) {
      void exportSelected();
      return;
    }
    const copyToToggle = event.target.closest("[data-file-copy-to-toggle]");
    if (copyToToggle && root.contains(copyToToggle)) {
      const selected = selectedEntry();
      if (selected?.kind === "file" && listing) {
        if (selected.size > MAX_FILE_COPY_BYTES) {
          setMessage("files.copy.tooLarge");
        } else {
          transferEntry = Object.freeze({
            mode: "copy",
            sourcePath: listing.path,
            sourceFullPath: selected.path,
            name: selected.name,
            kind: selected.kind,
          });
          renamingPath = null;
          renameDraft = "";
          copyingPath = null;
          copyDraft = "";
          previewRequestOrdinal += 1;
          previewPending = false;
          textPreview = null;
          setMessage("files.transfer.navigateCopy");
        }
        replaceView();
      }
      return;
    }
    const moveToggle = event.target.closest("[data-file-move-toggle]");
    if (moveToggle && root.contains(moveToggle)) {
      const selected = selectedEntry();
      if (selected && listing) {
        transferEntry = Object.freeze({
          mode: "move",
          sourcePath: listing.path,
          sourceFullPath: selected.path,
          name: selected.name,
          kind: selected.kind,
        });
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
        setMessage("files.transfer.navigateMove");
        replaceView();
      }
      return;
    }
    const transferCancel = event.target.closest("[data-file-transfer-cancel]");
    if (transferCancel && root.contains(transferCancel)) {
      const wasCopy = transferEntry?.mode === "copy";
      transferEntry = null;
      setMessage(wasCopy ? "files.transfer.copyCancelled" : "files.transfer.moveCancelled");
      replaceView();
      return;
    }
    const transferConfirm = event.target.closest("[data-file-transfer-confirm]");
    if (transferConfirm && root.contains(transferConfirm)) {
      void transferToCurrentDirectory();
      return;
    }
    const copyToggle = event.target.closest("[data-file-copy-toggle]");
    if (copyToggle && root.contains(copyToggle)) {
      const selected = selectedEntry();
      if (selected?.kind === "file") {
        if (selected.size > MAX_FILE_COPY_BYTES) {
          setMessage("files.copy.tooLarge");
          replaceView();
        } else {
          copyingPath = selected.path;
          copyDraft = suggestedCopyName(selected.name, t("files.copy.suffix"));
          renamingPath = null;
          renameDraft = "";
          clearMessage();
          requestFocus("copy-name", selected.path);
          replaceView();
        }
      }
      return;
    }
    const copyCancel = event.target.closest("[data-file-copy-cancel]");
    if (copyCancel && root.contains(copyCancel)) {
      copyingPath = null;
      copyDraft = "";
      clearMessage();
      replaceView();
      return;
    }
    const copyConfirm = event.target.closest("[data-file-copy-confirm]");
    if (copyConfirm && root.contains(copyConfirm)) {
      void copySelected();
      return;
    }
    const renameToggle = event.target.closest("[data-file-rename-toggle]");
    if (renameToggle && root.contains(renameToggle)) {
      const selected = selectedEntry();
      if (selected) {
        renamingPath = selected.path;
        renameDraft = selected.name;
        copyingPath = null;
        copyDraft = "";
        clearMessage();
        requestFocus("rename-name", selected.path);
        replaceView();
      }
      return;
    }
    const renameCancel = event.target.closest("[data-file-rename-cancel]");
    if (renameCancel && root.contains(renameCancel)) {
      renamingPath = null;
      renameDraft = "";
      clearMessage();
      replaceView();
      return;
    }
    const renameConfirm = event.target.closest("[data-file-rename-confirm]");
    if (renameConfirm && root.contains(renameConfirm)) {
      void renameSelected();
      return;
    }
    const activate = event.target.closest("[data-file-activate-selected]");
    if (activate && root.contains(activate)) {
      activateSelectedPath();
      return;
    }
    const previewClose = event.target.closest("[data-file-preview-close]");
    if (previewClose && root.contains(previewClose)) {
      previewRequestOrdinal += 1;
      previewPending = false;
      textPreview = null;
      clearMessage();
      replaceView();
      return;
    }
    const back = event.target.closest("[data-file-history-back]");
    if (back && root.contains(back) && canGoBack() && !pending) {
      void navigateHistory(navigationIndex - 1);
      return;
    }
    const forward = event.target.closest("[data-file-history-forward]");
    if (forward && root.contains(forward) && canGoForward() && !pending) {
      void navigateHistory(navigationIndex + 1);
      return;
    }
    const up = event.target.closest("[data-file-history-up]");
    if (up && root.contains(up) && listing && listing.path !== "/" && !pending) {
      void load(parentPath(listing.path));
      return;
    }
    const open = event.target.closest("[data-file-open-path]");
    if (open && root.contains(open)) {
      void load(open.dataset.fileOpenPath);
      return;
    }
    const clearSearch = event.target.closest("[data-file-search-clear]");
    if (clearSearch && root.contains(clearSearch)) {
      searchQuery = "";
      clearMessage();
      requestFocus("search");
      replaceView();
      return;
    }
    const importToggle = event.target.closest("[data-file-import-toggle]");
    if (importToggle && root.contains(importToggle) && !pending && listing) {
      findSlot()?.querySelector("[data-file-import-picker]")?.click();
      return;
    }
    const refresh = event.target.closest("[data-file-refresh]");
    if (refresh && listing) {
      void load(listing.path, { recordHistory: false });
      return;
    }
    const createToggle = event.target.closest("[data-file-create-toggle]");
    if (createToggle) {
      creatingDirectory = true;
      directoryDraft = "";
      clearMessage();
      requestFocus("directory-name");
      replaceView();
      return;
    }
    const cancel = event.target.closest("[data-file-create-cancel]");
    if (cancel) {
      creatingDirectory = false;
      directoryDraft = "";
      clearMessage();
      replaceView();
      return;
    }
    const create = event.target.closest("[data-file-create-directory]");
    if (create) {
      void createDirectory(directoryDraft);
    }
  };

  const onChange = (event) => {
    if (!event.target.matches?.("[data-file-import-picker]")) return;
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (file) void importSelectedFile(file);
  };

  const onInput = (event) => {
    if (event.target.matches?.("[data-file-recent-search]")) {
      recentSearchQuery = String(event.target.value ?? "").slice(0, 120);
      if (
        selectedRecentPath
        && !visibleRecentEntries().some((entry) => entry.path === selectedRecentPath)
      ) {
        selectedRecentPath = null;
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      clearMessage();
      replaceView();
    } else if (event.target.matches?.("[data-file-search]")) {
      searchQuery = String(event.target.value ?? "").slice(0, 120);
      if (!selectionIsVisible()) {
        selectedPath = null;
        renamingPath = null;
        renameDraft = "";
        copyingPath = null;
        copyDraft = "";
        previewRequestOrdinal += 1;
        previewPending = false;
        textPreview = null;
      }
      clearMessage();
      replaceView();
    } else if (event.target.matches?.("[data-file-project-rename-name]")) {
      projectRenameDraft = String(event.target.value ?? "").slice(0, MAX_PROJECT_NAME_LENGTH);
    } else if (event.target.matches?.("[data-file-project-name]")) {
      projectDraft = String(event.target.value ?? "").slice(0, MAX_PROJECT_NAME_LENGTH);
    } else if (event.target.matches?.("[data-file-directory-name]")) {
      directoryDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-rename-name]")) {
      renameDraft = event.target.value;
    } else if (event.target.matches?.("[data-file-copy-name]")) {
      copyDraft = event.target.value;
    }
  };

  const onKeyDown = (event) => {
    if (event.target.matches?.("[data-file-recent-search]")) {
      if (event.key === "Escape" && recentSearchQuery) {
        event.preventDefault();
        recentSearchQuery = "";
        clearMessage();
        requestFocus("recent-search");
        replaceView();
      }
      return;
    }

    const recentRow = event.target.closest?.("[data-file-recent-path]");
    if (recentRow && root.contains(recentRow)) {
      const slot = findSlot();
      const rows = slot ? [...slot.querySelectorAll("[data-file-recent-path]")] : [];
      const index = rows.indexOf(recentRow);
      if (index < 0) return;
      if (event.key === "Enter") {
        event.preventDefault();
        selectedRecentPath = recentRow.dataset.fileRecentPath;
        void openTextFile(selectedRecentPath);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        selectedRecentPath = recentRow.dataset.fileRecentPath;
        clearMessage();
        replaceView();
        return;
      }
      let nextIndex = null;
      if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, index + 1);
      if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = rows.length - 1;
      if (nextIndex === null || nextIndex === index) return;
      event.preventDefault();
      selectedRecentPath = rows[nextIndex].dataset.fileRecentPath;
      clearMessage();
      replaceView();
      return;
    }

    if (event.target.matches?.("[data-file-search]")) {
      if (event.key === "Escape" && searchQuery) {
        event.preventDefault();
        searchQuery = "";
        clearMessage();
        requestFocus("search");
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-copy-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void copySelected();
      } else if (event.key === "Escape" && !pending) {
        copyingPath = null;
        copyDraft = "";
        clearMessage();
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-rename-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void renameSelected();
      } else if (event.key === "Escape" && !pending) {
        renamingPath = null;
        renameDraft = "";
        clearMessage();
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-project-rename-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void renameProject();
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingProjectId = null;
        projectRenameDraft = "";
        clearMessage();
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-project-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void createProject();
      } else if (event.key === "Escape") {
        event.preventDefault();
        creatingProject = false;
        projectDraft = "";
        clearMessage();
        replaceView();
      }
      return;
    }

    if (event.target.matches?.("[data-file-directory-name]")) {
      if (event.key === "Enter") {
        event.preventDefault();
        void createDirectory(directoryDraft);
      } else if (event.key === "Escape" && !pending) {
        creatingDirectory = false;
        directoryDraft = "";
        clearMessage();
        replaceView();
      }
      return;
    }

    const row = event.target.closest?.("[data-file-select-path]");
    if (!row || !root.contains(row)) return;

    const rows = [...findSlot().querySelectorAll("[data-file-select-path]")];
    const index = rows.indexOf(row);
    if (index < 0) return;

    if (event.key === "Enter") {
      event.preventDefault();
      selectPath(row.dataset.fileSelectPath);
      const selected = listing?.entries.find(
        (entry) => joinPath(listing.path, entry.name) === row.dataset.fileSelectPath,
      );
      if (!selected) return;
      if (selected.kind === "directory") {
        void load(row.dataset.fileSelectPath);
      } else {
        void openTextFile(row.dataset.fileSelectPath);
      }
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      selectPath(row.dataset.fileSelectPath, { focus: true });
      return;
    }

    let nextIndex = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(rows.length - 1, index + 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = rows.length - 1;
    if (nextIndex === null || nextIndex === index) return;

    event.preventDefault();
    selectPath(rows[nextIndex].dataset.fileSelectPath, { focus: true });
  };

  const loadWithFallback = async (target, fallback = "/") => {
    const loaded = await load(target);
    if (destroyed || loaded) return loaded;
    if (listing) {
      lifecycle.setAppTarget("files", listing.path);
      return false;
    }
    if (target !== fallback) {
      const fallbackLoaded = await load(fallback);
      if (destroyed || fallbackLoaded) return fallbackLoaded;
    }
    lifecycle.setAppTarget("files", null);
    return false;
  };

  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeRecent = recentPort?.subscribe((snapshot) => {
    if (destroyed) return;
    recentSnapshot = validateRecentFilesSnapshot(snapshot);
    if (
      selectedRecentPath
      && !recentSnapshot.entries.some((entry) => entry.path === selectedRecentPath)
    ) {
      selectedRecentPath = null;
    }
    if (recentMode) replaceView();
  });
  const unsubscribeProjects = projectReader?.subscribe((snapshot) => {
    if (destroyed) return;
    projectSnapshot = validateProjectCatalogSnapshot(snapshot);
    if (
      renamingProjectId
      && !projectSnapshot.projects.some((project) => project.id === renamingProjectId)
    ) {
      renamingProjectId = null;
      projectRenameDraft = "";
    }
    if (failedProjectResume) {
      const project = projectSnapshot.projects.find(
        (candidate) => candidate.id === failedProjectResume.projectId,
      );
      if (!project || project.lastFilePath !== failedProjectResume.path) {
        failedProjectResume = null;
      }
    }
    replaceView();
  });
  const unsubscribeRender = lifecycle.subscribeRender(() => renderView(false));
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    if (activation.appId === "files" && activation.target) {
      void loadWithFallback(activation.target);
    }
  });
  const initialTarget = lifecycle.getAppTarget("files") ?? "/";
  void loadWithFallback(initialTarget);

  return Object.freeze({
    destroy() {
      destroyed = true;
      requestOrdinal += 1;
      previewRequestOrdinal += 1;
      unsubscribeActivation?.();
      unsubscribeRecent?.();
      unsubscribeProjects?.();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      const slot = findSlot();
      if (slot?.dataset.ordaxFileSpaceView !== undefined) {
        slot.replaceChildren();
        delete slot.dataset.ordaxFileSpaceView;
        delete slot.dataset.fileSpacePath;
        delete slot.dataset.fileSpaceContext;
      }
      mountedSlot = null;
    },
  });
}

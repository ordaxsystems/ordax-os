import { assertAppActivationPort } from "../../../contracts/app-activation.mjs";
import { assertIntelligencePort } from "../../../contracts/intelligence.mjs";
import { assertFileSpacePort } from "../../../contracts/file-space.mjs";
import {
  MAX_NOTES,
  MAX_NOTE_PROJECTS,
  MAX_NOTE_REFERENCES,
  MAX_NOTE_TASKS,
} from "../../../contracts/notes-store.mjs";
import {
  NOTES_HOME_PROJECT_ID,
  assertNotesRuntime,
} from "../domain/runtime.mjs";
import { createNotesStatistics } from "../domain/statistics.mjs";
import {
  createNotesImagePreviewCache,
  isNotesImageFileName,
  isNotesImageReference,
  notesImageReferenceKey,
} from "./image-previews.mjs";
import { createNotesEditorSaveController } from "./editor-save.mjs";
import {
  createNotesFilePicker,
  joinNotesLogicalPath,
  notesParentLogicalPath,
} from "./file-picker.mjs";
import {
  firstNotesBodyLine,
  formatNotesRelativeTime,
  visibleNotes,
} from "./list-model.mjs";
import {
  createNotesLinkReference,
  notesWebReferenceHost,
  parseNotesWebHref,
} from "./reference-links.mjs";
import {
  applyNotesRichLink,
  captureNotesRichSelection,
  createNotesRichEditor,
  handleNotesRichBlockKeyDown,
  normalizeNotesRichEditor,
  notesRichSelectionState,
  pastePlainTextIntoNotesEditor,
  preventNotesRichDrop,
  readNotesRichBody,
  renderNotesRichBody,
  restoreNotesRichSelection,
  setNotesRichBlockType,
  toggleNotesRichInlineMark,
  undoNotesRichEditor,
} from "./rich-editor.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { summarizeDocumentWithIntelligence } from "../../../services/intelligence/client-actions.mjs";

const NOTES_WINDOW_SELECTOR = '[data-window-id="notes"]';
const NOTES_EXTENSION_SELECTOR = '[data-app-extension="notes-workspace"]';
const EDITOR_FORMAT_ACTIONS = new Set(["bold", "italic", "insert-link", "undo"]);
const DELETED_NOTE_MUTATIONS = new Set([
  "favorite",
  "duplicate-note",
  "add-task",
  "remove-task",
  "move-note-project",
  "bold",
  "italic",
  "insert-link",
  "insert-image",
  "undo",
  "add-reference",
  "add-link-reference",
  "add-file-reference",
  "file-picker-up",
  "file-picker-open-directory",
  "file-picker-select-file",
  "attach-file-reference",
  "remove-reference",
]);

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(documentObject, className, label, action, text = label) {
  const element = node(documentObject, "button", className, text);
  element.type = "button";
  element.dataset.notesAction = action;
  element.setAttribute("aria-label", label);
  element.title = label;
  return element;
}

function buildShell(documentObject, t) {
  const view = node(documentObject, "div", "ordax-notes-view");
  view.dataset.ordaxNotesView = "";

  const nav = node(documentObject, "aside", "ordax-notes-nav");
  const searchLabel = node(documentObject, "label", "ordax-notes-search");
  searchLabel.setAttribute("aria-label", t("notes.search.aria"));
  searchLabel.append(node(documentObject, "span", "ordax-notes-search-icon", "⌕"));
  const search = node(documentObject, "input", "ordax-notes-search-input");
  search.type = "search";
  search.placeholder = t("notes.search.placeholder");
  search.autocomplete = "off";
  search.dataset.notesSearch = "";
  searchLabel.append(search);
  nav.append(searchLabel);

  const newNote = button(documentObject, "ordax-notes-new", t("notes.action.newNote"), "new-note", `＋  ${t("notes.action.newNote")}`);
  nav.append(newNote);

  const navList = node(documentObject, "div", "ordax-notes-nav-list");
  navList.append(
    button(documentObject, "ordax-notes-nav-item", t("notes.nav.all"), "view-all", `▱  ${t("notes.nav.all")}`),
    button(documentObject, "ordax-notes-nav-item", t("notes.nav.favorites"), "view-favorites", `☆  ${t("notes.nav.favorites")}`),
    button(documentObject, "ordax-notes-nav-item", t("notes.nav.recents"), "view-recent", `◷  ${t("notes.nav.recents")}`),
    button(documentObject, "ordax-notes-nav-item", t("notes.nav.trash"), "view-trash", `♲  ${t("notes.nav.trash")}`),
  );
  nav.append(navList);

  const projectsHeader = node(documentObject, "div", "ordax-notes-projects-header");
  projectsHeader.append(node(documentObject, "span", "", t("notes.projects.heading")));
  projectsHeader.append(button(documentObject, "ordax-notes-project-add", t("notes.projects.new"), "new-project", "＋"));
  nav.append(projectsHeader);
  nav.append(node(documentObject, "div", "ordax-notes-projects"));
  const device = node(documentObject, "div", "ordax-notes-device", `▱  ${t("notes.device.current")}`);
  device.dataset.notesDevice = "";
  nav.append(device);

  const list = node(documentObject, "section", "ordax-notes-list-pane");
  const listHeader = node(documentObject, "header", "ordax-notes-list-header");
  const listHeading = node(documentObject, "div");
  listHeading.append(
    node(documentObject, "strong", "ordax-notes-list-title", t("notes.home")),
    node(documentObject, "small", "ordax-notes-list-count", `0 ${t("notes.count.notes")}`),
  );
  const listActions = node(documentObject, "div", "ordax-notes-list-actions");
  const emptyTrash = button(
    documentObject,
    "ordax-notes-empty-trash",
    t("notes.action.emptyTrash"),
    "empty-trash",
    t("notes.action.emptyTrashShort"),
  );
  emptyTrash.hidden = true;
  const sort = button(documentObject, "ordax-notes-sort", t("notes.action.sort"), "sort", "≡");
  listActions.append(emptyTrash, sort);
  listHeader.append(listHeading, listActions);
  list.append(listHeader, node(documentObject, "div", "ordax-notes-list"));

  const editor = node(documentObject, "main", "ordax-notes-editor-pane");
  const top = node(documentObject, "header", "ordax-notes-editor-top");
  const breadcrumb = node(documentObject, "div", "ordax-notes-breadcrumb", t("notes.breadcrumb", { project: t("notes.home") }));
  const topActions = node(documentObject, "div", "ordax-notes-top-actions");
  topActions.append(
    node(documentObject, "span", "ordax-notes-save-status", t("notes.saved.device")),
    button(documentObject, "ordax-notes-star", t("notes.favorite.add"), "favorite", "☆"),
    button(documentObject, "ordax-notes-refs-toggle", t("notes.references.show"), "toggle-references", t("notes.references.title")),
    button(documentObject, "ordax-notes-more", t("notes.action.more"), "toggle-menu", "•••"),
  );
  const menu = node(documentObject, "div", "ordax-notes-menu");
  menu.hidden = true;
  const duplicateAction = button(
    documentObject,
    "ordax-notes-menu-item ordax-notes-duplicate",
    t("notes.action.duplicate"),
    "duplicate-note",
    t("notes.action.duplicate"),
  );
  const trashAction = button(
    documentObject,
    "ordax-notes-menu-item ordax-notes-trash-action",
    t("notes.action.trash"),
    "trash-note",
    t("notes.action.trashShort"),
  );
  const permanentDeleteAction = button(
    documentObject,
    "ordax-notes-menu-item ordax-notes-delete-forever",
    t("notes.action.deleteForever"),
    "delete-note-forever",
    t("notes.action.deleteForeverShort"),
  );
  permanentDeleteAction.hidden = true;
  const moveSection = node(documentObject, "section", "ordax-notes-move-section");
  moveSection.append(
    node(documentObject, "span", "ordax-notes-menu-label", t("notes.move.heading")),
    node(documentObject, "div", "ordax-notes-move-projects"),
  );
  menu.append(duplicateAction, trashAction, permanentDeleteAction, moveSection);
  top.append(breadcrumb, topActions, menu);
  editor.append(top);

  const toolbar = node(documentObject, "div", "ordax-notes-toolbar");
  const format = node(documentObject, "select", "ordax-notes-format");
  format.dataset.notesFormat = "";
  for (const [value, label] of [["text", t("notes.format.text")], ["h2", t("notes.format.heading2")], ["list", t("notes.format.list")], ["quote", t("notes.format.quote")]]) {
    const option = node(documentObject, "option", "", label);
    option.value = value;
    format.append(option);
  }
  toolbar.append(
    format,
    button(documentObject, "ordax-notes-tool", t("notes.tool.bold"), "bold", "B"),
    button(documentObject, "ordax-notes-tool ordax-notes-tool-italic", t("notes.tool.italic"), "italic", "I"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", t("notes.tool.checklist"), "add-task", "☑"),
    button(documentObject, "ordax-notes-tool", t("notes.tool.link"), "insert-link", "↗"),
    button(documentObject, "ordax-notes-tool", t("notes.tool.image"), "insert-image", "▧"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(documentObject, "ordax-notes-tool", t("notes.tool.undo"), "undo", "↶"),
    node(documentObject, "span", "ordax-notes-tool-separator"),
    button(
      documentObject,
      "ordax-notes-tool ordax-notes-intelligence-action",
      t("notes.intelligence.summaryAria"),
      "intelligence-summary",
      `✦  ${t("notes.intelligence.summary")}`,
    ),
  );
  editor.append(toolbar);

  const paper = node(documentObject, "article", "ordax-notes-paper");
  const empty = node(documentObject, "div", "ordax-notes-empty");
  empty.append(
    node(documentObject, "strong", "", t("notes.empty.title")),
    node(documentObject, "p", "", t("notes.empty.body")),
  );
  empty.dataset.notesEmpty = "";
  const form = node(documentObject, "div", "ordax-notes-document");
  form.dataset.notesDocument = "";
  form.hidden = true;
  form.append(
    node(documentObject, "span", "ordax-notes-kicker", t("notes.document.kicker")),
  );
  const title = node(documentObject, "textarea", "ordax-notes-title");
  title.rows = 1;
  title.maxLength = 1024;
  title.spellcheck = true;
  title.placeholder = t("notes.document.titlePlaceholder");
  title.dataset.notesTitle = "";
  title.setAttribute("aria-label", t("notes.document.titlePlaceholder"));
  form.append(title);
  form.append(node(documentObject, "div", "ordax-notes-meta"));
  const body = createNotesRichEditor(documentObject);
  form.append(body);
  const intelligencePanel = node(documentObject, "section", "ordax-notes-intelligence");
  intelligencePanel.dataset.notesIntelligence = "";
  intelligencePanel.hidden = true;
  const intelligenceHeading = node(documentObject, "strong", "ordax-notes-intelligence-title", "Ordax Intelligence");
  const intelligenceStatus = node(documentObject, "p", "ordax-notes-intelligence-status");
  intelligenceStatus.dataset.notesIntelligenceStatus = "";
  intelligenceStatus.setAttribute("role", "status");
  intelligenceStatus.setAttribute("aria-live", "polite");
  const intelligenceAnswer = node(documentObject, "p", "ordax-notes-intelligence-answer");
  intelligenceAnswer.dataset.notesIntelligenceAnswer = "";
  intelligencePanel.append(intelligenceHeading, intelligenceStatus, intelligenceAnswer);
  form.append(intelligencePanel);
  const inlineMedia = node(documentObject, "section", "ordax-notes-inline-media");
  inlineMedia.dataset.notesInlineMedia = "";
  inlineMedia.hidden = true;
  form.append(inlineMedia);
  const tasksSection = node(documentObject, "section", "ordax-notes-tasks");
  tasksSection.append(node(documentObject, "h3", "", t("notes.tasks.today")), node(documentObject, "div", "ordax-notes-task-list"));
  form.append(tasksSection);
  paper.append(empty, form);
  editor.append(paper);
  const editorFooter = node(documentObject, "footer", "ordax-notes-editor-footer");
  const offlineStatus = node(documentObject, "span", "ordax-notes-offline-status", t("notes.offline.available"));
  const statistics = node(documentObject, "span", "ordax-notes-statistics", t("notes.statistics.empty"));
  statistics.dataset.notesStatistics = "";
  statistics.setAttribute("aria-label", t("notes.statistics.aria"));
  editorFooter.append(offlineStatus, statistics);
  editor.append(editorFooter);

  const refs = node(documentObject, "aside", "ordax-notes-references");
  refs.dataset.notesReferences = "";
  const refsHeader = node(documentObject, "header", "ordax-notes-refs-header");
  refsHeader.append(
    node(documentObject, "strong", "", t("notes.references.title")),
    button(documentObject, "ordax-notes-refs-close", t("notes.references.collapse"), "toggle-references", "×"),
  );
  refs.append(refsHeader, node(documentObject, "div", "ordax-notes-refs-content"));
  const addRef = button(documentObject, "ordax-notes-add-reference", t("notes.references.add"), "add-reference", `＋  ${t("notes.references.add")}`);
  const refChoices = node(documentObject, "div", "ordax-notes-reference-choices");
  refChoices.dataset.notesReferenceChoices = "";
  refChoices.hidden = true;
  refChoices.append(
    button(documentObject, "ordax-notes-reference-choice", t("notes.references.link"), "add-link-reference", `◎  ${t("notes.references.link")}`),
    button(documentObject, "ordax-notes-reference-choice", t("notes.references.file"), "add-file-reference", `▱  ${t("notes.references.file")}`),
  );
  const filePicker = node(documentObject, "section", "ordax-notes-file-picker");
  filePicker.dataset.notesFilePicker = "";
  filePicker.hidden = true;
  refs.append(
    addRef,
    refChoices,
    filePicker,
    node(documentObject, "p", "ordax-notes-refs-caption", t("notes.references.caption")),
  );

  view.append(nav, list, editor, refs);
  return view;
}

export function mountNotesWorkspaceControls(
  root,
  notesRuntime,
  surfaceLifecycle = null,
  { fileSpace = null, appActivation = null, intelligence = null } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Notes workspace controls require a Surface root Element");
  }
  const runtime = assertNotesRuntime(notesRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const filePort = fileSpace === null ? null : assertFileSpacePort(fileSpace);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const intelligencePort = intelligence === null ? null : assertIntelligencePort(intelligence);
  const documentObject = root.ownerDocument;
  const windowObject = documentObject.defaultView ?? globalThis.window;

  let state = runtime.getSnapshot();
  let mode = "project";
  let query = "";
  let referencesOpen = true;
  let newestFirst = true;
  let projectMenuId = null;
  let referenceChooserOpen = false;
  let referenceNoteId = null;
  let lastEditorRange = null;
  let mountedSlot = null;
  let destroyed = false;
  let intelligenceSnapshot = intelligencePort?.getSnapshot() ?? null;
  let intelligencePending = false;
  let intelligenceNoteId = null;
  let intelligenceResult = "";
  let intelligenceErrorMessageId = null;

  const currentNote = () => {
    const id = state.document.selectedNoteId;
    return state.document.notes.find((note) => note.id === id) ?? null;
  };

  const persistenceStatusText = ({ editorPending = false, sessionSaved = true } = {}) => {
    if (editorPending || state.persistence.pending) return t("notes.editor.saving");
    if (!state.persistence.ok) return t("notes.persistence.failed");
    if (state.persistence.scope === "device") return `✓  ${t("notes.saved.device")}`;
    return sessionSaved ? t("notes.persistence.savedSession") : t("notes.persistence.sessionOnly");
  };

  const captureEditorPayload = () => {
    if (!mountedSlot) return null;
    const title = mountedSlot.querySelector("[data-notes-title]");
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return null;
    normalizeNotesRichEditor(body);
    return Object.freeze({
      title: title?.value ?? "",
      richBody: readNotesRichBody(body),
    });
  };

  const persistEditor = (noteId, payload = null) => {
    if (!noteId) return false;
    const note = state.document.notes.find((candidate) => candidate.id === noteId);
    if (!note || note.deletedAt !== null) return false;
    try {
      const editorPayload = payload ?? (
        currentNote()?.id === noteId ? captureEditorPayload() : null
      );
      if (!editorPayload) return false;
      runtime.updateNote(noteId, editorPayload);
      return true;
    } catch {
      const status = mountedSlot?.querySelector(".ordax-notes-save-status");
      if (status) status.textContent = t("notes.editor.saveFailed");
      return false;
    }
  };

  const editorSave = createNotesEditorSaveController({
    persist: persistEditor,
    setTimeoutFn: windowObject.setTimeout.bind(windowObject),
    clearTimeoutFn: windowObject.clearTimeout.bind(windowObject),
  });

  const flushEditor = (noteId = null) => editorSave.flush(noteId);

  const scheduleSave = () => {
    const note = currentNote();
    if (!note || note.deletedAt !== null || !mountedSlot) return false;
    const status = mountedSlot.querySelector(".ordax-notes-save-status");
    try {
      const payload = captureEditorPayload();
      if (!payload) return false;
      if (status) status.textContent = t("notes.editor.saving");
      return editorSave.schedule(note.id, payload);
    } catch {
      if (status) status.textContent = t("notes.editor.prepareFailed");
      return false;
    }
  };

  const filePicker = createNotesFilePicker({ fileSpace: filePort });

  const resetReferenceFlow = () => {
    referenceChooserOpen = false;
    referenceNoteId = null;
    filePicker.close();
  };

  const imagePreviewCache = createNotesImagePreviewCache({
    fileSpace: filePort,
    windowRef: windowObject,
  });

  const renderProjects = (view) => {
    const projects = view.querySelector(".ordax-notes-projects");
    projects.replaceChildren();
    for (const project of state.document.projects) {
      const row = node(documentObject, "div", "ordax-notes-project-row");
      row.dataset.projectId = project.id;
      row.dataset.active = String(mode === "project" && project.id === state.document.selectedProjectId);

      const projectButton = button(
        documentObject,
        "ordax-notes-project",
        t("notes.project.open", { name: project.name }),
        "select-project",
        "",
      );
      projectButton.dataset.projectId = project.id;
      projectButton.dataset.active = row.dataset.active;
      projectButton.append(
        node(documentObject, "span", "ordax-notes-project-icon", "□"),
        node(documentObject, "span", "ordax-notes-project-name", project.name),
      );

      const actions = button(
        documentObject,
        "ordax-notes-project-actions",
        t("notes.project.actions", { name: project.name }),
        "project-actions",
        "•••",
      );
      actions.dataset.projectId = project.id;
      actions.setAttribute("aria-expanded", String(projectMenuId === project.id));
      row.append(projectButton, actions);
      projects.append(row);

      if (projectMenuId === project.id) {
        const projectMenu = node(documentObject, "div", "ordax-notes-project-menu");
        if (project.id !== NOTES_HOME_PROJECT_ID) {
          const rename = button(
            documentObject,
            "ordax-notes-project-menu-item",
            t("notes.project.rename", { name: project.name }),
            "rename-project",
            t("notes.project.renameShort"),
          );
          rename.dataset.projectId = project.id;
          projectMenu.append(rename);
          const remove = button(
            documentObject,
            "ordax-notes-project-menu-item ordax-notes-project-menu-danger",
            t("notes.project.remove", { name: project.name }),
            "remove-project",
            t("notes.project.removeShort"),
          );
          remove.dataset.projectId = project.id;
          projectMenu.append(remove);
        } else {
          projectMenu.append(
            node(
              documentObject,
              "small",
              "ordax-notes-project-menu-hint",
              t("notes.project.homeLocked"),
            ),
          );
        }
        projects.append(projectMenu);
      }
    }
  };

  const modeLabel = () => {
    if (mode === "all") return t("notes.mode.all");
    if (mode === "favorites") return t("notes.mode.favorites");
    if (mode === "recent") return t("notes.mode.recents");
    if (mode === "trash") return t("notes.mode.trash");
    return state.document.projects.find((project) => project.id === state.document.selectedProjectId)?.name
      ?? t("notes.home");
  };

  const renderList = (view) => {
    const items = visibleNotes(state.document, mode, query, newestFirst, localization.getLocale());
    view.querySelector(".ordax-notes-list-title").textContent = modeLabel();
    view.querySelector(".ordax-notes-list-count").textContent = `${items.length} ${items.length === 1 ? t("notes.count.note") : t("notes.count.notes")}`;
    const emptyTrash = view.querySelector(".ordax-notes-empty-trash");
    emptyTrash.hidden = mode !== "trash";
    emptyTrash.disabled = mode !== "trash" || items.length === 0;
    const list = view.querySelector(".ordax-notes-list");
    list.replaceChildren();
    for (const note of items) {
      const row = button(documentObject, "ordax-notes-row", t("notes.note.open", { title: note.title || t("notes.note.untitledLower") }), "select-note", "");
      row.dataset.noteId = note.id;
      row.dataset.active = String(note.id === state.document.selectedNoteId);
      const icon = node(documentObject, "span", "ordax-notes-row-icon", note.favorite ? "★" : "▤");
      const copy = node(documentObject, "span", "ordax-notes-row-copy");
      copy.append(
        node(documentObject, "strong", "", note.title || t("notes.note.untitled")),
        node(documentObject, "small", "", firstNotesBodyLine(note.body, t("notes.note.emptyBody"))),
      );
      const time = node(documentObject, "time", "ordax-notes-row-time", formatNotesRelativeTime(note.updatedAt, Date.now(), { locale: localization.getLocale(), nowLabel: t("notes.time.now"), yesterdayLabel: t("notes.time.yesterday") }));
      row.append(icon, copy, time);
      list.append(row);
    }
    if (items.length === 0) {
      list.append(node(documentObject, "p", "ordax-notes-list-empty", query ? t("notes.list.emptySearch") : t("notes.list.empty")));
    }

    for (const action of ["all", "favorites", "recent", "trash"]) {
      const actionButton = view.querySelector(`[data-notes-action="view-${action}"]`);
      if (actionButton) actionButton.dataset.active = String(mode === action);
    }
  };

  const renderInlineMedia = (view, note) => {
    const media = view.querySelector("[data-notes-inline-media]");
    const readOnly = note.deletedAt !== null;
    const references = note.references.filter(isNotesImageReference);
    const activeKeys = new Set(references.map((reference) => notesImageReferenceKey(note.id, reference)));
    imagePreviewCache.releaseExcept(activeKeys);
    media.replaceChildren();
    media.hidden = references.length === 0;
    if (references.length === 0) return;

    for (const reference of references) {
      const preview = imagePreviewCache.get(note.id, reference);

      const figure = node(documentObject, "figure", "ordax-notes-inline-image");
      figure.dataset.referenceId = reference.id;
      const frame = node(documentObject, "div", "ordax-notes-inline-image-frame");

      if (preview?.status === "ready" && preview.url) {
        const image = node(documentObject, "img", "ordax-notes-inline-image-preview");
        image.src = preview.url;
        image.alt = reference.title || t("notes.image.relatedAlt");
        image.loading = "lazy";
        image.decoding = "async";
        image.draggable = false;
        frame.append(image);
      } else {
        const message = !imagePreviewCache.available
          ? t("notes.image.previewNative")
          : preview?.status === "failed"
            ? t("notes.image.previewFailed")
            : t("notes.image.loading");
        frame.append(node(documentObject, "span", "ordax-notes-inline-image-placeholder", message));
        if (!preview && imagePreviewCache.available) {
          void imagePreviewCache.ensure(
            note.id,
            reference,
            () => {
              const activeNote = currentNote();
              return activeNote?.id === note.id
                && activeNote.references.some((candidate) => (
                  candidate.id === reference.id
                  && candidate.path === reference.path
                  && isNotesImageReference(candidate)
                ));
            },
          ).finally(() => {
            if (!destroyed) render();
          });
        }
      }

      const caption = node(documentObject, "figcaption", "ordax-notes-inline-image-caption");
      const copy = node(documentObject, "span", "ordax-notes-inline-image-copy");
      copy.append(
        node(documentObject, "strong", "", reference.title || t("notes.image.fallbackTitle")),
        node(documentObject, "small", "", reference.path || t("notes.file.local")),
      );
      const actions = node(documentObject, "span", "ordax-notes-inline-image-actions");
      if (activationPort && reference.path) {
        const open = button(
          documentObject,
          "ordax-notes-inline-image-action",
          t("notes.image.openLocation"),
          "open-file-reference",
          t("notes.file.openInFiles"),
        );
        open.dataset.filePath = reference.path;
        actions.append(open);
      }
      const remove = button(
        documentObject,
        "ordax-notes-inline-image-action ordax-notes-inline-image-remove",
        t("notes.image.remove"),
        "remove-reference",
        t("notes.action.remove"),
      );
      remove.dataset.referenceId = reference.id;
      remove.disabled = readOnly;
      actions.append(remove);
      caption.append(copy, actions);
      figure.append(frame, caption);
      media.append(figure);
    }
  };

  const renderTasks = (view, note) => {
    const taskList = view.querySelector(".ordax-notes-task-list");
    const readOnly = note.deletedAt !== null;
    taskList.replaceChildren();
    const section = view.querySelector(".ordax-notes-tasks");
    section.hidden = note.tasks.length === 0;
    for (const task of note.tasks) {
      const row = node(documentObject, "div", "ordax-notes-task");
      row.dataset.done = String(task.done);
      const checkbox = node(documentObject, "input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done;
      checkbox.disabled = readOnly;
      checkbox.dataset.taskId = task.id;
      checkbox.dataset.notesTaskDone = "";
      checkbox.setAttribute("aria-label", t("notes.task.markDone", { text: task.text }));
      const text = node(documentObject, "input", "ordax-notes-task-text");
      text.type = "text";
      text.value = task.text;
      text.maxLength = 2048;
      text.readOnly = readOnly;
      text.dataset.taskId = task.id;
      text.dataset.notesTaskText = "";
      text.setAttribute("aria-label", t("notes.task.textAria"));
      const remove = button(
        documentObject,
        "ordax-notes-task-remove",
        t("notes.task.remove", { text: task.text }),
        "remove-task",
        "×",
      );
      remove.dataset.taskId = task.id;
      remove.disabled = readOnly;
      row.append(checkbox, text, remove);
      taskList.append(row);
    }
  };

  const renderReferenceControls = (view, note) => {
    const readOnly = note.deletedAt !== null;
    let pickerState = filePicker.getSnapshot();
    if (
      (referenceNoteId !== null && referenceNoteId !== note.id)
      || (readOnly && (referenceChooserOpen || pickerState.open))
    ) {
      resetReferenceFlow();
      pickerState = filePicker.getSnapshot();
    }
    const choices = view.querySelector("[data-notes-reference-choices]");
    choices.hidden = !referenceChooserOpen;
    const referencesFull = note.references.length >= MAX_NOTE_REFERENCES;
    const linkChoice = choices.querySelector('[data-notes-action="add-link-reference"]');
    linkChoice.disabled = readOnly || referencesFull;
    linkChoice.title = readOnly
      ? t("notes.references.restoreToAdd")
      : referencesFull
      ? t("notes.references.limitReached", { limit: MAX_NOTE_REFERENCES })
      : t("notes.references.addWebLink");
    const fileChoice = choices.querySelector('[data-notes-action="add-file-reference"]');
    fileChoice.disabled = readOnly || filePort === null || referencesFull;
    fileChoice.title = readOnly
      ? t("notes.references.restoreToAdd")
      : referencesFull
        ? t("notes.references.limitReached", { limit: MAX_NOTE_REFERENCES })
        : filePort
          ? t("notes.references.attachLocalFile")
          : t("notes.references.nativeFilesOnly");

    const picker = view.querySelector("[data-notes-file-picker]");
    picker.hidden = !pickerState.open;
    picker.replaceChildren();
    if (!pickerState.open) return;

    const header = node(documentObject, "header", "ordax-notes-file-picker-header");
    const heading = node(documentObject, "div", "ordax-notes-file-picker-heading");
    heading.append(
      node(
        documentObject,
        "strong",
        "",
        t(pickerState.purpose === "image" ? "notes.filePicker.title.image" : "notes.filePicker.title.file"),
      ),
      node(documentObject, "small", "", pickerState.path),
    );
    header.append(
      heading,
      button(documentObject, "ordax-notes-file-picker-close", t("notes.filePicker.close"), "close-file-picker", "×"),
    );
    picker.append(header);

    const navigation = node(documentObject, "div", "ordax-notes-file-picker-nav");
    const up = button(documentObject, "ordax-notes-file-picker-up", t("notes.filePicker.up"), "file-picker-up", `↑  ${t("notes.filePicker.upShort")}`);
    up.disabled = pickerState.path === "/" || pickerState.pending;
    navigation.append(up);
    picker.append(navigation);

    const list = node(documentObject, "div", "ordax-notes-file-picker-list");
    if (pickerState.pending) {
      list.append(node(documentObject, "p", "ordax-notes-file-picker-message", t("notes.filePicker.loading")));
    } else if (pickerState.errorMessageId) {
      list.append(node(documentObject, "p", "ordax-notes-file-picker-message", t(pickerState.errorMessageId)));
    } else if (pickerState.listing) {
      const entries = [...pickerState.listing.entries]
        .filter((entry) => (
          pickerState.purpose !== "image"
          || entry.kind === "directory"
          || isNotesImageFileName(entry.name)
        ))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name, localization.getLocale(), { sensitivity: "base" });
        });
      if (entries.length === 0) {
        list.append(node(documentObject, "p", "ordax-notes-file-picker-message", t("notes.filePicker.empty")));
      }
      for (const entry of entries) {
        const fullPath = joinNotesLogicalPath(pickerState.listing.path, entry.name);
        const action = entry.kind === "directory" ? "file-picker-open-directory" : "file-picker-select-file";
        const row = button(
          documentObject,
          "ordax-notes-file-picker-row",
          t(entry.kind === "directory" ? "notes.filePicker.openDirectory" : "notes.filePicker.selectFile", { name: entry.name }),
          action,
          "",
        );
        row.dataset.filePath = fullPath;
        row.dataset.kind = entry.kind;
        row.dataset.selected = String(entry.kind === "file" && pickerState.selectedPath === fullPath);
        row.append(
          node(documentObject, "span", "ordax-notes-file-picker-icon", entry.kind === "directory" ? "□" : "▱"),
          node(documentObject, "span", "ordax-notes-file-picker-name", entry.name),
          node(documentObject, "small", "ordax-notes-file-picker-kind", t(entry.kind === "directory" ? "notes.filePicker.kind.directory" : "notes.filePicker.kind.file")),
        );
        list.append(row);
      }
    }
    picker.append(list);

    const attach = button(
      documentObject,
      "ordax-notes-file-picker-attach",
      t(pickerState.purpose === "image" ? "notes.filePicker.attachSelectedImage" : "notes.filePicker.attachSelectedFile"),
      "attach-file-reference",
      t(pickerState.purpose === "image" ? "notes.filePicker.attachImage" : "notes.filePicker.attachFile"),
    );
    attach.disabled = readOnly
      || !pickerState.selectedPath
      || pickerState.pending
      || note.references.length >= MAX_NOTE_REFERENCES;
    picker.append(attach);
  };

  const renderReferences = (view, note) => {
    const readOnly = note.deletedAt !== null;
    const panel = view.querySelector("[data-notes-references]");
    panel.hidden = !referencesOpen;
    const refs = view.querySelector(".ordax-notes-refs-content");
    refs.replaceChildren();
    refs.append(node(documentObject, "span", "ordax-notes-refs-kicker", t("notes.references.thisNote")));

    const links = note.references.filter((reference) => reference.kind === "link");
    const files = note.references.filter((reference) => reference.kind === "file");
    if (note.references.length === 0) {
      refs.append(node(documentObject, "p", "ordax-notes-refs-empty", t("notes.references.empty")));
    }

    for (const reference of links) {
      const card = node(documentObject, "article", "ordax-notes-ref-card");
      const leading = node(documentObject, "span", "ordax-notes-ref-icon", "◎");
      const copy = node(documentObject, "span", "ordax-notes-ref-copy");
      copy.append(
        node(documentObject, "strong", "", reference.title),
        node(documentObject, "small", "", notesWebReferenceHost(reference.href)),
        node(documentObject, "span", "", reference.detail || t("notes.references.linkFallback")),
      );
      const remove = button(documentObject, "ordax-notes-ref-remove", t("notes.references.remove"), "remove-reference", "×");
      remove.dataset.referenceId = reference.id;
      remove.disabled = readOnly;
      card.append(leading, copy, remove);
      if (reference.href) {
        card.dataset.href = reference.href;
        card.tabIndex = 0;
        card.setAttribute("role", "link");
      }
      refs.append(card);
    }

    if (files.length) {
      refs.append(node(documentObject, "h3", "ordax-notes-refs-subtitle", t("notes.references.relatedFiles")));
      for (const reference of files) {
        const card = node(documentObject, "article", "ordax-notes-ref-card ordax-notes-file-ref-card");
        const copy = node(documentObject, "span", "ordax-notes-ref-copy");
        copy.append(
          node(documentObject, "strong", "", reference.title),
          node(documentObject, "small", "", reference.path || t("notes.file.local")),
          node(documentObject, "span", "", reference.detail || t("notes.file.local")),
        );
        if (reference.path && activationPort) {
          const open = button(documentObject, "ordax-notes-ref-open", t("notes.file.openLocation"), "open-file-reference", t("notes.action.open"));
          open.dataset.filePath = reference.path;
          copy.append(open);
        }
        const remove = button(documentObject, "ordax-notes-ref-remove", t("notes.references.remove"), "remove-reference", "×");
        remove.dataset.referenceId = reference.id;
        remove.disabled = readOnly;
        card.append(node(documentObject, "span", "ordax-notes-ref-icon", "▱"), copy, remove);
        refs.append(card);
      }
    }

    renderReferenceControls(view, note);
  };

  const syncEditorToolbar = () => {
    if (!mountedSlot) return;
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return;
    const selection = notesRichSelectionState(body);
    const format = mountedSlot.querySelector("[data-notes-format]");
    const formatValue = {
      paragraph: "text",
      heading: "h2",
      bullet: "list",
      quote: "quote",
    }[selection.blockType] ?? "text";
    if (format) format.value = formatValue;
    const bold = mountedSlot.querySelector('[data-notes-action="bold"]');
    const italic = mountedSlot.querySelector('[data-notes-action="italic"]');
    if (bold) {
      bold.dataset.active = String(selection.bold);
      bold.setAttribute("aria-pressed", String(selection.bold));
    }
    if (italic) {
      italic.dataset.active = String(selection.italic);
      italic.setAttribute("aria-pressed", String(selection.italic));
    }
  };

  const restoreEditorRange = () => {
    if (!mountedSlot || !lastEditorRange) return false;
    const body = mountedSlot.querySelector("[data-notes-body]");
    return body ? restoreNotesRichSelection(body, lastEditorRange) : false;
  };

  const focusEditorBody = () => {
    if (!mountedSlot) return false;
    const body = mountedSlot.querySelector("[data-notes-body]");
    if (!body) return false;
    body.focus();
    if (lastEditorRange && restoreNotesRichSelection(body, lastEditorRange)) {
      syncEditorToolbar();
      return true;
    }

    const target = body.querySelector("[data-notes-rich-block]") ?? body;
    const selection = documentObject.getSelection?.();
    if (!selection) return false;
    const range = documentObject.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    lastEditorRange = range.cloneRange();
    syncEditorToolbar();
    return true;
  };

  const renderCapacityControls = (view, note) => {
    const notesFull = state.document.notes.length >= MAX_NOTES;
    const projectsFull = state.document.projects.length >= MAX_NOTE_PROJECTS;
    const tasksFull = note?.tasks.length >= MAX_NOTE_TASKS;
    const referencesFull = note?.references.length >= MAX_NOTE_REFERENCES;
    const readOnly = note?.deletedAt !== null && note?.deletedAt !== undefined;

    const newNote = view.querySelector('[data-notes-action="new-note"]');
    if (newNote) {
      newNote.disabled = notesFull;
      newNote.title = notesFull
        ? t("notes.capacity.notes", { limit: MAX_NOTES })
        : t("notes.action.newNote");
    }

    const newProject = view.querySelector('[data-notes-action="new-project"]');
    if (newProject) {
      newProject.disabled = projectsFull;
      newProject.title = projectsFull
        ? t("notes.capacity.projects", { limit: MAX_NOTE_PROJECTS })
        : t("notes.projects.new");
    }

    const addTask = view.querySelector('[data-notes-action="add-task"]');
    if (addTask) {
      addTask.disabled = !note || readOnly || tasksFull;
      addTask.title = readOnly
        ? t("notes.task.restoreToEdit")
        : tasksFull
          ? t("notes.capacity.tasks", { limit: MAX_NOTE_TASKS })
          : t("notes.tool.checklist");
    }

    const addReference = view.querySelector('[data-notes-action="add-reference"]');
    if (addReference) {
      addReference.disabled = !note || readOnly || referencesFull;
      addReference.title = readOnly
        ? t("notes.references.restoreToAdd")
        : referencesFull
          ? t("notes.references.limitReached", { limit: MAX_NOTE_REFERENCES })
          : t("notes.references.add");
    }

    const imageTool = view.querySelector('[data-notes-action="insert-image"]');
    if (imageTool) {
      imageTool.disabled = !note || readOnly || filePort === null || referencesFull;
      imageTool.title = readOnly
        ? t("notes.image.restoreToAttach")
        : referencesFull
          ? t("notes.references.limitReached", { limit: MAX_NOTE_REFERENCES })
          : filePort === null
            ? t("notes.image.nativeOnly")
            : t("notes.tool.image");
    }
  };

  const renderMoveProjects = (view, note) => {
    const list = view.querySelector(".ordax-notes-move-projects");
    list.replaceChildren();
    const targets = state.document.projects.filter((project) => project.id !== note.projectId);
    const section = view.querySelector(".ordax-notes-move-section");
    section.hidden = targets.length === 0 || note.deletedAt !== null;
    for (const project of targets) {
      const move = button(
        documentObject,
        "ordax-notes-menu-item ordax-notes-move-project",
        t("notes.move.toProject", { name: project.name }),
        "move-note-project",
        project.name,
      );
      move.dataset.projectId = project.id;
      list.append(move);
    }
  };

  const syncEditorStatistics = (view, note, textOverride = null) => {
    const target = view.querySelector("[data-notes-statistics]");
    if (!target) return;
    if (!note) {
      target.textContent = t("notes.statistics.noNote");
      return;
    }

    const statistics = createNotesStatistics({
      text: textOverride ?? note.body,
      tasks: note.tasks,
      references: note.references,
    });
    const words = t(statistics.words === 1 ? "notes.statistics.word" : "notes.statistics.words", { count: statistics.words });
    const characters = t(statistics.characters === 1 ? "notes.statistics.character" : "notes.statistics.characters", { count: statistics.characters });
    const tasks = statistics.tasks === 0
      ? t("notes.statistics.noTasks")
      : t("notes.statistics.tasks", { completed: statistics.completedTasks, count: statistics.tasks });
    const references = t(statistics.references === 1 ? "notes.statistics.reference" : "notes.statistics.references", { count: statistics.references });
    target.textContent = t("notes.statistics.summary", { words, characters, tasks, references });
  };

  const renderEditor = (view) => {
    const note = currentNote();
    const empty = view.querySelector("[data-notes-empty]");
    const documentView = view.querySelector("[data-notes-document]");
    const editControls = view.querySelectorAll(".ordax-notes-toolbar button, .ordax-notes-format, .ordax-notes-star");
    for (const control of editControls) control.disabled = !note || note.deletedAt !== null;
    const intelligenceAction = view.querySelector('[data-notes-action="intelligence-summary"]');
    if (intelligenceAction) {
      const ready = intelligenceSnapshot?.state === "ready";
      intelligenceAction.disabled = !note || note.deletedAt !== null || !ready || intelligencePending;
      intelligenceAction.textContent = intelligencePending && intelligenceNoteId === note?.id
        ? `✦  ${t("notes.intelligence.summarizing")}`
        : `✦  ${t("notes.intelligence.summary")}`;
      intelligenceAction.title = ready
        ? t("notes.intelligence.readyTitle")
        : t("notes.intelligence.unavailableTitle");
    }
    const more = view.querySelector(".ordax-notes-more");
    if (more) more.disabled = !note;
    renderCapacityControls(view, note);

    if (!note) {
      imagePreviewCache.releaseExcept(new Set());
      empty.hidden = false;
      documentView.hidden = true;
      view.querySelector(".ordax-notes-breadcrumb").textContent = t("notes.breadcrumb", { project: modeLabel() });
      view.querySelector(".ordax-notes-save-status").textContent = persistenceStatusText({ sessionSaved: false });
      view.querySelector(".ordax-notes-references").hidden = true;
      const intelligencePanel = view.querySelector("[data-notes-intelligence]");
      if (intelligencePanel) intelligencePanel.hidden = true;
      syncEditorStatistics(view, null);
      return;
    }

    empty.hidden = true;
    documentView.hidden = false;
    const project = state.document.projects.find((candidate) => candidate.id === note.projectId);
    const readOnly = note.deletedAt !== null;
    view.querySelector(".ordax-notes-breadcrumb").textContent = t("notes.breadcrumb", { project: project?.name ?? t("notes.home") });
    documentView.dataset.deleted = String(readOnly);
    const active = documentObject.activeElement;
    const title = view.querySelector("[data-notes-title]");
    const body = view.querySelector("[data-notes-body]");
    if (view.dataset.renderedNoteId !== note.id) {
      title.value = note.title;
      renderNotesRichBody(body, note.richBody);
      view.dataset.renderedNoteId = note.id;
      lastEditorRange = null;
    } else {
      if (active !== title && !editorSave.isPending(note.id)) title.value = note.title;
      if (active !== body && !editorSave.isPending(note.id)) renderNotesRichBody(body, note.richBody);
    }
    title.readOnly = readOnly;
    body.contentEditable = readOnly ? "false" : "true";
    body.setAttribute("aria-readonly", String(readOnly));
    title.style.height = "auto";
    title.style.height = `${Math.min(150, Math.max(58, title.scrollHeight))}px`;

    const meta = view.querySelector(".ordax-notes-meta");
    meta.textContent = readOnly
      ? t("notes.meta.trash", { project: project?.name ?? t("notes.home") })
      : t("notes.meta.local", { project: project?.name ?? t("notes.home") });
    const star = view.querySelector(".ordax-notes-star");
    star.textContent = note.favorite ? "★" : "☆";
    star.setAttribute("aria-label", note.favorite ? t("notes.favorite.remove") : t("notes.favorite.add"));
    const duplicateAction = view.querySelector(".ordax-notes-duplicate");
    const menuAction = view.querySelector(".ordax-notes-trash-action");
    const permanentDeleteAction = view.querySelector(".ordax-notes-delete-forever");
    duplicateAction.hidden = note.deletedAt !== null;
    duplicateAction.disabled = note.deletedAt !== null || state.document.notes.length >= MAX_NOTES;
    duplicateAction.title = state.document.notes.length >= MAX_NOTES
      ? t("notes.capacity.notes", { limit: MAX_NOTES })
      : t("notes.action.duplicate");
    menuAction.textContent = note.deletedAt === null ? t("notes.action.trashShort") : t("notes.action.restore");
    menuAction.dataset.notesAction = note.deletedAt === null ? "trash-note" : "restore-note";
    permanentDeleteAction.hidden = note.deletedAt === null;
    renderMoveProjects(view, note);
    renderInlineMedia(view, note);
    renderTasks(view, note);
    renderReferences(view, note);

    const intelligencePanel = view.querySelector("[data-notes-intelligence]");
    const intelligenceStatus = view.querySelector("[data-notes-intelligence-status]");
    const intelligenceAnswer = view.querySelector("[data-notes-intelligence-answer]");
    if (intelligencePanel && intelligenceStatus && intelligenceAnswer) {
      const belongsToCurrent = intelligenceNoteId === note.id;
      intelligencePanel.hidden = !belongsToCurrent;
      if (belongsToCurrent) {
        intelligenceStatus.textContent = intelligencePending
          ? t("notes.intelligence.analyzing")
          : intelligenceErrorMessageId
            ? t(intelligenceErrorMessageId)
            : t("notes.intelligence.done");
        intelligenceAnswer.textContent = intelligenceResult;
        intelligenceAnswer.hidden = !intelligenceResult;
      }
    }

    const saved = view.querySelector(".ordax-notes-save-status");
    saved.textContent = readOnly
      ? t("notes.persistence.trashRestoreToEdit")
      : persistenceStatusText({ editorPending: editorSave.isPending(note.id) });
    view.querySelector(".ordax-notes-offline-status").textContent = readOnly
      ? t("notes.persistence.readOnly")
      : state.persistence.scope === "device"
        ? t("notes.persistence.offline")
        : t("notes.persistence.sessionOnly");
    view.querySelector(".ordax-notes-device").textContent =
      state.persistence.scope === "device" ? t("notes.persistence.device") : t("notes.persistence.sessionDevice");
    syncEditorStatistics(view, note, body.innerText ?? body.textContent ?? note.body);
  };

  const render = () => {
    const windowNode = root.querySelector(NOTES_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(NOTES_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      flushEditor();
      imagePreviewCache.clear();
      mountedSlot = null;
      return;
    }
    const renderLocale = localization.getLocale();
    const localeChanged =
      slot.dataset.ordaxNotesMounted
      && slot.dataset.ordaxNotesLocale !== renderLocale;
    if (!slot.dataset.ordaxNotesMounted || localeChanged) {
      if (localeChanged) flushEditor();
      slot.replaceChildren(buildShell(documentObject, t));
      slot.dataset.ordaxNotesMounted = "true";
      slot.dataset.ordaxNotesLocale = renderLocale;
    }
    mountedSlot = slot;
    const view = slot.querySelector("[data-ordax-notes-view]");
    renderProjects(view);
    renderList(view);
    renderEditor(view);
  };

  const selectFirstVisible = () => {
    const first = visibleNotes(state.document, mode, query, newestFirst, localization.getLocale())[0];
    if (first) runtime.selectNote(first.id);
  };

  const openWebReference = (value) => {
    const parsed = parseNotesWebHref(value);
    if (!parsed) return false;
    if (activationPort) {
      activationPort.publish({ appId: "internet", target: parsed.href });
      return true;
    }
    windowObject.open?.(parsed.href, "_blank", "noopener,noreferrer");
    return typeof windowObject.open === "function";
  };

  const createNewNote = () => {
    if (state.document.notes.length >= MAX_NOTES) return false;
    resetReferenceFlow();
    flushEditor();
    mode = "project";
    runtime.createNote(state.document.selectedProjectId);
    queueMicrotask(() => mountedSlot?.querySelector("[data-notes-title]")?.select());
    return true;
  };

  const focusNotesSearch = () => {
    const search = mountedSlot?.querySelector("[data-notes-search]");
    if (
      typeof windowObject.HTMLInputElement !== "function"
      || !(search instanceof windowObject.HTMLInputElement)
    ) return false;
    search.focus();
    search.select();
    return true;
  };

  const promptEditorLink = (body) => {
    const input = windowObject.prompt?.(t("notes.prompt.editorLink"));
    if (!input) return false;
    const parsed = parseNotesWebHref(input);
    if (!parsed) {
      windowObject.alert?.(t("notes.prompt.invalidWebAddress"));
      return false;
    }
    if (!applyNotesRichLink(body, parsed.href)) {
      windowObject.alert?.(t("notes.prompt.selectTextForLink"));
      return false;
    }
    return true;
  };

  const onClick = (event) => {
    const editorLink = event.target.closest?.("[data-notes-body] a");
    if (editorLink && mountedSlot?.contains(editorLink)) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        openWebReference(editorLink.href);
      }
      return;
    }
    const actionNode = event.target.closest("[data-notes-action]");
    if (!actionNode || !mountedSlot?.contains(actionNode)) return;
    const action = actionNode.dataset.notesAction;
    const note = currentNote();

    if (action === "intelligence-summary") {
      if (!note || note.deletedAt !== null || !intelligencePort || intelligenceSnapshot?.state !== "ready" || intelligencePending) {
        return;
      }
      flushEditor(note.id);
      const latest = currentNote();
      if (!latest) return;
      intelligencePending = true;
      intelligenceNoteId = latest.id;
      intelligenceResult = "";
      intelligenceErrorMessageId = null;
      render();
      void summarizeDocumentWithIntelligence(intelligencePort, {
        id: latest.id,
        title: latest.title || t("notes.note.untitled"),
        text: latest.body || t("notes.note.emptyBody"),
        provenance: `notes:${latest.id}:device-local`,
      }).then((response) => {
        if (destroyed || intelligenceNoteId !== latest.id) return;
        intelligenceResult = response.text;
      }).catch(() => {
        if (destroyed || intelligenceNoteId !== latest.id) return;
        intelligenceErrorMessageId = "notes.intelligence.failed";
      }).finally(() => {
        if (destroyed || intelligenceNoteId !== latest.id) return;
        intelligencePending = false;
        render();
      });
      return;
    }

    if (action === "new-note") {
      createNewNote();
      return;
    }
    if (action === "new-project") {
      if (state.document.projects.length >= MAX_NOTE_PROJECTS) return;
      const name = windowObject.prompt?.(t("notes.prompt.newProjectName"));
      if (name?.trim()) {
        projectMenuId = null;
        flushEditor();
        mode = "project";
        runtime.createProject(name);
      }
      return;
    }
    if (action === "project-actions") {
      const projectId = actionNode.dataset.projectId;
      projectMenuId = projectMenuId === projectId ? null : projectId;
      renderProjects(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (action === "rename-project") {
      const projectId = actionNode.dataset.projectId;
      const project = state.document.projects.find((candidate) => candidate.id === projectId);
      if (!project) return;
      const name = windowObject.prompt?.(t("notes.prompt.renameProject"), project.name);
      if (name?.trim()) {
        projectMenuId = null;
        runtime.renameProject(projectId, name);
      }
      return;
    }
    if (action === "remove-project") {
      const projectId = actionNode.dataset.projectId;
      const project = state.document.projects.find((candidate) => candidate.id === projectId);
      if (!project || project.id === NOTES_HOME_PROJECT_ID) return;
      const noteCount = state.document.notes.filter((candidate) => candidate.projectId === projectId).length;
      const confirmed = windowObject.confirm?.(
        noteCount > 0
          ? t(noteCount === 1 ? "notes.confirm.removeProjectWithOneNote" : "notes.confirm.removeProjectWithNotes", { name: project.name, count: noteCount, home: t("notes.home") })
          : t("notes.confirm.removeProjectEmpty", { name: project.name }),
      );
      if (confirmed) {
        projectMenuId = null;
        flushEditor();
        mode = "project";
        runtime.removeProject(projectId);
      }
      return;
    }
    if (action === "select-project") {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      mode = "project";
      runtime.selectProject(actionNode.dataset.projectId);
      return;
    }
    if (action === "select-note") {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      runtime.selectNote(actionNode.dataset.noteId);
      return;
    }
    if (["view-all", "view-favorites", "view-recent", "view-trash"].includes(action)) {
      projectMenuId = null;
      resetReferenceFlow();
      flushEditor();
      mode = action.replace("view-", "");
      render();
      const selected = currentNote();
      const visible = visibleNotes(state.document, mode, query, newestFirst, localization.getLocale());
      if (!selected || !visible.some((item) => item.id === selected.id)) selectFirstVisible();
      return;
    }
    if (action === "sort") {
      newestFirst = !newestFirst;
      actionNode.textContent = newestFirst ? "≡" : "≣";
      actionNode.title = newestFirst ? t("notes.action.sortNewest") : t("notes.action.sortOldest");
      renderList(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (action === "empty-trash") {
      const deletedCount = state.document.notes.filter((candidate) => candidate.deletedAt !== null).length;
      if (deletedCount === 0) return;
      const confirmed = windowObject.confirm?.(
        deletedCount === 1
          ? t("notes.confirm.emptyTrashOne")
          : t("notes.confirm.emptyTrashMany", { count: deletedCount }),
      );
      if (confirmed) {
        resetReferenceFlow();
        flushEditor();
        runtime.emptyTrash();
      }
      return;
    }
    if (!note) return;
    if (note.deletedAt !== null && DELETED_NOTE_MUTATIONS.has(action)) return;

    const body = mountedSlot.querySelector("[data-notes-body]");
    if (action === "favorite") runtime.toggleFavorite(note.id);
    if (action === "duplicate-note" && state.document.notes.length < MAX_NOTES) {
      resetReferenceFlow();
      flushEditor();
      mode = "project";
      runtime.duplicateNote(note.id);
      const menu = mountedSlot?.querySelector(".ordax-notes-menu");
      if (menu) menu.hidden = true;
      queueMicrotask(() => mountedSlot?.querySelector("[data-notes-title]")?.select());
    }
    if (action === "add-task" && note.tasks.length < MAX_NOTE_TASKS) runtime.addTask(note.id);
    if (action === "remove-task") runtime.removeTask(note.id, actionNode.dataset.taskId);
    if (action === "move-note-project") {
      const projectId = actionNode.dataset.projectId;
      const target = state.document.projects.find((project) => project.id === projectId);
      if (target && target.id !== note.projectId) {
        flushEditor();
        mode = "project";
        runtime.moveNote(note.id, target.id);
        const menu = mountedSlot?.querySelector(".ordax-notes-menu");
        if (menu) menu.hidden = true;
      }
    }
    if (action === "trash-note") {
      resetReferenceFlow();
      flushEditor();
      runtime.trashNote(note.id);
    }
    if (action === "restore-note") {
      const projectId = note.projectId;
      runtime.restoreNote(note.id);
      if (mode === "trash") {
        const next = visibleNotes(state.document, "trash", query, newestFirst, localization.getLocale())[0];
        if (next) {
          runtime.selectNote(next.id);
        } else {
          mode = "project";
          runtime.selectProject(projectId);
        }
      }
    }
    if (action === "delete-note-forever" && note.deletedAt !== null) {
      const confirmed = windowObject.confirm?.(
        t("notes.confirm.deleteForever", { title: note.title || t("notes.note.untitled") }),
      );
      if (confirmed) {
        resetReferenceFlow();
        runtime.permanentlyDeleteNote(note.id);
        if (mode === "trash") selectFirstVisible();
      }
    }
    if (action === "toggle-references") {
      referencesOpen = !referencesOpen;
      render();
    }
    if (action === "toggle-menu") {
      const menu = mountedSlot.querySelector(".ordax-notes-menu");
      menu.hidden = !menu.hidden;
    }
    if (action === "bold") {
      restoreEditorRange();
      toggleNotesRichInlineMark(body, "bold");
      syncEditorToolbar();
    }
    if (action === "italic") {
      restoreEditorRange();
      toggleNotesRichInlineMark(body, "italic");
      syncEditorToolbar();
    }
    if (action === "insert-link") {
      restoreEditorRange();
      promptEditorLink(body);
      syncEditorToolbar();
    }
    if (
      action === "insert-image"
      && filePort
      && note.references.length < MAX_NOTE_REFERENCES
    ) {
      referencesOpen = true;
      referenceNoteId = note.id;
      referenceChooserOpen = false;
      void filePicker.open("image");
    }
    if (action === "undo") {
      restoreEditorRange();
      undoNotesRichEditor(body);
      syncEditorToolbar();
    }
    if (action === "add-reference") {
      if (note.references.length >= MAX_NOTE_REFERENCES) return;
      referenceNoteId = note.id;
      referenceChooserOpen = !referenceChooserOpen;
      filePicker.close();
      render();
    }
    if (action === "add-link-reference") {
      if (note.references.length >= MAX_NOTE_REFERENCES) return;
      referenceNoteId = note.id;
      const input = windowObject.prompt?.(t("notes.prompt.referenceAddress"));
      if (!input) return;
      const parsed = parseNotesWebHref(input);
      if (!parsed) {
        windowObject.alert?.(t("notes.prompt.invalidWebAddress"));
        return;
      }
      const title = windowObject.prompt?.(t("notes.prompt.referenceTitle"), parsed.host) || parsed.host;
      resetReferenceFlow();
      runtime.addReference(note.id, createNotesLinkReference(parsed.href, title));
    }
    if (
      action === "add-file-reference"
      && filePort
      && note.references.length < MAX_NOTE_REFERENCES
    ) {
      referenceNoteId = note.id;
      referenceChooserOpen = false;
      void filePicker.open("file");
    }
    if (action === "close-file-picker") {
      resetReferenceFlow();
      render();
    }
    if (action === "file-picker-up" && filePort) {
      void filePicker.up();
    }
    if (action === "file-picker-open-directory" && filePort) {
      void filePicker.navigate(actionNode.dataset.filePath);
    }
    if (action === "file-picker-select-file") {
      filePicker.select(actionNode.dataset.filePath);
    }
    if (
      action === "attach-file-reference"
      && referenceNoteId === note.id
      && note.references.length < MAX_NOTE_REFERENCES
    ) {
      const selection = filePicker.consumeSelection();
      if (selection) {
        const title = selection.path.split("/").filter(Boolean).at(-1) || t("notes.file.fallbackTitle");
        referenceChooserOpen = false;
        referenceNoteId = null;
        runtime.addReference(note.id, {
          kind: "file",
          title,
          detail: "",
          path: selection.path,
        });
      }
    }
    if (action === "open-file-reference" && activationPort) {
      const path = actionNode.dataset.filePath;
      if (path) activationPort.publish({ appId: "files", target: notesParentLogicalPath(path) });
    }
    if (action === "remove-reference") {
      runtime.removeReference(note.id, actionNode.dataset.referenceId);
    }
  };

  const onInput = (event) => {
    if (!mountedSlot?.contains(event.target)) return;
    if (event.target.matches("[data-notes-search]")) {
      query = event.target.value.trim();
      renderList(mountedSlot.querySelector("[data-ordax-notes-view]"));
      return;
    }
    if (event.target.matches("[data-notes-title], [data-notes-body]")) {
      const note = currentNote();
      if (!note || note.deletedAt !== null) return;
      if (event.target.matches("[data-notes-body]")) {
        normalizeNotesRichEditor(event.target);
        lastEditorRange = captureNotesRichSelection(event.target) ?? lastEditorRange;
        syncEditorToolbar();
        const view = mountedSlot.querySelector("[data-ordax-notes-view]");
        syncEditorStatistics(
          view,
          note,
          event.target.innerText ?? event.target.textContent ?? note.body,
        );
      }
      scheduleSave();
      if (event.target.matches("[data-notes-title]")) {
        event.target.style.height = "auto";
        event.target.style.height = `${Math.min(150, Math.max(58, event.target.scrollHeight))}px`;
      }
    }
  };

  const onChange = (event) => {
    if (!mountedSlot?.contains(event.target)) return;
    const note = currentNote();
    if (!note || note.deletedAt !== null) return;
    if (event.target.matches("[data-notes-task-done]")) {
      runtime.updateTask(note.id, event.target.dataset.taskId, { done: event.target.checked });
    }
    if (event.target.matches("[data-notes-task-text]")) {
      runtime.updateTask(note.id, event.target.dataset.taskId, { text: event.target.value });
    }
    if (event.target.matches("[data-notes-format]")) {
      const body = mountedSlot.querySelector("[data-notes-body]");
      restoreEditorRange();
      const blockType = {
        text: "paragraph",
        h2: "heading",
        list: "bullet",
        quote: "quote",
      }[event.target.value] ?? "paragraph";
      setNotesRichBlockType(body, blockType);
      syncEditorToolbar();
    }
  };

  const onPointerDown = (event) => {
    const actionNode = event.target.closest?.("[data-notes-action]");
    if (!actionNode || !mountedSlot?.contains(actionNode)) return;
    if (EDITOR_FORMAT_ACTIONS.has(actionNode.dataset.notesAction)) {
      event.preventDefault();
    }
  };

  const onPaste = (event) => {
    const note = currentNote();
    if (!note || note.deletedAt !== null) return;
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (body && (event.target === body || body.contains(event.target))) {
      pastePlainTextIntoNotesEditor(body, event);
    }
  };

  const onDrop = (event) => {
    const note = currentNote();
    if (!note || note.deletedAt !== null) return;
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (body && (event.target === body || body.contains(event.target))) {
      preventNotesRichDrop(event);
    }
  };

  const onSelectionChange = () => {
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (!body) return;
    const range = captureNotesRichSelection(body);
    if (range) {
      lastEditorRange = range;
      syncEditorToolbar();
    }
  };

  const onWorkspaceKeyDown = (event) => {
    if (!mountedSlot?.contains(event.target) || event.isComposing) return;

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && !event.altKey && !event.shiftKey) {
      const key = String(event.key ?? "").toLocaleLowerCase("en-US");
      if (key === "n") {
        event.preventDefault();
        createNewNote();
        return;
      }
      if (key === "f") {
        event.preventDefault();
        focusNotesSearch();
        return;
      }
    }

    if (event.key === "Enter" && event.target.matches?.("[data-notes-title]")) {
      const note = currentNote();
      if (!note || note.deletedAt !== null) return;
      event.preventDefault();
      flushEditor();
      focusEditorBody();
      return;
    }

    if (event.key !== "Escape") return;
    let handled = false;

    if (event.target.matches?.("[data-notes-search]") && event.target.value) {
      event.target.value = "";
      query = "";
      handled = true;
    }

    const menu = mountedSlot.querySelector(".ordax-notes-menu");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      handled = true;
    }

    if (projectMenuId !== null) {
      projectMenuId = null;
      handled = true;
    }

    if (referenceChooserOpen || filePicker.getSnapshot().open) {
      resetReferenceFlow();
      handled = true;
    }

    if (!handled) return;
    event.preventDefault();
    render();
  };

  const onEditorKeyDown = (event) => {
    const note = currentNote();
    if (!note || note.deletedAt !== null) return;
    const body = mountedSlot?.querySelector("[data-notes-body]");
    if (!body || !(event.target === body || body.contains(event.target))) return;

    if (handleNotesRichBlockKeyDown(body, event)) {
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier || event.altKey) return;

    const key = String(event.key ?? "").toLocaleLowerCase("en-US");
    if (key === "s") {
      event.preventDefault();
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      flushEditor();
      syncEditorToolbar();
      return;
    }
    if (key === "b") {
      event.preventDefault();
      toggleNotesRichInlineMark(body, "bold");
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "i") {
      event.preventDefault();
      toggleNotesRichInlineMark(body, "italic");
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "k") {
      event.preventDefault();
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      promptEditorLink(body);
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
      return;
    }
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoNotesRichEditor(body);
      lastEditorRange = captureNotesRichSelection(body) ?? lastEditorRange;
      syncEditorToolbar();
    }
  };

  const onReferenceOpen = (event) => {
    const editorLink = event.target.closest?.("[data-notes-body] a");
    if (editorLink && mountedSlot?.contains(editorLink)) {
      event.preventDefault();
      return;
    }
    const card = event.target.closest(".ordax-notes-ref-card[data-href]");
    if (!card || event.target.closest("[data-notes-action]")) return;
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openWebReference(card.dataset.href);
  };

  root.addEventListener("click", onClick);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("paste", onPaste);
  root.addEventListener("drop", onDrop);
  root.addEventListener("keydown", onWorkspaceKeyDown);
  root.addEventListener("keydown", onEditorKeyDown);
  root.addEventListener("dblclick", onReferenceOpen);
  root.addEventListener("keydown", onReferenceOpen);
  documentObject.addEventListener("selectionchange", onSelectionChange);
  const unsubscribeRuntime = runtime.subscribe((next) => {
    state = next;
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeIntelligence = intelligencePort?.subscribe((next) => {
    intelligenceSnapshot = next;
    if (!destroyed) render();
  });
  const unsubscribeFilePicker = filePicker.subscribe(() => {
    if (!destroyed) render();
  });
  render();

  return Object.freeze({
    destroy() {
      editorSave.destroy();
      destroyed = true;
      filePicker.destroy();
      imagePreviewCache.destroy();
      unsubscribeRuntime?.();
      unsubscribeRender?.();
      unsubscribeIntelligence?.();
      unsubscribeFilePicker?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("paste", onPaste);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("keydown", onWorkspaceKeyDown);
      root.removeEventListener("keydown", onEditorKeyDown);
      root.removeEventListener("dblclick", onReferenceOpen);
      root.removeEventListener("keydown", onReferenceOpen);
      documentObject.removeEventListener("selectionchange", onSelectionChange);
      lastEditorRange = null;
      mountedSlot = null;
    },
  });
}

import { assertAppActivationPort } from "../../../contracts/app-activation.mjs";
import { assertIntelligenceContextSharePort } from "../../../contracts/intelligence-context-share.mjs";
import { encodeIntelligenceHandoffTarget } from "../../../contracts/intelligence-handoff.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { createDocumentIntelligenceContext } from "../../../services/intelligence/client-actions.mjs";
import { assertNotesRuntime } from "../domain/runtime.mjs";

const WINDOW_SELECTOR = '[data-window-id="notes"]';
const EXTENSION_SELECTOR = '[data-app-extension="notes-workspace"]';
const ACTION_SELECTOR = "[data-notes-intelligence-handoff-action]";
const NOTE_CONTEXT_SOURCE_ID = "note-selection";

function selectedNote(snapshot) {
  const noteId = snapshot.document.selectedNoteId;
  return snapshot.document.notes.find((note) => note.id === noteId) ?? null;
}

export function mountNotesIntelligenceHandoffControls(
  root,
  notesRuntime,
  surfaceLifecycle,
  {
    appActivation = null,
    intelligenceContextShare = null,
  } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Notes Intelligence handoff controls require a Surface root");
  }
  const runtime = assertNotesRuntime(notesRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const activation = appActivation === null ? null : assertAppActivationPort(appActivation);
  const contextShare = intelligenceContextShare === null
    ? null
    : assertIntelligenceContextSharePort(intelligenceContextShare);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let state = runtime.getSnapshot();
  let destroyed = false;

  const workspace = () => root.querySelector(`${WINDOW_SELECTOR} ${EXTENSION_SELECTOR}`);

  const render = () => {
    if (destroyed) return;
    const slot = workspace();
    const toolbar = slot?.querySelector(".ordax-notes-toolbar") ?? null;
    if (!toolbar || activation === null || contextShare === null) {
      slot?.querySelector(ACTION_SELECTOR)?.remove();
      return;
    }

    let action = toolbar.querySelector(ACTION_SELECTOR);
    if (!action) {
      action = documentObject.createElement("button");
      action.type = "button";
      action.className = "ordax-notes-tool ordax-notes-intelligence-action";
      action.dataset.notesIntelligenceHandoffAction = "";
      toolbar.append(action);
    }

    const note = selectedNote(state);
    action.disabled = !note || note.deletedAt !== null;
    action.textContent = `↗  ${t("app.intelligence.title")}`;
    action.setAttribute("aria-label", t("notes.intelligence.summaryAria"));
    action.title = t("notes.intelligence.summaryAria");
  };

  const onClick = (event) => {
    const action = event.target?.closest?.(ACTION_SELECTOR);
    const slot = workspace();
    if (!action || !slot?.contains(action) || activation === null || contextShare === null) return;

    const note = selectedNote(state);
    if (!note || note.deletedAt !== null) return;

    const titleInput = slot.querySelector("[data-notes-title]");
    const bodyInput = slot.querySelector("[data-notes-body]");
    const title = titleInput?.value?.trim() || note.title || t("notes.note.untitled");
    const text = bodyInput?.innerText?.trim()
      || bodyInput?.textContent?.trim()
      || note.body
      || t("notes.note.emptyBody");
    const target = Object.freeze({ kind: "document", id: note.id });

    contextShare.offer({
      sourceAppId: "notes",
      sourceId: NOTE_CONTEXT_SOURCE_ID,
      target,
      displayLabel: title,
      context: createDocumentIntelligenceContext({
        id: note.id,
        title,
        text,
        provenance: `ordax:notes:${note.id}:user-authorized-selection`,
      }),
      authority: "none",
      executable: false,
      toolExecution: false,
    });

    activation.publish({
      appId: "intelligence",
      target: encodeIntelligenceHandoffTarget({
        sourceAppId: "notes",
        mode: "ask",
        target,
        displayLabel: title,
        suggestedPrompt: t("notes.intelligence.summaryAria"),
        authority: "none",
        executable: false,
        toolExecution: false,
      }),
    });
  };

  const unsubscribeRuntime = runtime.subscribe((next) => {
    state = next;
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeLocalization = localization.subscribe(render);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeLocalization();
      unsubscribeRender();
      unsubscribeRuntime?.();
      root.removeEventListener("click", onClick);
      workspace()?.querySelector(ACTION_SELECTOR)?.remove();
    },
  });
}

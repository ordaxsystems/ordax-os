import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { NOTES_VERSION } from "./version.mjs";
import { createNotesRuntime } from "./domain/runtime.mjs";
import { mountNotesWorkspaceControls } from "./ui/workspace-controls.mjs";
import { createNotesAppDataStore } from "./services/app-data-store.mjs";

const NOTES_STYLESHEET_URL = new URL("./notes.css", import.meta.url).href;
const NOTES_STYLE_SELECTOR = 'link[data-ordax-component-style="notes"]';
const NOTES_BODY_SELECTOR = '[data-notes-body]';

async function mountNotesStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Notes runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(NOTES_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== NOTES_STYLESHEET_URL) {
      throw new TypeError("Notes component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = NOTES_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "notes";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Notes component stylesheet failed to load")),
      { once: true },
    );
  });

  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

function syncNotesEditorAccessibility(root, localization) {
  const editor = root.querySelector(NOTES_BODY_SELECTOR);
  if (!editor) return false;
  editor.setAttribute(
    "aria-label",
    `${localization.translate("notes.document.kicker")} ${localization.translate("notes.format.text")}`,
  );
  return true;
}

export async function resolveNotesPersistence({
  appData = null,
  createStore = null,
} = {}) {
  if (createStore !== null && typeof createStore !== "function") {
    throw new TypeError("Notes createStore must be a function or null");
  }
  if (appData === null) {
    return createStore?.() ?? null;
  }
  return createNotesAppDataStore(appData, {
    seedSnapshot: createStore === null
      ? null
      : () => createStore()?.load() ?? null,
  });
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "notes",
  version: NOTES_VERSION,
  async mount({
    root,
    createStore = null,
    appData = null,
    surfaceLifecycle,
    fileSpace = null,
    appActivation = null,
    intelligence = null,
  } = {}) {
    const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
    const releaseStyles = await mountNotesStyles(root);
    let notesRuntime = null;
    let controls = null;
    let unsubscribeLocale = null;
    let unsubscribeRender = null;

    const cleanup = () => {
      unsubscribeLocale?.();
      unsubscribeRender?.();
      controls?.destroy();
      notesRuntime?.destroy();
      releaseStyles();
    };

    try {
      const store = await resolveNotesPersistence({ appData, createStore });
      notesRuntime = createNotesRuntime({ store });
      controls = mountNotesWorkspaceControls(
        root,
        notesRuntime,
        lifecycle,
        { fileSpace, appActivation, intelligence },
      );
      const syncAccessibility = () => syncNotesEditorAccessibility(root, lifecycle.localization);
      unsubscribeRender = lifecycle.subscribeRender(syncAccessibility);
      unsubscribeLocale = lifecycle.localization.subscribe(syncAccessibility);
      syncAccessibility();

      let destroyed = false;
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          cleanup();
        },
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  },
});

import {
  COMPONENT_RUNTIME_SCHEMA,
} from "../../contracts/component-runtime.mjs";
import { assertFileSpacePort } from "../../contracts/file-space.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { mountFileSpaceControls } from "./file-space-controls.mjs";
import { filesComponent } from "../../apps/files/component.mjs";

const FILES_STYLESHEET_URL = new URL("./files.css", import.meta.url).href;

// The platform provides capabilities, not host filesystem paths or store keys.
// The same controller remains the only Files UI implementation during cutover.
async function attachStyles(root) {
  const documentObject = root.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Files component requires a document with head");
  }
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = FILES_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "files";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => reject(new Error("Files stylesheet failed to load")), { once: true });
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

function assertDedicatedRoot(root) {
  if (!(root instanceof Element) || typeof root.append !== "function") {
    throw new TypeError("Files component requires a dedicated Surface root Element");
  }
  if (root.childNodes.length !== 0) {
    throw new TypeError("Files component root must be empty before mount");
  }
  return root;
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: filesComponent.id,
  version: filesComponent.version,
  async mount({
    root,
    fileSpace,
    appActivation = null,
    surfaceLifecycle,
    recentFiles = null,
    projects = null,
  } = {}) {
    assertDedicatedRoot(root);
    const filePort = assertFileSpacePort(fileSpace);
    const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);

    // Never mount a capability-less fake explorer: missing host authority is
    // a health failure, not permission to access the filesystem directly.
    const releaseStyles = await attachStyles(root);
    let frame = null;
    let controls = null;
    let destroyed = false;
    try {
      const documentObject = root.ownerDocument;
      frame = documentObject.createElement("section");
      frame.dataset.windowId = "files";
      frame.className = "ordax-files-component-frame";
      const slot = documentObject.createElement("div");
      slot.dataset.appExtension = "file-space";
      frame.append(slot);
      root.append(frame);

      controls = mountFileSpaceControls(
        root, filePort, appActivation, lifecycle, { recentFiles, projects },
      );
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          try {
            controls.destroy();
          } finally {
            frame.remove();
            releaseStyles();
          }
        },
      });
    } catch (error) {
      try {
        controls?.destroy();
      } finally {
        frame?.remove();
        releaseStyles();
      }
      throw error;
    }
  },
});

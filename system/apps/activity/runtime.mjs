import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { ACTIVITY_VERSION } from "./version.mjs";
import { mountPersonalActivityControls } from "./ui/workspace-controls.mjs";

const ACTIVITY_STYLESHEET_URL = new URL("./activity.css", import.meta.url).href;
const ACTIVITY_STYLE_SELECTOR = 'link[data-ordax-component-style="activity"]';

async function mountActivityStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Activity runtime requires a document head for component styles");
  }
  const existing = documentObject.querySelector(ACTIVITY_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== ACTIVITY_STYLESHEET_URL) {
      throw new TypeError("Activity component stylesheet identity mismatch");
    }
    return () => {};
  }
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = ACTIVITY_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "activity";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Activity component stylesheet failed to load")),
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

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "activity",
  version: ACTIVITY_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    personalOrdax = null,
  } = {}) {
    const releaseStyles = await mountActivityStyles(root);
    let controls = null;
    const cleanup = () => {
      controls?.destroy();
      releaseStyles();
    };
    try {
      controls = mountPersonalActivityControls(root, personalOrdax, surfaceLifecycle);
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

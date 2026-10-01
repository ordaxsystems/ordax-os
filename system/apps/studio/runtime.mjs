import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { STUDIO_VERSION } from "./version.mjs";
import { probeStudioDeviceAgent } from "./device-agent-status.mjs";
import { mountStudioWorkspaceControls } from "./ui/workspace-controls.mjs";

const STYLESHEET_URL = new URL("./studio.css", import.meta.url).href;
const STYLE_SELECTOR = 'link[data-ordax-component-style="studio"]';

async function mountStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Studio runtime requires a document head for component styles");
  }
  const existing = documentObject.querySelector(STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== STYLESHEET_URL) {
      throw new TypeError("Studio component stylesheet identity mismatch");
    }
    return () => {};
  }
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "studio";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Studio component stylesheet failed to load")),
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
  componentId: "studio",
  version: STUDIO_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    deviceAgentCapabilities = null,
  } = {}) {
    const releaseStyles = await mountStyles(root);
    let controls = null;
    try {
      const status = await probeStudioDeviceAgent(deviceAgentCapabilities);
      controls = mountStudioWorkspaceControls(root, status, surfaceLifecycle);
      let destroyed = false;
      return Object.freeze({
        status,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          controls?.destroy();
          releaseStyles();
        },
      });
    } catch (error) {
      controls?.destroy();
      releaseStyles();
      throw error;
    }
  },
});

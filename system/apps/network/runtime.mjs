import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { createNetworkDraftRuntime } from "../../services/professional-network/draft.mjs";
import { NETWORK_APP_VERSION } from "./version.mjs";
import { mountNetworkWorkspaceControls } from "./ui/workspace-controls.mjs";

const STYLESHEET_URL = new URL("./network.css", import.meta.url).href;
const STYLE_SELECTOR = 'link[data-ordax-component-style="network"]';

async function mountStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Network runtime requires a document head for component styles");
  }
  const existing = documentObject.querySelector(STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== STYLESHEET_URL) {
      throw new TypeError("Network component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "network";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Network component stylesheet failed to load")),
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
  componentId: "network",
  version: NETWORK_APP_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    identitySession = null,
    spaceSelection = null,
  } = {}) {
    const releaseStyles = await mountStyles(root);
    const draft = identitySession && spaceSelection
      ? createNetworkDraftRuntime({ identitySession, spaceSelection })
      : null;
    let controls = null;

    try {
      controls = mountNetworkWorkspaceControls(root, {
        surfaceLifecycle,
        draftPort: draft,
      });
      let destroyed = false;
      return Object.freeze({
        draftAvailable: draft !== null,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          controls?.destroy();
          draft?.dispose();
          releaseStyles();
        },
      });
    } catch (error) {
      controls?.destroy();
      draft?.dispose();
      releaseStyles();
      throw error;
    }
  },
});

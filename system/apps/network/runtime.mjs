import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { NETWORK_APP_VERSION } from "./version.mjs";
import { createNetworkDraftRuntime } from "./draft-runtime.mjs";
import { mountNetworkWorkspaceControls } from "./ui/workspace-controls.mjs";

const NETWORK_STYLESHEET_URL = new URL("./network.css", import.meta.url).href;
const NETWORK_STYLE_SELECTOR = 'link[data-ordax-component-style="network"]';

async function mountNetworkStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Network runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(NETWORK_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== NETWORK_STYLESHEET_URL) {
      throw new TypeError("Network component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = NETWORK_STYLESHEET_URL;
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
    spaceSelection,
    surfaceLifecycle = null,
    networkTransport = null,
    readOnline = () => globalThis.navigator?.onLine === true,
    reportDiagnostic = null,
  } = {}) {
    if (spaceSelection === null || spaceSelection === undefined) {
      throw new Error("Network app requires a Space selection port");
    }

    const releaseStyles = await mountNetworkStyles(root);
    let drafts = null;
    let controls = null;

    try {
      drafts = createNetworkDraftRuntime({
        spaceSelection,
        transport: networkTransport,
        readOnline,
      });
      controls = mountNetworkWorkspaceControls(root, drafts, {
        surfaceLifecycle,
        onError(error) {
          reportDiagnostic?.("network-workspace", error);
        },
      });

      let destroyed = false;
      return Object.freeze({
        drafts,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          controls?.destroy();
          drafts?.dispose();
          releaseStyles();
        },
      });
    } catch (error) {
      controls?.destroy();
      drafts?.dispose();
      releaseStyles();
      throw error;
    }
  },
});

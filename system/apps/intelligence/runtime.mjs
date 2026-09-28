import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { createIntelligenceContextRegistry } from "../../services/intelligence/context-registry.mjs";
import { listFirstPartyGrantedIntelligenceContextSources } from "../../services/intelligence/first-party-context-sources.mjs";
import { createGrantedIntelligenceContextSource } from "../../services/intelligence/granted-context-source.mjs";
import { getDefaultIntelligenceContextSharingRuntime } from "../../services/intelligence/context-sharing-runtime.mjs";
import { createFirstPartyAppCatalogContextSource } from "./app-catalog-context.mjs";
import { mountIntelligenceChatControls } from "./ui/chat-controls.mjs";
import { INTELLIGENCE_APP_VERSION } from "./version.mjs";

const STYLESHEET_URL = new URL("./intelligence.css", import.meta.url).href;
const STYLE_SELECTOR = 'link[data-ordax-component-style="intelligence"]';

async function mountStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Intelligence runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== STYLESHEET_URL) {
      throw new TypeError("Intelligence component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "intelligence";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Intelligence component stylesheet failed to load")),
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
  componentId: "intelligence",
  version: INTELLIGENCE_APP_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    intelligence,
    intelligenceContextSharing = null,
  } = {}) {
    const releaseStyles = await mountStyles(root);
    let controls = null;
    try {
      const contextSharing = intelligenceContextSharing
        ?? getDefaultIntelligenceContextSharingRuntime();
      const grantedSources = listFirstPartyGrantedIntelligenceContextSources()
        .map((source) => createGrantedIntelligenceContextSource({
          ...source,
          grants: contextSharing.grants,
        }));
      const contextRegistry = createIntelligenceContextRegistry({
        sources: [
          createFirstPartyAppCatalogContextSource(),
          ...grantedSources,
        ],
      });
      controls = mountIntelligenceChatControls(
        root,
        intelligence,
        surfaceLifecycle,
        {
          contextRegistry,
          contextShare: contextSharing.share,
        },
      );
      let destroyed = false;
      return Object.freeze({
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

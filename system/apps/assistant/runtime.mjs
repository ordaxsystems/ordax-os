import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { ASSISTANT_VERSION } from "./version.mjs";
import { createAssistantConversationRuntime } from "./conversation.mjs";
import { mountAssistantConversationControls } from "./ui/conversation-controls.mjs";

const ASSISTANT_STYLESHEET_URL = new URL("./assistant.css", import.meta.url).href;
const ASSISTANT_STYLE_SELECTOR = 'link[data-ordax-component-style="assistant"]';

async function mountAssistantStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Assistant runtime requires a document head for component styles");
  }
  const existing = documentObject.querySelector(ASSISTANT_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== ASSISTANT_STYLESHEET_URL) {
      throw new TypeError("Assistant component stylesheet identity mismatch");
    }
    return () => {};
  }
  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = ASSISTANT_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "assistant";
  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Assistant component stylesheet failed to load")),
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
  componentId: "assistant",
  version: ASSISTANT_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    intelligence = null,
    memoryCapture = null,
    personalOrdax = null,
    identitySessionPort,
    spaceSelectionPort,
    profileActivationStatePort = null,
    appActivation = null,
  } = {}) {
    const releaseStyles = await mountAssistantStyles(root);
    let conversation = null;
    let controls = null;
    const cleanup = () => {
      controls?.destroy();
      conversation?.dispose();
      releaseStyles();
    };
    try {
      conversation = createAssistantConversationRuntime({
        intelligencePort: intelligence,
        memoryCapture,
        identitySessionPort,
        spaceSelectionPort,
        profileActivationStatePort,
      });
      controls = mountAssistantConversationControls(root, conversation, surfaceLifecycle, {
        personalOrdax,
        identitySessionPort,
        spaceSelectionPort,
        appActivation,
      });
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

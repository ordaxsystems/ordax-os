import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { NETWORK_APP_VERSION } from "./version.mjs";
import { createNetworkDraftRuntime } from "./draft-runtime.mjs";
import { mountNetworkWorkspaceControls } from "./ui/workspace-controls.mjs";

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

    const drafts = createNetworkDraftRuntime({
      spaceSelection,
      transport: networkTransport,
      readOnline,
    });
    let controls = null;

    try {
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
          drafts.dispose();
        },
      });
    } catch (error) {
      controls?.destroy();
      drafts.dispose();
      throw error;
    }
  },
});

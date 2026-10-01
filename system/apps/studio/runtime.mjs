import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { STUDIO_VERSION } from "./version.mjs";

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "studio",
  version: STUDIO_VERSION,
  async mount() {
    let destroyed = false;
    return Object.freeze({
      status: Object.freeze({
        schema: "ordax.studio-device-agent-status/1",
        state: "unavailable",
        capabilityCount: 0,
        readCount: 0,
        writeCount: 0,
        mutationAuthority: "none",
        capabilityIds: Object.freeze([]),
      }),
      destroy() {
        if (destroyed) return;
        destroyed = true;
      },
    });
  },
});

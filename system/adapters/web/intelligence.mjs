import {
  INTELLIGENCE_PORT_SCHEMA,
  validateIntelligenceRequest,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

/**
 * Honest Web fallback for the canonical Intelligence contract.
 * This adapter owns no provider, endpoint, credential, Memory or authority.
 */
export function createUnavailableWebIntelligencePort() {
  const snapshot = validateIntelligenceSnapshot({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  });
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Ordax Intelligence listener must be a function");
      }
      listener(snapshot);
      return () => {};
    },
    async respond(value) {
      validateIntelligenceRequest(value);
      throw new Error("Ordax Intelligence transport is unavailable");
    },
  });
}

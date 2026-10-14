import {
  assertIntelligencePort,
  validateIntelligenceRequest,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../../../contracts/intelligence.mjs";

function sameSnapshot(left, right) {
  return left.schema === right.schema
    && left.state === right.state
    && left.inferenceAvailable === right.inferenceAvailable
    && left.engineId === right.engineId
    && left.modelId === right.modelId
    && left.authority === right.authority
    && left.toolExecution === right.toolExecution;
}

/**
 * Thin presentation client over the canonical `ordax.intelligence/1` port.
 * It owns no provider, transport discovery, Memory, authority or persistence.
 * Snapshot identity stays stable until canonical semantic state changes.
 */
export function createIntelligenceClient(input) {
  assertIntelligencePort(input);
  const port = input;
  let snapshot = validateIntelligenceSnapshot(port.getSnapshot());

  const refresh = () => {
    const next = validateIntelligenceSnapshot(port.getSnapshot());
    if (sameSnapshot(snapshot, next)) return false;
    snapshot = next;
    return true;
  };

  return Object.freeze({
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Intelligence client listener must be a function");
      }
      let active = true;
      const release = port.subscribe(() => {
        if (!active) return;
        if (refresh()) listener();
      });
      if (typeof release !== "function") {
        throw new TypeError("Intelligence port subscription must return cleanup");
      }
      return () => { active = false; release(); };
    },
    /**
     * @param {string} prompt
     * @param {{ signal?: AbortSignal | null }} [options]
     */
    async ask(prompt, { signal = null } = {}) {
      refresh();
      if (snapshot.state !== "ready") {
        throw new Error("Ordax Intelligence is not ready");
      }
      if (signal !== null && !(signal instanceof AbortSignal)) {
        throw new TypeError("Intelligence client signal must be an AbortSignal");
      }
      const request = validateIntelligenceRequest({
        intent: "ask",
        prompt,
        context: [],
        maxTokens: 512,
      });
      const response = await port.respond(request, { signal });
      return validateIntelligenceResponse(response);
    },
  });
}

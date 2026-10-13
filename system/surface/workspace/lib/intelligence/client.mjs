import {
  assertIntelligencePort,
  validateIntelligenceRequest,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../../../contracts/intelligence.mjs";

/**
 * Thin presentation client over the canonical `ordax.intelligence/1` port.
 * It owns no provider, transport discovery, Memory, authority or persistence.
 */
export function createIntelligenceClient(input) {
  assertIntelligencePort(input);
  const port = input;
  let snapshot = validateIntelligenceSnapshot(port.getSnapshot());

  const read = () => {
    snapshot = validateIntelligenceSnapshot(port.getSnapshot());
    return snapshot;
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
        read();
        listener();
      });
      if (typeof release !== "function") {
        throw new TypeError("Intelligence port subscription must return cleanup");
      }
      read();
      listener();
      return () => { active = false; release(); };
    },
    /**
     * @param {string} prompt
     * @param {{ signal?: AbortSignal | null }} [options]
     */
    async ask(prompt, { signal = null } = {}) {
      const current = read();
      if (current.state !== "ready") {
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

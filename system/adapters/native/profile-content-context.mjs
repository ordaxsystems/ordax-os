import {
  PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
  validateProfileContentContext,
} from "../../contracts/profile-content-context.mjs";

const ENDPOINT = "/__ordax/native/profile-content-context";

export function createNativeProfileContentContext(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Profile content context requires window.fetch");
  }
  let disposed = false;

  return Object.freeze({
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId, { query: retrievalQuery = null } = {}) {
      if (disposed) throw new Error("Profile content context is disposed");
      if (typeof spaceId !== "string" || !spaceId.trim() || spaceId.length > 160 || spaceId.includes("\0")) {
        throw new TypeError("Profile content context Space id is invalid");
      }
      const query = new URLSearchParams({ spaceId: spaceId.trim() });
      if (retrievalQuery !== null) {
        if (typeof retrievalQuery !== "string"
          || retrievalQuery.length > 256 || !retrievalQuery.trim()
          || retrievalQuery.includes("\0")) {
          throw new TypeError("Profile content retrieval query is invalid");
        }
        query.set("query", retrievalQuery.trim());
      }
      const response = await windowRef.fetch(`${ENDPOINT}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const error = new Error(`Native Profile content context unavailable: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const value = validateProfileContentContext(await response.json());
      if (value.spaceId !== spaceId.trim()) {
        throw new Error("Native Profile content context Space identity changed");
      }
      return value;
    },
    dispose() {
      disposed = true;
    },
  });
}

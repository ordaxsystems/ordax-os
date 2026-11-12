import {
  FIRST_RUN_CURSOR_SCHEMA,
  assertFirstRunCursorPort,
  safeFirstRunResumeStep,
  validateFirstRunCursor,
} from "../../contracts/first-run-cursor.mjs";

const ENDPOINT = "/__ordax/native/first-run-cursor";

export async function createNativeFirstRunCursor(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native first-run cursor requires window.fetch");
  }
  const response = await windowRef.fetch(ENDPOINT, {
    method: "GET", credentials: "same-origin", cache: "no-store",
  });
  if (!response.ok) throw new Error("First-run cursor unavailable");
  let snapshot = validateFirstRunCursor(await response.json());

  const port = {
    schema: FIRST_RUN_CURSOR_SCHEMA,
    load() { return snapshot; },
    async save(step) {
      const next = validateFirstRunCursor({
        schema: FIRST_RUN_CURSOR_SCHEMA,
        step: safeFirstRunResumeStep(step),
      });
      const reply = await windowRef.fetch(ENDPOINT, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!reply.ok) throw new Error("First-run cursor persistence failed");
      snapshot = next;
      return snapshot;
    },
  };
  return Object.freeze(assertFirstRunCursorPort(port));
}

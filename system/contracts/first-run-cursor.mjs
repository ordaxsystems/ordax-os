export const FIRST_RUN_CURSOR_SCHEMA = "ordax.first-run-cursor/1";
export const FIRST_RUN_CURSOR_STEPS = Object.freeze([
  "welcome", "regional", "network", "security", "account",
]);

const STEPS = new Set(FIRST_RUN_CURSOR_STEPS);

export function safeFirstRunResumeStep(step) {
  // No account selection, secrets or identity is persisted. Later stages must
  // re-enter the account step after a Surface restart.
  if (["privacy", "name", "ready"].includes(step)) return "account";
  return STEPS.has(step) ? step : "welcome";
}

export function validateFirstRunCursor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "schema,step"
      || value.schema !== FIRST_RUN_CURSOR_SCHEMA || !STEPS.has(value.step)) {
    throw new TypeError("Invalid first-run navigation cursor");
  }
  return Object.freeze({ schema: FIRST_RUN_CURSOR_SCHEMA, step: value.step });
}

export function assertFirstRunCursorPort(port) {
  if (!port || port.schema !== FIRST_RUN_CURSOR_SCHEMA
      || typeof port.load !== "function" || typeof port.save !== "function") {
    throw new TypeError("Invalid first-run cursor port");
  }
  validateFirstRunCursor(port.load());
  return port;
}

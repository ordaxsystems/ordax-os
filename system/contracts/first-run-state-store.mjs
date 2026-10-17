export const FIRST_RUN_STATE_STORE_SCHEMA = "ordax.first-run-state-store/1";
export const FIRST_RUN_STATE_SCHEMA = "ordax.first-run-state/1";

export const FIRST_RUN_SUPPORTED_LOCALES = Object.freeze(["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"]);
export const FIRST_RUN_PUBLIC_MVP_LOCALES = Object.freeze(["pt-BR", "en-US"]);
export const FIRST_RUN_SUPPORTED_TIME_ZONES = Object.freeze([
  "America/Bahia",
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Rio_Branco",
  "America/Noronha",
]);
export const FIRST_RUN_ACCOUNT_MODES = Object.freeze(["local-only", "identity"]);
// Only steps that need no identity or credential draft can be restored directly.
export const FIRST_RUN_RESUME_STEP_IDS = Object.freeze(["welcome", "regional", "network", "security", "account"]);

const SUPPORTED_LOCALES = new Set(FIRST_RUN_SUPPORTED_LOCALES);
const SUPPORTED_TIME_ZONES = new Set(FIRST_RUN_SUPPORTED_TIME_ZONES);
const ACCOUNT_MODES = new Set(FIRST_RUN_ACCOUNT_MODES);
const RESUME_STEPS = new Set(FIRST_RUN_RESUME_STEP_IDS);

export function createInitialFirstRunState() {
  return Object.freeze({
    schema: FIRST_RUN_STATE_SCHEMA,
    completed: false,
    locale: "pt-BR",
    timeZone: "America/Bahia",
    accountMode: null,
  });
}

export function validateFirstRunState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("First-run state must be an object");
  }
  if (value.schema !== FIRST_RUN_STATE_SCHEMA) {
    throw new TypeError(`Unsupported first-run state schema: ${String(value.schema)}`);
  }
  if (typeof value.completed !== "boolean") {
    throw new TypeError("First-run completed must be boolean");
  }
  if (!SUPPORTED_LOCALES.has(value.locale)) {
    throw new TypeError(`Unsupported first-run locale: ${String(value.locale)}`);
  }
  if (!SUPPORTED_TIME_ZONES.has(value.timeZone)) {
    throw new TypeError(`Unsupported first-run time zone: ${String(value.timeZone)}`);
  }

  const accountMode = value.accountMode ?? null;
  if (accountMode !== null && !ACCOUNT_MODES.has(accountMode)) {
    throw new TypeError(`Unsupported first-run account mode: ${String(accountMode)}`);
  }
  if (value.completed && accountMode === null) {
    throw new TypeError("Completed first-run state requires an account mode");
  }
  if (!value.completed && accountMode !== null) {
    throw new TypeError("Incomplete first-run state may not persist an account mode");
  }

  const hasResumeStep = Object.prototype.hasOwnProperty.call(value, "resumeStep");
  if (hasResumeStep && (value.completed || !RESUME_STEPS.has(value.resumeStep))) {
    throw new TypeError("First-run resume checkpoint requires an incomplete state and a safe step");
  }

  return Object.freeze({
    schema: FIRST_RUN_STATE_SCHEMA,
    completed: value.completed,
    locale: value.locale,
    timeZone: value.timeZone,
    accountMode,
    ...(hasResumeStep ? { resumeStep: value.resumeStep } : {}),
  });
}

export function assertFirstRunStateStore(store) {
  if (!store || typeof store !== "object") {
    throw new TypeError("First-run state store is required");
  }
  if (store.schema !== FIRST_RUN_STATE_STORE_SCHEMA) {
    throw new TypeError(`Unsupported first-run state store schema: ${String(store.schema)}`);
  }
  if (typeof store.load !== "function" || typeof store.save !== "function") {
    throw new TypeError("First-run state store must implement load() and save(snapshot)");
  }
  validateFirstRunState(store.load());
  return store;
}

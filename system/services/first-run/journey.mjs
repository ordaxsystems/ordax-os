export const FIRST_RUN_JOURNEY_SCHEMA = "ordax.first-run-journey/1";

export const FIRST_RUN_JOURNEY = Object.freeze([
  Object.freeze({ id: "welcome", label: "Início", domain: "introduction" }),
  Object.freeze({ id: "regional", label: "Região", domain: "regional" }),
  Object.freeze({ id: "network", label: "Rede", domain: "network", skippable: true }),
  Object.freeze({ id: "security", label: "Segurança", domain: "local-session", optional: true }),
  Object.freeze({ id: "account", label: "Conta", domain: "identity", optional: true }),
  Object.freeze({ id: "privacy", label: "Privacidade", domain: "privacy" }),
  Object.freeze({ id: "ready", label: "Pronto", domain: "completion" }),
]);

const byId = new Map(FIRST_RUN_JOURNEY.map(step => [step.id, step]));

if (byId.size !== FIRST_RUN_JOURNEY.length) {
  throw new Error("First-run journey step IDs must be unique");
}

export const FIRST_RUN_STEP_IDS = Object.freeze(FIRST_RUN_JOURNEY.map(step => step.id));
export const FIRST_RUN_STEP_LABELS = Object.freeze(FIRST_RUN_JOURNEY.map(step => step.label));

export function getFirstRunStep(id) {
  const step = byId.get(id);
  if (!step) throw new TypeError(`Unknown first-run step: ${String(id)}`);
  return step;
}

export function getFirstRunStepIndex(id) {
  const index = FIRST_RUN_STEP_IDS.indexOf(id);
  if (index < 0) throw new TypeError(`Unknown first-run step: ${String(id)}`);
  return index;
}

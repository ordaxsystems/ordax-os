import {
  defineComponentManifest,
  validateComponentId,
  validateComponentVersion,
} from "../../contracts/component-manifest.mjs";
import {
  COMPONENT_PROBATION_RESULT_SCHEMA,
} from "./probation-loader.mjs";
import {
  COMPONENT_PROMOTION_DECISION_SCHEMA,
  decidePendingComponentAction,
  validateComponentPromotionActionReason,
} from "./promotion-policy.mjs";

export const COMPONENT_PENDING_DECISION_PLAN_SCHEMA =
  "ordax.component-pending-decision-plan/1";

const SHA40_RE = /^[0-9a-f]{40}$/;
function exactProbationIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component probation receipt must be an object");
  }
  // Probation receipts are observations, not lifecycle capabilities.
  // Accept only the canonical loader fields and its documented diagnostic fields.
  const required = [
    "schema", "componentId", "version", "sourceCommit", "revision", "health",
  ];
  const allowed = new Set([...required, "error", "probeMode"]);
  const actual = Object.keys(value);
  if (actual.length < required.length
    || required.some((key) => !Object.hasOwn(value, key))
    || actual.some((key) => !allowed.has(key))) {
    throw new TypeError("Component probation receipt fields are not canonical");
  }
  if (Object.hasOwn(value, "error") && (
    value.health !== "failed"
    || typeof value.error !== "string"
    || !value.error.trim()
    || value.error.length > 512
  )) {
    throw new TypeError("Component probation diagnostic is invalid");
  }
  if (Object.hasOwn(value, "probeMode") && value.probeMode !== "import-contract") {
    throw new TypeError("Component probation probe mode is invalid");
  }
  if (value.schema !== COMPONENT_PROBATION_RESULT_SCHEMA) {
    throw new TypeError("Unsupported component probation receipt schema");
  }
  const componentId = validateComponentId(value.componentId);
  const version = validateComponentVersion(value.version);
  const sourceCommit = value.sourceCommit;
  if (typeof sourceCommit !== "string" || !SHA40_RE.test(sourceCommit)) {
    throw new TypeError("Component probation source commit is invalid");
  }
  const revision = value.revision;
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new TypeError("Component probation revision is invalid");
  }
  if (!["healthy", "failed"].includes(value.health)) {
    throw new TypeError("Component probation health is invalid");
  }
  return Object.freeze({
    componentId,
    version,
    sourceCommit,
    revision,
    health: value.health,
  });
}

export function validateComponentPendingDecisionPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component pending decision plan must be an object");
  }
  const expected = [
    "schema",
    "componentId",
    "version",
    "sourceCommit",
    "revision",
    "health",
    "action",
    "reason",
    "authority",
  ].sort();
  const actual = Object.keys(value).sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("Component pending decision plan fields are not canonical");
  }
  if (value.schema !== COMPONENT_PENDING_DECISION_PLAN_SCHEMA) {
    throw new TypeError("Unsupported component pending decision plan schema");
  }
  const componentId = validateComponentId(value.componentId);
  const version = validateComponentVersion(value.version);
  if (typeof value.sourceCommit !== "string" || !SHA40_RE.test(value.sourceCommit)) {
    throw new TypeError("Component pending decision plan source commit is invalid");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision <= 0) {
    throw new TypeError("Component pending decision plan revision is invalid");
  }
  if (!["healthy", "failed"].includes(value.health)) {
    throw new TypeError("Component pending decision plan health is invalid");
  }
  // A single action/reason vocabulary belongs to promotion-policy.mjs.
  validateComponentPromotionActionReason(value.action, value.reason);
  if (value.action === "reject" && value.health !== "failed") {
    throw new TypeError("Component pending rejection requires failed health");
  }
  if (value.action === "promote" && value.health !== "healthy") {
    throw new TypeError("Component pending promotion requires healthy health");
  }
  if (value.action === "hold" && value.health !== "healthy") {
    throw new TypeError("Exact failed probation cannot be held as healthy");
  }
  if (value.reason === "pending-health-unknown") {
    throw new TypeError("Exact probation plan cannot claim unknown health");
  }
  if (value.authority !== "none") {
    throw new TypeError("Component pending decision plan must remain authority:none");
  }
  return Object.freeze({
    schema: COMPONENT_PENDING_DECISION_PLAN_SCHEMA,
    componentId,
    version,
    sourceCommit: value.sourceCommit,
    revision: value.revision,
    health: value.health,
    action: value.action,
    reason: value.reason,
    authority: "none",
  });
}

export function createComponentPendingDecisionPlan({
  manifest,
  probationResult,
  canonicalTrustPinned,
  activationAllowed,
} = {}) {
  const component = defineComponentManifest(manifest);
  const identity = exactProbationIdentity(probationResult);
  if (
    component.id !== identity.componentId
    || component.version !== identity.version
  ) {
    throw new TypeError("Component pending decision manifest identity mismatch");
  }

  const decision = decidePendingComponentAction({
    manifest: component,
    health: identity.health,
    canonicalTrustPinned,
    activationAllowed,
  });
  if (
    decision.schema !== COMPONENT_PROMOTION_DECISION_SCHEMA
    || decision.componentId !== component.id
    || decision.version !== component.version
    || decision.health !== identity.health
    || decision.releaseMode !== component.releaseMode
    || decision.healthMode !== component.healthMode
  ) {
    throw new TypeError("Component promotion policy returned a mismatched decision");
  }
  validateComponentPromotionActionReason(decision.action, decision.reason);

  return validateComponentPendingDecisionPlan({
    schema: COMPONENT_PENDING_DECISION_PLAN_SCHEMA,
    componentId: identity.componentId,
    version: identity.version,
    sourceCommit: identity.sourceCommit,
    revision: identity.revision,
    health: identity.health,
    action: decision.action,
    reason: decision.reason,
    authority: "none",
  });
}

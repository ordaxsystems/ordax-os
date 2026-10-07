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
} from "./promotion-policy.mjs";

export const COMPONENT_PENDING_DECISION_PLAN_SCHEMA =
  "ordax.component-pending-decision-plan/1";

const SHA40_RE = /^[0-9a-f]{40}$/;
const PLAN_ACTION_REASONS = Object.freeze({
  hold: new Set([
    "pending-health-unknown",
    "release-mode-not-component-slot",
    "component-health-mode-none",
    "canonical-component-trust-not-pinned",
    "component-slot-activation-disabled",
  ]),
  reject: new Set(["pending-health-failed"]),
  promote: new Set(["eligible-for-promotion"]),
});

function exactProbationIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component probation receipt must be an object");
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
  const reasons = PLAN_ACTION_REASONS[value.action];
  if (!reasons || !reasons.has(value.reason)) {
    throw new TypeError("Component pending decision plan action/reason is invalid");
  }
  if (value.action === "reject" && value.health !== "failed") {
    throw new TypeError("Component pending rejection requires failed health");
  }
  if (value.action === "promote" && value.health !== "healthy") {
    throw new TypeError("Component pending promotion requires healthy health");
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
  if (decision.schema !== COMPONENT_PROMOTION_DECISION_SCHEMA) {
    throw new TypeError("Component promotion policy returned an invalid decision");
  }

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

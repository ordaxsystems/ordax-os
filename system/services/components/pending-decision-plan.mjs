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

  return Object.freeze({
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

import { defineComponentManifest } from "../../contracts/component-manifest.mjs";

export const COMPONENT_PROMOTION_DECISION_SCHEMA =
  "ordax.component-promotion-decision/1";

const HEALTH_VALUES = new Set(["unknown", "healthy", "failed"]);
// Promotion policy is the sole owner of valid actions and reason vocabulary.
const REASONS = Object.freeze({
  healthFailed: "pending-health-failed",
  healthUnknown: "pending-health-unknown",
  wrongReleaseMode: "release-mode-not-component-slot",
  noHealthMode: "component-health-mode-none",
  trustNotPinned: "canonical-component-trust-not-pinned",
  activationDisabled: "component-slot-activation-disabled",
  eligible: "eligible-for-promotion",
});
const REASONS_BY_ACTION = Object.freeze({
  hold: new Set([
    REASONS.healthUnknown, REASONS.wrongReleaseMode, REASONS.noHealthMode,
    REASONS.trustNotPinned, REASONS.activationDisabled,
  ]),
  reject: new Set([REASONS.healthFailed]),
  promote: new Set([REASONS.eligible]),
});

export function validateComponentPromotionActionReason(action, reason) {
  if (!Object.hasOwn(REASONS_BY_ACTION, action) || !REASONS_BY_ACTION[action].has(reason)) {
    throw new TypeError("Invalid component promotion action/reason pair");
  }
  return reason;
}

function boolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean`);
  }
  return value;
}

function decision(manifest, health, action, reason) {
  if (!ACTIONS.has(action)) {
    throw new TypeError("Unsupported component promotion action");
  }
  return Object.freeze({
    schema: COMPONENT_PROMOTION_DECISION_SCHEMA,
    componentId: manifest.id,
    version: manifest.version,
    releaseMode: manifest.releaseMode,
    healthMode: manifest.healthMode,
    health,
    action,
    reason,
  });
}

export function decidePendingComponentAction({
  manifest,
  health,
  canonicalTrustPinned,
  activationAllowed,
} = {}) {
  const component = defineComponentManifest(manifest);
  if (!HEALTH_VALUES.has(health)) {
    throw new TypeError("Pending component health must be unknown, healthy or failed");
  }
  const trustPinned = boolean(
    canonicalTrustPinned,
    "canonicalTrustPinned",
  );
  const canActivate = boolean(
    activationAllowed,
    "activationAllowed",
  );

  if (health === "failed") {
    return decision(component, health, "reject", REASONS.healthFailed);
  }
  if (health === "unknown") {
    return decision(component, health, "hold", REASONS.healthUnknown);
  }
  if (component.releaseMode !== "component-slot") {
    return decision(
      component,
      health,
      "hold",
      REASONS.wrongReleaseMode,
    );
  }
  if (component.healthMode === "none") {
    return decision(
      component,
      health,
      "hold",
      REASONS.noHealthMode,
    );
  }
  if (!trustPinned) {
    return decision(
      component,
      health,
      "hold",
      REASONS.trustNotPinned,
    );
  }
  if (!canActivate) {
    return decision(
      component,
      health,
      "hold",
      REASONS.activationDisabled,
    );
  }
  return decision(component, health, "promote", REASONS.eligible);
}

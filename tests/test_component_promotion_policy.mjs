import assert from "node:assert/strict";
import test from "node:test";

import { defineComponentManifest } from "../system/contracts/component-manifest.mjs";
// Synthetic, contract-only component fixture: the Internet product is no longer bundled.
const internetComponent = defineComponentManifest({
  id: "test-probation", title: "Synthetic Component", kind: "app", version: "0.3.0",
  releaseMode: "git-app", criticality: "optional", failureDomain: "app",
  restartScope: "component", healthMode: "runtime", owner: "test-fixture",
  dependencies: ["surface-shell"],
});
import {
  COMPONENT_PROMOTION_DECISION_SCHEMA,
  decidePendingComponentAction,
  validateComponentPromotionActionReason,
} from "../system/services/components/promotion-policy.mjs";

function slotInternet(overrides = {}) {
  return defineComponentManifest({
    ...internetComponent,
    releaseMode: "component-slot",
    ...overrides,
  });
}

test("failed pending health is a rejection decision, not promotion", () => {
  const result = decidePendingComponentAction({
    manifest: internetComponent,
    health: "failed",
    canonicalTrustPinned: false,
    activationAllowed: false,
  });
  assert.equal(result.schema, COMPONENT_PROMOTION_DECISION_SCHEMA);
  assert.equal(result.action, "reject");
  assert.equal(result.reason, "pending-health-failed");
  assert.equal(result.componentId, "test-probation");
  assert.equal(Object.isFrozen(result), true);
});

test("unknown pending health always holds", () => {
  const result = decidePendingComponentAction({
    manifest: slotInternet(),
    health: "unknown",
    canonicalTrustPinned: true,
    activationAllowed: true,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "pending-health-unknown");
});

test("healthy git-app synthetic git-app cannot be promoted", () => {
  const result = decidePendingComponentAction({
    manifest: internetComponent,
    health: "healthy",
    canonicalTrustPinned: true,
    activationAllowed: true,
  });
  assert.equal(internetComponent.releaseMode, "git-app");
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "release-mode-not-component-slot");
});

test("healthy component-slot remains held until canonical trust is pinned", () => {
  const result = decidePendingComponentAction({
    manifest: slotInternet(),
    health: "healthy",
    canonicalTrustPinned: false,
    activationAllowed: true,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "canonical-component-trust-not-pinned");
});

test("healthy trusted component-slot remains held while activation is disabled", () => {
  const result = decidePendingComponentAction({
    manifest: slotInternet(),
    health: "healthy",
    canonicalTrustPinned: true,
    activationAllowed: false,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "component-slot-activation-disabled");
});

test("only fully eligible healthy component-slot yields promote decision", () => {
  const result = decidePendingComponentAction({
    manifest: slotInternet(),
    health: "healthy",
    canonicalTrustPinned: true,
    activationAllowed: true,
  });
  assert.equal(result.action, "promote");
  assert.equal(result.reason, "eligible-for-promotion");
  assert.equal(result.releaseMode, "component-slot");
  assert.equal(result.healthMode, "runtime");
});

test("healthMode none blocks promotion even when other gates pass", () => {
  const manifest = slotInternet({ healthMode: "none" });
  const result = decidePendingComponentAction({
    manifest,
    health: "healthy",
    canonicalTrustPinned: true,
    activationAllowed: true,
  });
  assert.equal(result.action, "hold");
  assert.equal(result.reason, "component-health-mode-none");
});

test("policy rejects malformed booleans and health values", () => {
  assert.throws(
    () => decidePendingComponentAction({
      manifest: internetComponent,
      health: "maybe",
      canonicalTrustPinned: false,
      activationAllowed: false,
    }),
    /health/,
  );
  assert.throws(
    () => decidePendingComponentAction({
      manifest: internetComponent,
      health: "healthy",
      canonicalTrustPinned: "yes",
      activationAllowed: false,
    }),
    /canonicalTrustPinned/,
  );
});


test("promotion policy exclusively validates action/reason vocabulary", () => {
  assert.equal(
    validateComponentPromotionActionReason("hold", "component-slot-activation-disabled"),
    "component-slot-activation-disabled",
  );
  assert.equal(
    validateComponentPromotionActionReason("reject", "pending-health-failed"),
    "pending-health-failed",
  );
  assert.equal(
    validateComponentPromotionActionReason("promote", "eligible-for-promotion"),
    "eligible-for-promotion",
  );
  for (const [action, reason] of [
    ["promote", "pending-health-failed"],
    ["reject", "eligible-for-promotion"],
    ["hold", "eligible-for-promotion"],
    ["activate", "eligible-for-promotion"],
    ["promote", "unknown"],
  ]) {
    assert.throws(
      () => validateComponentPromotionActionReason(action, reason),
      /Invalid component promotion action/,
    );
  }
});

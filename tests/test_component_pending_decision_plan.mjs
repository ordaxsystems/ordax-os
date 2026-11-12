import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { defineComponentManifest } from "../system/contracts/component-manifest.mjs";
import {
  NATIVE_COMPONENT_PROBE_MODE_BY_ID,
} from "../system/services/components/probation-policy.generated.mjs";
// Synthetic, contract-only manifest using a component id currently granted probation by SSOT.
const internetComponent = defineComponentManifest({
  id: "notes", title: "Synthetic Component", kind: "app", version: "0.3.0",
  releaseMode: "git-app", criticality: "optional", failureDomain: "app",
  restartScope: "component", healthMode: "runtime", owner: "test-fixture",
  dependencies: ["surface-shell"],
});
import {
  COMPONENT_PENDING_DECISION_PLAN_SCHEMA,
  createComponentPendingDecisionPlan,
  validateComponentPendingDecisionPlan,
} from "../system/services/components/pending-decision-plan.mjs";

const COMMIT = "a".repeat(40);
const PENDING_DECISION_SOURCE = readFileSync(
  new URL("../system/services/components/pending-decision-plan.mjs", import.meta.url),
  "utf8",
);

function slotInternet(version = "0.4.0") {
  return defineComponentManifest({
    ...internetComponent,
    version,
    releaseMode: "component-slot",
  });
}

function receipt({
  health = "healthy",
  version = "0.4.0",
  componentId = "notes",
  sourceCommit = COMMIT,
  revision = 7,
  probeMode = NATIVE_COMPONENT_PROBE_MODE_BY_ID[componentId],
} = {}) {
  return {
    schema: "ordax.component-probation-result/1",
    componentId,
    version,
    sourceCommit,
    revision,
    health,
    probeMode,
  };
}

test("failed exact probation identity plans rejection without authority", () => {
  const plan = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt({ health: "failed" }),
    canonicalTrustPinned: false,
    activationAllowed: false,
  });

  assert.equal(plan.schema, COMPONENT_PENDING_DECISION_PLAN_SCHEMA);
  assert.equal(plan.action, "reject");
  assert.equal(plan.reason, "pending-health-failed");
  assert.equal(plan.authority, "none");
  assert.equal(plan.componentId, "notes");
  assert.equal(plan.version, "0.4.0");
  assert.equal(plan.sourceCommit, COMMIT);
  assert.equal(plan.revision, 7);
  assert.equal(Object.isFrozen(plan), true);
});

test("healthy candidate stays held until canonical trust and activation are both enabled", () => {
  for (const [canonicalTrustPinned, activationAllowed, reason] of [
    [false, false, "canonical-component-trust-not-pinned"],
    [false, true, "canonical-component-trust-not-pinned"],
    [true, false, "component-slot-activation-disabled"],
  ]) {
    const plan = createComponentPendingDecisionPlan({
      manifest: slotInternet(),
      probationResult: receipt(),
      canonicalTrustPinned,
      activationAllowed,
    });
    assert.equal(plan.action, "hold");
    assert.equal(plan.reason, reason);
    assert.equal(plan.authority, "none");
  }
});

test("only fully eligible healthy exact identity plans promotion", () => {
  const plan = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt(),
    canonicalTrustPinned: true,
    activationAllowed: true,
  });

  assert.equal(plan.action, "promote");
  assert.equal(plan.reason, "eligible-for-promotion");
  assert.equal(plan.authority, "none");
  assert.equal(plan.revision, 7);
});

test("identity drift and incomplete probation identity fail before policy decision", () => {
  assert.throws(
    () => createComponentPendingDecisionPlan({
      manifest: slotInternet(),
      probationResult: receipt({ version: "0.4.1" }),
      canonicalTrustPinned: false,
      activationAllowed: false,
    }),
    /manifest identity mismatch/,
  );

  for (const invalid of [
    receipt({ sourceCommit: "bad" }),
    receipt({ revision: 0 }),
    { ...receipt(), version: null },
  ]) {
    assert.throws(
      () => createComponentPendingDecisionPlan({
        manifest: slotInternet(),
        probationResult: invalid,
        canonicalTrustPinned: false,
        activationAllowed: false,
      }),
    );
  }
});

test("planner exposes no lifecycle or mutation methods", () => {
  const plan = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt(),
    canonicalTrustPinned: false,
    activationAllowed: false,
  });
  for (const forbidden of [
    "execute", "promote", "reject", "activate", "rollback",
    "install", "update", "remove", "setTrustAnchor",
  ]) {
    assert.equal(plan[forbidden], undefined);
  }
});


test("raw pending decision plans are revalidated fail closed", () => {
  const canonical = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt(),
    canonicalTrustPinned: false,
    activationAllowed: false,
  });

  assert.deepEqual(validateComponentPendingDecisionPlan({ ...canonical }), canonical);

  for (const invalid of [
    { ...canonical, authority: "platform-component-lifecycle" },
    { ...canonical, revision: 0 },
    { ...canonical, unexpected: true },
    { ...canonical, action: "promote", reason: "eligible-for-promotion", health: "failed" },
    { ...canonical, action: "reject", reason: "pending-health-failed", health: "healthy" },
    { ...canonical, action: "hold", reason: "eligible-for-promotion" },
  ]) {
    assert.throws(() => validateComponentPendingDecisionPlan(invalid));
  }
});


test("raw probation receipts reject unknown authority, missing probe mode and noncanonical fields", () => {
  const input = {
    manifest: slotInternet(),
    canonicalTrustPinned: false,
    activationAllowed: false,
  };
  const missingProbeMode = receipt();
  delete missingProbeMode.probeMode;
  for (const value of [
    { ...receipt(), install: true },
    { ...receipt(), authority: "platform-component-lifecycle" },
    { ...receipt(), error: "unexpected-error-on-healthy-receipt" },
    { ...receipt(), probeMode: "unverified" },
    missingProbeMode,
    { ...receipt(), health: "unknown" },
  ]) {
    assert.throws(() => createComponentPendingDecisionPlan({
      ...input, probationResult: value,
    }));
  }
});

test("failed probation may include bounded diagnostic and canonical probe mode", () => {
  const result = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: {
      ...receipt({ health: "failed" }),
      error: "module import failed",
      probeMode: NATIVE_COMPONENT_PROBE_MODE_BY_ID.notes,
    },
    canonicalTrustPinned: false,
    activationAllowed: false,
  });
  assert.equal(result.action, "reject");
  assert.equal(result.reason, "pending-health-failed");
  assert.equal(result.authority, "none");
});

test("probation probe mode comes from generated SSOT without enabling pending-slot actions", () => {
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.notes, "import-contract");
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.files, "mount-contract");
  assert.match(PENDING_DECISION_SOURCE, /NATIVE_COMPONENT_PROBE_MODE_BY_ID\[componentId\]/);
  assert.doesNotMatch(
    PENDING_DECISION_SOURCE,
    /value\.probeMode\s*!==\s*["']import-contract["']/,
  );
});

test("raw plans cannot invent unknown health or hold a failed receipt", () => {
  const hold = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt(),
    canonicalTrustPinned: false,
    activationAllowed: false,
  });
  const reject = createComponentPendingDecisionPlan({
    manifest: slotInternet(),
    probationResult: receipt({ health: "failed" }),
    canonicalTrustPinned: false,
    activationAllowed: false,
  });
  assert.throws(
    () => validateComponentPendingDecisionPlan({
      ...hold, reason: "pending-health-unknown",
    }),
    /unknown health/,
  );
  assert.throws(
    () => validateComponentPendingDecisionPlan({
      ...reject, action: "hold", reason: "canonical-component-trust-not-pinned",
    }),
    /cannot be held/,
  );
});

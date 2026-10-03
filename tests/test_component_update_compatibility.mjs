import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPONENT_COMPATIBILITY_SCHEMA,
  COMPONENT_STATE_MIGRATION_SCHEMA,
  evaluateComponentUpgrade,
  validateComponentCompatibilityCatalog,
  validateComponentStateMigrationPlan,
} from "../system/contracts/component-update-compatibility.mjs";
import {
  compareComponentVersions,
  componentVersionIsNewer,
  validateComponentVersion,
} from "../system/contracts/component-manifest.mjs";
import {
  coreRuntimeCompatibility,
  intelligenceCompatibility,
  localAiCompatibility,
} from "../system/services/components/compatibility/core.mjs";

function compatibility({
  componentId,
  componentVersion,
  provides = [],
  requires = [],
  state = null,
}) {
  return {
    schema: COMPONENT_COMPATIBILITY_SCHEMA,
    componentId,
    componentVersion,
    provides,
    requires,
    state,
    authority: "none",
  };
}

const provide = (id, major) => ({ id, major });
const requireContract = (id, minMajor, maxMajor = minMajor, optional = false) => ({
  id,
  minMajor,
  maxMajor,
  optional,
});
const state = (id, writeVersion, readableFrom = writeVersion, readableThrough = writeVersion) => ({
  id,
  writeVersion,
  readableFrom,
  readableThrough,
});

function migration({
  componentId = "ordax-intelligence",
  fromComponentVersion = "1.0.0",
  toComponentVersion = "1.1.0",
  fromState = { id: "intelligence-state", version: 1 },
  toState = { id: "intelligence-state", version: 2 },
  steps = [{
    id: "intelligence-state-v1-to-v2",
    from: { id: "intelligence-state", version: 1 },
    to: { id: "intelligence-state", version: 2 },
  }],
} = {}) {
  return {
    schema: COMPONENT_STATE_MIGRATION_SCHEMA,
    componentId,
    fromComponentVersion,
    toComponentVersion,
    fromState,
    toState,
    steps,
    copyOnWrite: true,
    verifyBeforeSwitch: true,
    retainPreviousGeneration: true,
    ownerPreserving: true,
    authority: "none",
  };
}

test("canonical Local AI -> Intelligence compatibility chain is valid and authority-free", () => {
  assert.equal(validateComponentCompatibilityCatalog(coreRuntimeCompatibility).length, 2);
  assert.equal(localAiCompatibility.componentId, "local-ai-service");
  assert.deepEqual(localAiCompatibility.provides, [{ id: "ordax.local-ai", major: 1 }]);
  assert.equal(localAiCompatibility.state, null);
  assert.equal(localAiCompatibility.authority, "none");

  assert.equal(intelligenceCompatibility.componentId, "ordax-intelligence");
  assert.deepEqual(intelligenceCompatibility.provides, [{ id: "ordax.intelligence", major: 1 }]);
  assert.deepEqual(intelligenceCompatibility.requires, [{
    id: "ordax.local-ai",
    minMajor: 1,
    maxMajor: 1,
    optional: false,
  }]);
  assert.equal(intelligenceCompatibility.state, null);
  assert.equal(intelligenceCompatibility.authority, "none");
});

test("component semantic version ordering follows release precedence without integer precision loss", () => {
  assert.equal(compareComponentVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareComponentVersions("1.0.1", "1.0.0"), 1);
  assert.equal(compareComponentVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareComponentVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareComponentVersions("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(
    compareComponentVersions(
      "90071992547409930000000000000000001.0.0",
      "90071992547409930000000000000000000.999999999999999999999.999999999999999999999",
    ),
    1,
  );
  assert.equal(
    compareComponentVersions(
      "1.0.0-alpha.90071992547409930000000000000000001",
      "1.0.0-alpha.90071992547409930000000000000000000",
    ),
    1,
  );
  assert.equal(componentVersionIsNewer("1.1.0", "1.0.9"), true);
  assert.equal(componentVersionIsNewer("1.0.0", "1.0.0"), false);
  assert.throws(
    () => validateComponentVersion(`1.0.0-${"a".repeat(129)}`),
    /bounded semantic version/,
  );
});

test("compatibility catalog fails closed when a required contract disappears", () => {
  const localAi = compatibility({
    componentId: "local-ai-service",
    componentVersion: "1.0.0",
    provides: [provide("ordax.local-ai", 1)],
  });
  const intelligence = compatibility({
    componentId: "ordax-intelligence",
    componentVersion: "1.0.0",
    provides: [provide("ordax.intelligence", 1)],
    requires: [requireContract("ordax.local-ai", 1)],
  });
  const studio = compatibility({
    componentId: "studio",
    componentVersion: "1.0.0",
    requires: [requireContract("ordax.intelligence", 1)],
  });

  assert.equal(validateComponentCompatibilityCatalog([localAi, intelligence, studio]).length, 3);
  assert.throws(
    () => validateComponentCompatibilityCatalog([
      compatibility({
        componentId: "local-ai-service",
        componentVersion: "2.0.0",
        provides: [provide("ordax.local-ai", 2)],
      }),
      intelligence,
      studio,
    ]),
    /requires unavailable contract ordax\.local-ai@1-1/,
  );
});

test("upgrade is denied when a dependent only accepts the previous contract major", () => {
  const current = compatibility({
    componentId: "ordax-intelligence",
    componentVersion: "1.0.0",
    provides: [provide("ordax.intelligence", 1)],
  });
  const candidate = compatibility({
    componentId: "ordax-intelligence",
    componentVersion: "2.0.0",
    provides: [provide("ordax.intelligence", 2)],
  });
  const studio = compatibility({
    componentId: "studio",
    componentVersion: "1.0.0",
    requires: [requireContract("ordax.intelligence", 1)],
  });

  const decision = evaluateComponentUpgrade({ current, candidate, active: [current, studio] });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, "contract-compatibility-failed");
  assert.equal(decision.authority, "none");
});

test("state format changes require one explicit copy-on-write migration path", () => {
  const current = compatibility({
    componentId: "ordax-intelligence",
    componentVersion: "1.0.0",
    provides: [provide("ordax.intelligence", 1)],
    state: state("intelligence-state", 1),
  });
  const candidate = compatibility({
    componentId: "ordax-intelligence",
    componentVersion: "1.1.0",
    provides: [provide("ordax.intelligence", 1)],
    state: state("intelligence-state", 2, 1, 2),
  });

  const withoutPlan = evaluateComponentUpgrade({ current, candidate, active: [current] });
  assert.equal(withoutPlan.allowed, false);
  assert.equal(withoutPlan.migrationRequired, true);
  assert.equal(withoutPlan.reasonCode, "explicit-state-migration-required");

  const plan = migration();
  assert.equal(validateComponentStateMigrationPlan(plan).authority, "none");
  const withPlan = evaluateComponentUpgrade({ current, candidate, active: [current], migrationPlan: plan });
  assert.equal(withPlan.allowed, true);
  assert.equal(withPlan.migrationRequired, true);
  assert.equal(withPlan.reasonCode, "compatible-with-explicit-migration");
});

test("migration plans reject gaps, in-place shortcuts and missing rollback generation", () => {
  assert.throws(
    () => validateComponentStateMigrationPlan(migration({
      toState: { id: "intelligence-state", version: 3 },
      steps: [{
        id: "illegal-jump",
        from: { id: "intelligence-state", version: 1 },
        to: { id: "intelligence-state", version: 3 },
      }],
    })),
    /sequential N -> N\+1/,
  );

  const unsafe = migration();
  unsafe.retainPreviousGeneration = false;
  assert.throws(
    () => validateComponentStateMigrationPlan(unsafe),
    /retainPreviousGeneration must be true/,
  );
});

test("upgrade never treats downgrade or state removal as normal candidate evolution", () => {
  const current = compatibility({
    componentId: "memory-service",
    componentVersion: "2.0.0",
    state: state("memory-state", 4, 3, 4),
  });
  const older = compatibility({
    componentId: "memory-service",
    componentVersion: "1.9.0",
    state: state("memory-state", 3),
  });
  const stateLess = compatibility({
    componentId: "memory-service",
    componentVersion: "2.1.0",
    state: null,
  });

  assert.equal(evaluateComponentUpgrade({ current, candidate: older, active: [current] }).reasonCode, "candidate-not-newer");
  const removed = evaluateComponentUpgrade({ current, candidate: stateLess, active: [current] });
  assert.equal(removed.allowed, false);
  assert.equal(removed.reasonCode, "state-owner-removed");
});

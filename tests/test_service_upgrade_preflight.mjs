import assert from "node:assert/strict";
import test from "node:test";

import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import {
  coreRuntimeCompatibility,
  localAiCompatibility,
  intelligenceCompatibility,
} from "../system/services/components/compatibility/core.mjs";
import {
  SERVICE_COMPATIBILITY_COVERAGE_SCHEMA,
  SERVICE_CONSUMER_IMPACT_SCHEMA,
  deriveServiceConsumerImpact,
  SERVICE_UPGRADE_PREFLIGHT_SCHEMA,
  deriveServiceCompatibilityCoverage,
  preflightServiceUpgrade,
  validateSlotCompatibilityInspection,
  preflightServiceUpgradeInspections,
  VERIFIED_SLOT_COMPATIBILITY_SCHEMA,
  ACTIVATION_SLOT_COMPATIBILITY_SNAPSHOT_SCHEMA,
  validateActivationCompatibilitySnapshot,
  preflightServiceUpgradeWithActivationSnapshots,
  ACTIVE_SLOT_COMPATIBILITY_CATALOG_SCHEMA,
  validateActiveSlotCompatibilityCatalog,
  SERVICE_ACTIVE_GRAPH_COVERAGE_SCHEMA,
  assessServiceActiveGraphCoverage,
} from "../system/services/components/service-upgrade-preflight.mjs";

const manifests = listSystemComponents();
const independentManifests = manifests.map((item) => item.id === "local-ai-service"
  ? { ...item, releaseMode: "component-slot" }
  : item);
const futureAI = (major = 1, extra = {}) => ({
  ...localAiCompatibility,
  componentVersion: "0.2.0",
  provides: [{ id: "ordax.local-ai", major }],
  ...extra,
});
// Synthetic contract exists ONLY inside the fixture: production Assistant
// currently has no independently proven compatibility descriptor.
const assistantCompatibility = {
  schema: "ordax.component-compatibility/1",
  componentId: "assistant",
  componentVersion: manifests.find((item) => item.id === "assistant").version,
  provides: [],
  requires: [{ id: "ordax.intelligence", minMajor: 1, maxMajor: 1, optional: false }],
  state: null,
  authority: "none",
};
const completeFixtureConsumers = [intelligenceCompatibility, assistantCompatibility];

const inspect = (extra = {}) => preflightServiceUpgrade({
  manifests: independentManifests,
  componentId: "local-ai-service",
  current: localAiCompatibility,
  candidate: futureAI(),
  active: completeFixtureConsumers,
  ...extra,
});

test("impact graph follows both direct and transitive canonical consumers", () => {
  const result = deriveServiceConsumerImpact({
    manifests, componentId: "local-ai-service", descriptors: coreRuntimeCompatibility,
  });
  assert.equal(result.schema, SERVICE_CONSUMER_IMPACT_SCHEMA);
  assert.equal(result.authority, "none");
  assert.equal(result.productionActivationAllowed, false);
  assert.equal(result.summary.direct, 1);
  assert.equal(result.summary.transitive, 1);
  assert.equal(result.summary.sourceDescriptors, 1);
  assert.equal(result.summary.missingDescriptors, 1);
  assert.deepEqual(result.consumers.map((item) => item.id), ["assistant", "ordax-intelligence"]);
  assert.deepEqual(result.consumers.find((item) => item.id === "assistant").dependencyPath,
    ["local-ai-service", "ordax-intelligence", "assistant"]);
  assert.equal(result.consumers.find((item) => item.id === "assistant").contractEvidence,
    "descriptor-not-declared");
});

test("transitive Assistant lacking a live contract blocks an otherwise compatible Local AI upgrade", () => {
  const result = inspect({ active: [intelligenceCompatibility] });
  assert.equal(result.compatibilityAllowed, false);
  assert.equal(result.reasonCode, "active-consumer-descriptor-unavailable");
  const complete = inspect();
  assert.equal(complete.compatibilityAllowed, true);
  assert.equal(complete.authority, "none");
});

test("manifest changes cannot hide deeper consumers from the dependency closure", () => {
  const newCatalog = manifests.map((component) => component.id === "assistant"
    ? { ...component, dependencies: ["surface-shell", "ordax-intelligence"] }
    : component);
  const result = deriveServiceConsumerImpact({
    manifests: newCatalog, componentId: "local-ai-service",
    descriptors: coreRuntimeCompatibility,
  });
  assert.equal(result.summary.transitive, 1);
  assert.throws(() => deriveServiceConsumerImpact({
    manifests, componentId: "not-a-component", descriptors: coreRuntimeCompatibility,
  }), /no canonical manifest/);
});

test("canonical compatibility report accounts for all components without inventing contracts", () => {
  const result = deriveServiceCompatibilityCoverage({
    manifests, descriptors: coreRuntimeCompatibility,
  });
  assert.equal(result.schema, SERVICE_COMPATIBILITY_COVERAGE_SCHEMA);
  assert.equal(result.authority, "none");
  assert.equal(result.summary.total, manifests.length);
  assert.equal(result.summary.declared, coreRuntimeCompatibility.length);
  assert.equal(result.summary.missing, manifests.length - coreRuntimeCompatibility.length);
  assert.equal(result.components.find((item) => item.id === "internet").status, "descriptor-not-declared");
  assert.equal(result.components.find((item) => item.id === "local-ai-service").status,
    "declared-and-catalog-validated");
});

test("duplicate, orphan, wrong-version and missing provider descriptors are rejected", () => {
  for (const descriptors of [
    [...coreRuntimeCompatibility, localAiCompatibility],
    [{ ...localAiCompatibility, componentId: "not-a-component" }],
    [{ ...localAiCompatibility, componentVersion: "9.0.0" }],
    [intelligenceCompatibility],
  ]) {
    assert.throws(() => deriveServiceCompatibilityCoverage({ manifests, descriptors }));
  }
});

test("a real manifest dependency is required for a declared provider contract", () => {
  const missingDependency = manifests.map((item) => item.id === "ordax-intelligence"
    ? { ...item, dependencies: [] } : item);
  assert.throws(() => deriveServiceCompatibilityCoverage({
    manifests: missingDependency, descriptors: coreRuntimeCompatibility,
  }), /missing declared contract provider dependency/);
});

test("bundled source cannot authorize component-slot operation", () => {
  const decision = inspect({ manifests });
  assert.equal(decision.schema, SERVICE_UPGRADE_PREFLIGHT_SCHEMA);
  assert.equal(decision.compatibilityAllowed, false);
  assert.equal(decision.reasonCode, "release-mode-not-component-slot");
  assert.equal(decision.signedPackageEvidence, "not-evaluated");
  assert.equal(decision.activationEvidence, "not-evaluated");
});

test("new compatible version may pass source preflight without activation authority", () => {
  const decision = inspect();
  assert.equal(decision.compatibilityAllowed, true);
  assert.equal(decision.reasonCode, "compatible-stateless");
  assert.equal(decision.authority, "none");
  assert.equal(decision.signedPackageEvidence, "not-evaluated");
  assert.equal(decision.activationEvidence, "not-evaluated");
});

test("new incompatible major is blocked because Intelligence still requires major 1", () => {
  const decision = inspect({ candidate: futureAI(2) });
  assert.equal(decision.compatibilityAllowed, false);
  assert.equal(decision.reasonCode, "contract-compatibility-failed");
});

test("refuses missing or duplicated active consumer descriptions, cannot assume compatibility", () => {
  const missing = inspect({ active: [] });
  assert.equal(missing.compatibilityAllowed, false);
  assert.equal(missing.reasonCode, "active-consumer-descriptor-unavailable");
  assert.throws(() => inspect({ active: [intelligenceCompatibility, intelligenceCompatibility] }), /unique/);
  assert.throws(() => inspect({ active: null }), /explicit current active descriptors/);
});

test("uses verified active slot version rather than bundled manifest for subsequent upgrades", () => {
  const existing = { ...localAiCompatibility, componentVersion: "0.15.0" };
  const future = { ...futureAI(), componentVersion: "0.16.0" };
  const decision = inspect({ current: existing, candidate: future });
  assert.equal(decision.compatibilityAllowed, true);
  assert.equal(decision.reasonCode, "compatible-stateless");
  assert.equal(decision.activationEvidence, "not-evaluated");
});

test("mismatched identity, downgrade and incoherent active contracts fail closed", () => {
  const wrongCandidate = inspect({ candidate: { ...futureAI(), componentId: "ordax-intelligence" } });
  assert.equal(wrongCandidate.compatibilityAllowed, false);
  assert.equal(wrongCandidate.reasonCode, "component-identity-mismatch");
  const downgrade = inspect({ candidate: { ...futureAI(), componentVersion: "0.0.9" } });
  assert.equal(downgrade.compatibilityAllowed, false);
  assert.equal(downgrade.reasonCode, "candidate-not-newer");
  const incoherent = inspect({ active: [{
    ...intelligenceCompatibility,
    requires: [{ id: "ordax.missing", minMajor: 1, maxMajor: 1, optional: false }],
  }] });
  assert.equal(incoherent.compatibilityAllowed, false);
  assert.equal(incoherent.reasonCode, "active-contract-snapshot-invalid");
  assert.throws(() => inspect({ active: [{
    ...intelligenceCompatibility, componentId: "ghost-component",
  }] }), /no canonical manifest/);
});

test("persistent state change is blocked unless separately planned and verified by owner", () => {
  const current = {
    ...localAiCompatibility,
    state: { id: "ai-state", writeVersion: 1, readableFrom: 1, readableThrough: 1 },
  };
  const candidate = {
    ...futureAI(),
    state: { id: "ai-state", writeVersion: 2, readableFrom: 2, readableThrough: 2 },
  };
  const decision = inspect({ current, candidate });
  assert.equal(decision.compatibilityAllowed, false);
  assert.equal(decision.reasonCode, "explicit-state-migration-required");
  assert.equal(decision.migrationRequired, true);
  const fake = inspect({ current, candidate, migrationPlan: { unsafe: true } });
  assert.equal(fake.compatibilityAllowed, false);
  assert.equal(fake.reasonCode, "state-migration-invalid");
});

const inspection = (descriptor, { fingerprint = "a".repeat(64), commit = "1".repeat(40) } = {}) => ({
  schema: VERIFIED_SLOT_COMPATIBILITY_SCHEMA,
  authority: "none",
  trustScope: "caller-supplied-public-anchor",
  trustSHA256: fingerprint,
  activationStatus: "not-evaluated",
  componentId: descriptor.componentId,
  version: descriptor.componentVersion,
  sourceCommit: commit,
  descriptor,
});

test("same-trust signed-slot inspection reports feed canonical diagnostic preflight", () => {
  const report = preflightServiceUpgradeInspections({
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentInspection: inspection(localAiCompatibility),
    candidateInspection: inspection(futureAI(), { commit: "2".repeat(40) }),
    activeInspections: [inspection(intelligenceCompatibility, { commit: "3".repeat(40) }), inspection(assistantCompatibility)],
  });
  assert.equal(report.compatibilityAllowed, true);
  assert.equal(report.reasonCode, "compatible-stateless");
  assert.equal(report.authority, "none");
  assert.equal(report.activationEvidence, "not-evaluated");
  assert.equal(report.signedPackageEvidence, "not-evaluated");
});

test("different supplied trust or incompatible active consumers fail closed", () => {
  const shared = {
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentInspection: inspection(localAiCompatibility),
    candidateInspection: inspection(futureAI()),
    activeInspections: [inspection(intelligenceCompatibility), inspection(assistantCompatibility)],
  };
  const wrongTrust = preflightServiceUpgradeInspections({
    ...shared,
    candidateInspection: inspection(futureAI(), { fingerprint: "b".repeat(64) }),
  });
  assert.equal(wrongTrust.compatibilityAllowed, false);
  assert.equal(wrongTrust.reasonCode, "public-trust-source-mismatch");
  const incompatible = preflightServiceUpgradeInspections({
    ...shared,
    candidateInspection: inspection(futureAI(2)),
  });
  assert.equal(incompatible.compatibilityAllowed, false);
  assert.equal(incompatible.reasonCode, "contract-compatibility-failed");
});

test("slot readout rejects forged pinned-trust claim, incomplete binding and wrong version", () => {
  const source = inspection(localAiCompatibility);
  for (const invalid of [
    { ...source, trustScope: "system-pinned" },
    { ...source, authority: "activation" },
    { ...source, activationStatus: "current" },
    { ...source, trustSHA256: "untrusted" },
    { ...source, sourceCommit: "bad" },
    { ...source, version: "4.0.0" },
    { ...source, componentId: "wrong-component" },
    { ...source, injected: true },
  ]) {
    assert.throws(() => validateSlotCompatibilityInspection(invalid));
  }
  assert.throws(() => preflightServiceUpgradeInspections({
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentInspection: source,
    candidateInspection: inspection(futureAI()),
    activeInspections: null,
  }), /Explicit bounded/);
});

const activationSnapshot = (descriptor, revision = 5, target = "current", other = {}) => ({
  schema: ACTIVATION_SLOT_COMPATIBILITY_SNAPSHOT_SCHEMA,
  authority: "none",
  componentId: descriptor.componentId,
  target,
  revision,
  pendingHealth: "unknown",
  trustScope: "caller-supplied-public-anchor",
  trustSHA256: "a".repeat(64),
  verifiedSlot: inspection(descriptor),
  ...other,
});

test("official activation revision and verified slot reports can be checked without mutation", () => {
  const report = preflightServiceUpgradeWithActivationSnapshots({
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentSnapshot: activationSnapshot(localAiCompatibility),
    candidateInspection: inspection(futureAI(), { commit: "2".repeat(40) }),
    activeSnapshots: [activationSnapshot(intelligenceCompatibility, 3), activationSnapshot(assistantCompatibility, 4)],
    expectedRevision: 5,
  });
  assert.equal(report.compatibilityAllowed, true);
  assert.equal(report.reasonCode, "compatible-stateless");
  assert.equal(report.authority, "none");
  assert.equal(report.activationEvidence, "not-evaluated");
});

test("outdated state revision, mistaken slot role or wrong trust blocks diagnostic preflight", () => {
  const input = {
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentSnapshot: activationSnapshot(localAiCompatibility),
    candidateInspection: inspection(futureAI()),
    activeSnapshots: [activationSnapshot(intelligenceCompatibility), activationSnapshot(assistantCompatibility, 4)],
    expectedRevision: 5,
  };
  const stale = preflightServiceUpgradeWithActivationSnapshots({
    ...input, expectedRevision: 4,
  });
  assert.equal(stale.compatibilityAllowed, false);
  assert.equal(stale.reasonCode, "activation-revision-stale");
  const badRole = preflightServiceUpgradeWithActivationSnapshots({
    ...input, currentSnapshot: activationSnapshot(localAiCompatibility, 5, "pending"),
  });
  assert.equal(badRole.compatibilityAllowed, false);
  assert.equal(badRole.reasonCode, "activation-snapshot-identity-mismatch");
  const pendingConsumer = preflightServiceUpgradeWithActivationSnapshots({
    ...input, activeSnapshots: [activationSnapshot(intelligenceCompatibility, 3, "pending")],
  });
  assert.equal(pendingConsumer.compatibilityAllowed, false);
  assert.equal(pendingConsumer.reasonCode, "active-consumer-not-current");
  const wrongTrust = preflightServiceUpgradeWithActivationSnapshots({
    ...input, candidateInspection: inspection(futureAI(), { fingerprint: "b".repeat(64) }),
  });
  assert.equal(wrongTrust.compatibilityAllowed, false);
  assert.equal(wrongTrust.reasonCode, "public-trust-source-mismatch");
});

test("activation snapshot shape, duplicate consumers and false trust claims are rejected", () => {
  const initial = activationSnapshot(localAiCompatibility);
  for (const spoofed of [
    { ...initial, authority: "activate" },
    { ...initial, trustScope: "production-pinned" },
    { ...initial, trustSHA256: "b".repeat(64) },
    { ...initial, target: "previous" },
    { ...initial, revision: 0 },
    { ...initial, verifiedSlot: inspection(intelligenceCompatibility) },
    { ...initial, extra: true },
  ]) {
    assert.throws(() => validateActivationCompatibilitySnapshot(spoofed));
  }
  assert.throws(() => preflightServiceUpgradeWithActivationSnapshots({
    manifests: independentManifests,
    componentId: "local-ai-service",
    currentSnapshot: initial,
    candidateInspection: inspection(futureAI()),
    activeSnapshots: [
      activationSnapshot(intelligenceCompatibility),
      activationSnapshot(intelligenceCompatibility, 4),
    ],
    expectedRevision: 5,
  }), /unique/);
});

const activeCatalog = (components = [activationSnapshot(localAiCompatibility)]) => ({
  schema: ACTIVE_SLOT_COMPATIBILITY_CATALOG_SCHEMA,
  authority: "none",
  scope: "signed-independent-current-slots-only",
  completeForActivation: false,
  trustScope: "caller-supplied-public-anchor",
  components,
});

test("Native active catalog reports signed installed slots but never complete OS coverage", () => {
  const result = validateActiveSlotCompatibilityCatalog(activeCatalog());
  assert.equal(result.schema, ACTIVE_SLOT_COMPATIBILITY_CATALOG_SCHEMA);
  assert.equal(result.completeForActivation, false);
  assert.equal(result.authority, "none");
  assert.equal(result.components[0].target, "current");
  assert.equal(validateActiveSlotCompatibilityCatalog(activeCatalog([])).components.length, 0);
});

test("active catalog rejects forged completeness, mixed keys and duplicate consumers", () => {
  const source = activeCatalog();
  for (const bad of [
    { ...source, completeForActivation: true },
    { ...source, authority: "native" },
    { ...source, scope: "all-system-components" },
    { ...source, trustScope: "system-pinned" },
    { ...source, components: [activationSnapshot(localAiCompatibility, 5, "pending")] },
    { ...source, components: [
      activationSnapshot(localAiCompatibility),
      activationSnapshot(localAiCompatibility, 6),
    ] },
    { ...source, components: [
      activationSnapshot(intelligenceCompatibility, 4),
      activationSnapshot(localAiCompatibility),
    ] },
    { ...source, components: [
      activationSnapshot(localAiCompatibility),
      activationSnapshot(intelligenceCompatibility, 3, "current", {
        trustSHA256: "b".repeat(64),
        verifiedSlot: inspection(intelligenceCompatibility, { fingerprint: "b".repeat(64) }),
      }),
    ] },
    { ...source, unexpected: true },
  ]) {
    assert.throws(() => validateActiveSlotCompatibilityCatalog(bad));
  }
});

test("signed active graph gaps are derived across every canonical manifest", () => {
  const result = assessServiceActiveGraphCoverage({
    manifests,
    descriptors: coreRuntimeCompatibility,
    activeCatalog: activeCatalog([]),
  });
  assert.equal(result.schema, SERVICE_ACTIVE_GRAPH_COVERAGE_SCHEMA);
  assert.equal(result.authority, "none");
  assert.equal(result.completeForActivation, false);
  assert.equal(result.summary.total, manifests.length);
  assert.equal(result.summary.sourceDescriptorsDeclared, coreRuntimeCompatibility.length);
  assert.equal(result.summary.missingSourceDescriptors, manifests.length - coreRuntimeCompatibility.length);
  assert.equal(result.summary.signedCurrentObserved, 0);
  assert.equal(result.summary.productionCompatibilityProven, 0);
  assert.equal(
    result.components.find((entry) => entry.id === "ordax-intelligence").contractEvidence,
    "source-descriptor-only",
  );
  assert.equal(
    result.components.find((entry) => entry.id === "internet").contractEvidence,
    "not-declared",
  );
});

test("signed slot may be observed while canonical releaseMode is still not promoted", () => {
  const result = assessServiceActiveGraphCoverage({
    manifests,
    descriptors: coreRuntimeCompatibility,
    activeCatalog: activeCatalog([activationSnapshot(localAiCompatibility)]),
  });
  const local = result.components.find((entry) => entry.id === "local-ai-service");
  assert.equal(local.signedCurrentObserved, true);
  assert.equal(local.sourcePolicyMatchesObservedSlot, false);
  assert.equal(local.contractEvidence, "verified-by-native-readout-not-pinned");
  assert.equal(local.productionCompatibilityProven, false);
  assert.equal(result.summary.sourceModeMismatches, 1);
  assert.equal(result.completeForActivation, false);
});

test("signed current references cannot invent a new component outside SSOT", () => {
  const ghost = {
    ...localAiCompatibility,
    componentId: "ghost-service",
  };
  assert.throws(() => assessServiceActiveGraphCoverage({
    manifests,
    descriptors: coreRuntimeCompatibility,
    activeCatalog: activeCatalog([activationSnapshot(ghost)]),
  }), /no canonical component manifest/);
});

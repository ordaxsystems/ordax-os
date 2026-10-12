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
  SERVICE_UPGRADE_PREFLIGHT_SCHEMA,
  deriveServiceCompatibilityCoverage,
  preflightServiceUpgrade,
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
const inspect = (extra = {}) => preflightServiceUpgrade({
  manifests: independentManifests,
  componentId: "local-ai-service",
  current: localAiCompatibility,
  candidate: futureAI(),
  active: [intelligenceCompatibility],
  ...extra,
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

test("mismatched current identity or version blocks candidate", () => {
  const wrongCurrent = inspect({ current: { ...localAiCompatibility, componentVersion: "0.0.9" } });
  assert.equal(wrongCurrent.compatibilityAllowed, false);
  assert.equal(wrongCurrent.reasonCode, "current-manifest-version-mismatch");
  const wrongCandidate = inspect({ candidate: { ...futureAI(), componentId: "ordax-intelligence" } });
  assert.equal(wrongCandidate.compatibilityAllowed, false);
  assert.equal(wrongCandidate.reasonCode, "component-identity-mismatch");
  const downgrade = inspect({ candidate: { ...futureAI(), componentVersion: "0.0.9" } });
  assert.equal(downgrade.compatibilityAllowed, false);
  assert.equal(downgrade.reasonCode, "candidate-not-newer");
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

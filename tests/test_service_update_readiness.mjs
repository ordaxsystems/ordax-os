import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { coreRuntimeCompatibility } from "../system/services/components/compatibility/core.mjs";
import { deriveNativeServiceUpdateInventory } from "../system/services/components/service-update-inventory.mjs";
import {
  SERVICE_UPDATE_READINESS_SCHEMA,
  deriveNativeServiceUpdateReadiness,
} from "../system/services/components/service-update-readiness.mjs";

const packagePolicy = JSON.parse(readFileSync(
  new URL("../docs/contracts/runtime-component-package.json", import.meta.url), "utf8",
));

function inventory(manifests = listSystemComponents()) {
  return deriveNativeServiceUpdateInventory({
    manifests,
    servicePaths: readdirSync(new URL("../system/services/", import.meta.url),
      { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => "system/services/" + entry.name),
  });
}

test("portable SDK package-policy snapshot stays identical to the canonical OS policy", () => {
  // SDK consumers need a local distributable policy snapshot, not a second
  // authority. CI refuses a manually edited or stale SDK mirror.
  const sdkPolicy = JSON.parse(readFileSync(
    new URL("../sdk/app-sdk-v1/runtime-component-package-policy.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(sdkPolicy, packagePolicy);
});

test("all canonical services are assessed without an update authority", () => {
  const inv = inventory();
  const result = deriveNativeServiceUpdateReadiness({ inventory: inv, packagePolicy });
  assert.equal(result.schema, SERVICE_UPDATE_READINESS_SCHEMA);
  assert.equal(result.authority, "none");
  assert.deepEqual(
    result.components.map((c) => c.id).sort(),
    inv.components.map((c) => c.id).sort(),
  );
  assert.deepEqual(
    result.domains.map((d) => d.path).sort(),
    inv.domains.map((d) => d.path).sort(),
  );
  assert.equal(result.summary.productionEvidence, "not-evaluated");
  assert.ok(result.components.every((c) => c.productionEvidence === "not-evaluated"));
  assert.ok(result.domains.every((d) => d.productionEvidence === "not-evaluated"));
  assert.equal(result.summary.packagingCandidates, packagePolicy.supported_components.length);
});

test("current Local AI and Intelligence packaging does not mean live individual update", () => {
  const result = deriveNativeServiceUpdateReadiness({ inventory: inventory(), packagePolicy });
  for (const id of ["local-ai-service", "ordax-intelligence"]) {
    const c = result.components.find((entry) => entry.id === id);
    assert.equal(c.releaseMode, "bundled");
    assert.equal(c.packagingCandidate, true);
    assert.equal(c.policyAssessment, "blocked");
    assert.ok(c.blockers.includes("not-component-slot"));
    assert.ok(c.blockers.includes("packaging-proof-only"));
  }
  const spaces = result.domains.find((entry) => entry.path === "system/services/spaces");
  assert.equal(spaces.policyAssessment, "embedded-no-component");
});

test("a slot declaration without trust, health and rollback remains blocked", () => {
  const manifests = listSystemComponents().map((entry) => entry.id === "local-ai-service"
    ? { ...entry, releaseMode: "component-slot" } : entry);
  const candidatePolicy = { ...packagePolicy, local_ai_service_release_mode: "component-slot" };
  const result = deriveNativeServiceUpdateReadiness({
    inventory: inventory(manifests), packagePolicy: candidatePolicy,
  });
  const local = result.components.find((entry) => entry.id === "local-ai-service");
  assert.equal(local.policyAssessment, "blocked");
  assert.ok(local.blockers.includes("release-gate-closed:canonical_component_trust_anchor_pinned"));
  assert.ok(local.blockers.includes("release-gate-closed:rollback_slot_activation_available"));
  assert.equal(local.productionEvidence, "not-evaluated");
});

test("even all declared policy gates do not provide real production proof", () => {
  const manifests = listSystemComponents().map((entry) => entry.id === "local-ai-service"
    ? { ...entry, releaseMode: "component-slot" } : entry);
  const candidatePolicy = {
    ...packagePolicy,
    local_ai_service_release_mode: "component-slot",
    packaging_only_components: ["ordax-intelligence"],
    canonical_component_trust_anchor_pinned: true,
    slot_activation_available: true,
    native_slot_serving_available: true,
    pending_health_promotion_available: true,
    rollback_slot_activation_available: true,
    publish_allowed: true,
  };
  const result = deriveNativeServiceUpdateReadiness({
    inventory: inventory(manifests), packagePolicy: candidatePolicy,
  });
  const local = result.components.find((entry) => entry.id === "local-ai-service");
  assert.equal(local.policyAssessment, "proof-required");
  assert.deepEqual(local.blockers, []);
  assert.equal(local.productionEvidence, "not-evaluated");
});

test("stale, missing or contradictory source policy fails closed", () => {
  const inv = inventory();
  for (const policy of [
    { ...packagePolicy, supported_components: ["nonexistent"] },
    { ...packagePolicy, supported_components: ["internet", "internet"] },
    { ...packagePolicy, packaging_only_components: ["nonexistent"] },
    { ...packagePolicy, slot_activation_available: undefined },
    { ...packagePolicy, local_ai_service_release_mode: "component-slot" },
    { ...packagePolicy, internet_release_mode: "component-slot" },
    { ...packagePolicy, retired_legacy_service_release_mode: "bundled" },
    { ...packagePolicy, $schema: "unknown" },
  ]) {
    assert.throws(() => deriveNativeServiceUpdateReadiness({
      inventory: inv, packagePolicy: policy,
    }));
  }
});

test("all current explicit policy release modes derive from component IDs", () => {
  const inv = inventory();
  const result = deriveNativeServiceUpdateReadiness({ inventory: inv, packagePolicy });
  for (const component of result.components) {
    const key = component.id.replaceAll("-", "_") + "_release_mode";
    if (Object.hasOwn(packagePolicy, key)) {
      assert.equal(packagePolicy[key], component.releaseMode);
    }
  }
  assert.equal(result.components.some((component) => component.id === "internet"), false);
  assert.equal(Object.hasOwn(packagePolicy, "internet_release_mode"), false,
    "removed Internet product must not keep a platform release-mode override");
});

test("package compatibility helper derives all entries from the canonical descriptor catalog", () => {
  const helper = fileURLToPath(new URL("../tools/component-package/compatibility.mjs", import.meta.url));
  for (const descriptor of coreRuntimeCompatibility) {
    const result = spawnSync(process.execPath, [helper, descriptor.componentId], {
      encoding: "utf8", timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), descriptor);
  }
  for (const id of ["", "nonexistent-component"]) {
    const result = spawnSync(process.execPath, [helper, id], {
      encoding: "utf8", timeout: 20000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No canonical runtime compatibility descriptor/);
  }
});

test("machine-readable CLI output contains every component and domain", () => {
  const run = spawnSync(process.execPath, [
    fileURLToPath(new URL("../tools/service-update-inventory.mjs", import.meta.url)),
  ], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.inventory.summary.domainCount, report.readiness.summary.serviceDomainCount);
  assert.equal(report.inventory.summary.componentCount, report.readiness.summary.componentCount);
  assert.equal(report.readiness.summary.productionEvidence, "not-evaluated");
  assert.equal(report.compatibility.schema, "ordax.service-compatibility-coverage/1");
  assert.equal(report.compatibility.summary.total, report.inventory.summary.componentCount);
  assert.equal(report.compatibility.summary.declared, coreRuntimeCompatibility.length);
  assert.equal(report.compatibility.authority, "none");
  assert.equal(report.consumerImpact.length, report.inventory.summary.componentCount);
  const aiImpact = report.consumerImpact.find((entry) => entry.componentId === "local-ai-service");
  assert.equal(aiImpact.authority, "none");
  assert.equal(aiImpact.productionActivationAllowed, false);
  assert.equal(aiImpact.summary.direct, 1);
  assert.equal(aiImpact.summary.transitive, 0);
  assert.equal(aiImpact.consumers.some((entry) => entry.id === "assistant"), false);
  assert.equal(aiImpact.summary.missingDescriptors, 0);
});

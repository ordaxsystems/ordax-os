import assert from "node:assert/strict";
import test from "node:test";
import {
  planProfileProvisioning,
  validateProfileDistribution,
} from "../system/contracts/profile-provisioning.mjs";

import {
  getLocalProfileDistribution,
} from "../system/profile-packs/distributions.mjs";

const developer = getLocalProfileDistribution("developer", 1);
const legal = getLocalProfileDistribution("legal-br", 1);

function inventory(entries = [], persistence = "session") {
  return {
    schema: "ordax.profile-component-inventory/1",
    revision: entries.length,
    persistence,
    entries,
  };
}

function installedEntry(id, kind, version, sha256) {
  return {
    id,
    kind,
    version,
    sha256,
    installedAt: 1234,
    receiptSha256: "f".repeat(64),
  };
}

test("profile metadata can be bundled while professional payload stays on-demand", () => {
  const value = validateProfileDistribution(legal);
  assert.equal(value.profile.slug, "legal-br");
  assert.equal(value.deliveryMode, "on-demand");
  assert.equal(value.metadataBundled, true);
  assert.equal(value.offlineAfterInstall, true);
  assert.equal(value.publicInstallEnabled, false);
  assert.equal(value.components.length, 2);
  assert.equal(value.components[0].availability, "planned");
});

test("blocked Legal-BR remains visible without pretending it is installable", () => {
  const plan = planProfileProvisioning({
    distribution: legal,
    installedInventory: inventory(),
    networkAvailable: true,
  });
  assert.equal(plan.state, "blocked");
  assert.match(plan.reason, /Legal-BR remains unavailable/);
  assert.equal(plan.mayDownload, false);
  assert.equal(plan.mayActivate, false);
  assert.deepEqual(plan.missing.map((item) => item.id), [
    "knowledge.legal-br-core",
    "skill.legal-document-review",
  ]);
});

test("Developer metadata is tiny local proof and does not imply public install", () => {
  const plan = planProfileProvisioning({
    distribution: developer,
    installedInventory: inventory(),
    networkAvailable: false,
  });
  assert.equal(plan.state, "blocked");
  assert.equal(plan.metadataBundled, true);
  assert.equal(plan.offlineAfterInstall, true);
  assert.equal(plan.requiredDownloadBytes, 0);
});

test("available remote component requires exact sha256 and signature policy", () => {
  const candidate = structuredClone(legal);
  candidate.public_install_enabled = true;
  candidate.blocked_reason = null;
  candidate.components = [{
    id: "knowledge.example",
    kind: "knowledge-pack",
    version: "1.0.0",
    required: true,
    availability: "available",
    sha256: "a".repeat(64),
    size_bytes: 1024,
    signature_required: true,
  }];
  const noNetwork = planProfileProvisioning({
    distribution: candidate,
    installedInventory: inventory(),
    networkAvailable: false,
  });
  assert.equal(noNetwork.state, "network-required");
  assert.equal(noNetwork.requiredDownloadBytes, 1024);
  assert.equal(noNetwork.mayDownload, false);

  const online = planProfileProvisioning({
    distribution: candidate,
    installedInventory: inventory(),
    networkAvailable: true,
  });
  assert.equal(online.state, "ready");
  assert.equal(online.mayDownload, true);
  assert.equal(online.mayActivate, true);

  const installed = planProfileProvisioning({
    distribution: candidate,
    installedInventory: inventory([
      installedEntry("knowledge.example", "knowledge-pack", "1.0.0", "a".repeat(64)),
    ], "device"),
    networkAvailable: false,
  });
  assert.equal(installed.state, "already-provisioned");
  assert.equal(installed.mayActivate, true);
  assert.equal(installed.inventoryPersistence, "device");

  const staleHash = planProfileProvisioning({
    distribution: candidate,
    installedInventory: inventory([
      installedEntry("knowledge.example", "knowledge-pack", "1.0.0", "d".repeat(64)),
    ], "device"),
    networkAvailable: false,
  });
  assert.equal(staleHash.state, "network-required");
  assert.equal(staleHash.missing.length, 1);
  assert.equal(staleHash.alreadyInstalled.length, 0);

  const staleVersion = planProfileProvisioning({
    distribution: candidate,
    installedInventory: inventory([
      installedEntry("knowledge.example", "knowledge-pack", "0.9.0", "a".repeat(64)),
    ], "device"),
    networkAvailable: false,
  });
  assert.equal(staleVersion.state, "network-required");
  assert.equal(staleVersion.missing.length, 1);
});

test("available component without signed content identity fails closed", () => {
  const unsafe = structuredClone(legal);
  unsafe.components = [{
    id: "knowledge.unsafe",
    kind: "knowledge-pack",
    version: "1.0.0",
    version: "1.0.0",
    required: true,
    availability: "available",
    sha256: null,
    size_bytes: 10,
    signature_required: true,
  }];
  assert.throws(() => validateProfileDistribution(unsafe), /requires sha256/);

  unsafe.components[0].sha256 = "b".repeat(64);
  unsafe.components[0].signature_required = false;
  assert.throws(() => validateProfileDistribution(unsafe), /must require signature/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  planProfileProvisioning,
  validateProfileDistribution,
} from "../system/contracts/profile-provisioning.mjs";

import { validateProfilePack } from "../system/contracts/profile-pack.mjs";
import {
  createLocalProfileDistributions,
  getLocalProfileDistribution,
} from "../system/profile-packs/distributions.mjs";

function readManifest(relativePath, label) {
  return validateProfilePack(
    JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")),
    label,
  );
}

const distributions = createLocalProfileDistributions([
  readManifest("../system/profile-packs/developer/v1/manifest.json", "Developer manifest"),
  readManifest("../system/profile-packs/legal-br/v1/manifest.json", "Legal-BR manifest"),
]);
const developer = getLocalProfileDistribution(distributions, "developer", 1);
const legal = getLocalProfileDistribution(distributions, "legal-br", 1);

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

test("distribution components are derived from canonical manifests", () => {
  assert.deepEqual(
    legal.components.map(({ id, kind, version, availability, sha256, signatureRequired }) => ({
      id, kind, version, availability, sha256, signatureRequired,
    })),
    [
      {
        id: "knowledge.legal-br-core",
        kind: "knowledge-pack",
        version: "0.1.0",
        availability: "planned",
        sha256: null,
        signatureRequired: true,
      },
      {
        id: "skill.legal-document-review",
        kind: "skill-pack",
        version: "0.1.0",
        availability: "planned",
        sha256: null,
        signatureRequired: true,
      },
    ],
  );
  assert.deepEqual(
    developer.components.map(({ id, kind, version, availability, sha256, signatureRequired }) => ({
      id, kind, version, availability, sha256, signatureRequired,
    })),
    [{
      id: "knowledge.developer-core",
      kind: "knowledge-pack",
      version: "0.1.0",
      availability: "planned",
      sha256: null,
      signatureRequired: true,
    }],
  );
});

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
  assert.equal(plan.componentsSatisfied, false);
  assert.equal(plan.requiredMissing.length, 2);
  assert.deepEqual(plan.missing.map((item) => item.id), [
    "knowledge.legal-br-core",
    "skill.legal-document-review",
  ]);
});

test("Developer metadata remains local while real content stays planned and non-installable", () => {
  const plan = planProfileProvisioning({
    distribution: developer,
    installedInventory: inventory(),
    networkAvailable: false,
  });
  assert.equal(plan.state, "blocked");
  assert.equal(plan.metadataBundled, true);
  assert.equal(plan.offlineAfterInstall, true);
  assert.equal(plan.requiredDownloadBytes, 0);
  assert.equal(plan.componentsSatisfied, false);
  assert.equal(plan.requiredMissing.length, 1);
  assert.equal(plan.requiredMissing[0].id, "knowledge.developer-core");
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].availability, "planned");
  assert.equal(plan.mayDownload, false);
  assert.equal(plan.mayActivate, false);
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
  assert.equal(online.componentsSatisfied, false);
  assert.equal(online.mayActivate, false);

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
  assert.equal(installed.componentsSatisfied, true);
  assert.equal(installed.alreadyInstalled[0].receiptSha256, "f".repeat(64));
  assert.equal(installed.alreadyInstalled[0].installedAt, 1234);

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

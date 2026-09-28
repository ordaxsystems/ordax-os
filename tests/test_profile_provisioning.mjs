import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planProfileProvisioning,
  validateProfileDistribution,
} from "../system/contracts/profile-provisioning.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function load(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

const developer = await load("system/profile-packs/developer/distribution.json");
const legal = await load("system/profile-packs/legal-br/distribution.json");

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
    installedComponentIds: [],
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
    installedComponentIds: [],
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
    required: true,
    availability: "available",
    sha256: "a".repeat(64),
    size_bytes: 1024,
    signature_required: true,
  }];
  const noNetwork = planProfileProvisioning({
    distribution: candidate,
    installedComponentIds: [],
    networkAvailable: false,
  });
  assert.equal(noNetwork.state, "network-required");
  assert.equal(noNetwork.requiredDownloadBytes, 1024);
  assert.equal(noNetwork.mayDownload, false);

  const online = planProfileProvisioning({
    distribution: candidate,
    installedComponentIds: [],
    networkAvailable: true,
  });
  assert.equal(online.state, "ready");
  assert.equal(online.mayDownload, true);
  assert.equal(online.mayActivate, true);

  const installed = planProfileProvisioning({
    distribution: candidate,
    installedComponentIds: ["knowledge.example"],
    networkAvailable: false,
  });
  assert.equal(installed.state, "already-provisioned");
  assert.equal(installed.mayActivate, true);
});

test("available component without signed content identity fails closed", () => {
  const unsafe = structuredClone(legal);
  unsafe.components = [{
    id: "knowledge.unsafe",
    kind: "knowledge-pack",
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

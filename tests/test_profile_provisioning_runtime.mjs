import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createProfileProvisioningRuntime,
} from "../system/services/profile-packs/provisioning.mjs";
import { validateProfilePack } from "../system/contracts/profile-pack.mjs";
import {
  createLocalProfileDistributions,
} from "../system/profile-packs/distributions.mjs";
import { createSessionProfileComponentInventory } from "../system/services/profile-packs/inventory.mjs";

function manifest(relativePath, label) {
  return validateProfilePack(
    JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")),
    label,
  );
}

const LOCAL_PROFILE_DISTRIBUTIONS = createLocalProfileDistributions([
  manifest("../system/profile-packs/developer/v1/manifest.json", "Developer manifest"),
  manifest("../system/profile-packs/legal-br/v1/manifest.json", "Legal-BR manifest"),
]);

test("runtime projects local Profile availability without performing installation", () => {
  const runtime = createProfileProvisioningRuntime({
    distributions: LOCAL_PROFILE_DISTRIBUTIONS,
    inventory: createSessionProfileComponentInventory(),
    readNetworkAvailable: () => true,
  });

  const plans = runtime.list();
  assert.equal(plans.length, 2);
  assert.equal(plans.find((plan) => plan.profile.slug === "developer").state, "blocked");
  assert.equal(plans.find((plan) => plan.profile.slug === "developer").componentsSatisfied, true);
  assert.equal(plans.find((plan) => plan.profile.slug === "legal-br").state, "blocked");
  assert.equal(plans.find((plan) => plan.profile.slug === "legal-br").componentsSatisfied, false);
  assert.equal(typeof runtime.install, "undefined");
  assert.equal(typeof runtime.download, "undefined");
});

test("runtime re-evaluates installed components and network without mutating Profile data", () => {
  let installedEntries = [];
  let online = false;
  const candidate = structuredClone(LOCAL_PROFILE_DISTRIBUTIONS[1]);
  const raw = {
    $schema: candidate.schema,
    profile: candidate.profile,
    delivery_mode: candidate.deliveryMode,
    metadata_bundled: candidate.metadataBundled,
    offline_after_install: candidate.offlineAfterInstall,
    public_install_enabled: true,
    blocked_reason: null,
    components: [{
      id: "knowledge.legal-br-core",
      kind: "knowledge-pack",
      version: "1.0.0",
      required: true,
      availability: "available",
      sha256: "c".repeat(64),
      size_bytes: 4096,
      signature_required: true,
    }],
  };

  const inventory = {
    schema: "ordax.profile-component-inventory-port/1",
    getSnapshot() {
      return {
        schema: "ordax.profile-component-inventory/1",
        revision: installedEntries.length,
        persistence: "device",
        entries: installedEntries,
      };
    },
    async refresh() {
      return this.getSnapshot();
    },
    dispose() {},
  };
  const runtime = createProfileProvisioningRuntime({
    distributions: [raw],
    inventory,
    readNetworkAvailable: () => online,
  });

  assert.equal(runtime.get("legal-br", 1).state, "network-required");
  online = true;
  assert.equal(runtime.refresh()[0].state, "ready");
  installedEntries = [{
    id: "knowledge.legal-br-core",
    kind: "knowledge-pack",
    version: "1.0.0",
    sha256: "c".repeat(64),
    installedAt: 1234,
    receiptSha256: "d".repeat(64),
  }];
  online = false;
  assert.equal(runtime.get("legal-br", 1).state, "already-provisioned");
  assert.equal(runtime.get("legal-br", 1).componentsSatisfied, true);
  assert.equal(runtime.get("legal-br", 1).alreadyInstalled[0].receiptSha256, "d".repeat(64));
  assert.equal(runtime.get("legal-br", 1).offlineAfterInstall, true);
});

test("runtime rejects duplicate profile distribution identity", () => {
  assert.throws(
    () => createProfileProvisioningRuntime({
      inventory: createSessionProfileComponentInventory(),
      distributions: [
        LOCAL_PROFILE_DISTRIBUTIONS[0],
        LOCAL_PROFILE_DISTRIBUTIONS[0],
      ],
    }),
    /Duplicate Profile distribution developer@1/,
  );
});

test("disposed runtime cannot be reused", () => {
  const runtime = createProfileProvisioningRuntime({
    distributions: LOCAL_PROFILE_DISTRIBUTIONS,
    inventory: createSessionProfileComponentInventory(),
  });
  runtime.dispose();
  assert.throws(() => runtime.list(), /disposed/);
});

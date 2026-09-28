import assert from "node:assert/strict";
import test from "node:test";

import {
  createProfileProvisioningRuntime,
} from "../system/services/profile-packs/provisioning.mjs";
import {
  LOCAL_PROFILE_DISTRIBUTIONS,
} from "../system/profile-packs/distributions.mjs";

test("runtime projects local Profile availability without performing installation", () => {
  const runtime = createProfileProvisioningRuntime({
    distributions: LOCAL_PROFILE_DISTRIBUTIONS,
    readInstalledComponentIds: () => [],
    readNetworkAvailable: () => true,
  });

  const plans = runtime.list();
  assert.equal(plans.length, 2);
  assert.equal(plans.find((plan) => plan.profile.slug === "developer").state, "blocked");
  assert.equal(plans.find((plan) => plan.profile.slug === "legal-br").state, "blocked");
  assert.equal(typeof runtime.install, "undefined");
  assert.equal(typeof runtime.download, "undefined");
});

test("runtime re-evaluates installed components and network without mutating Profile data", () => {
  let installed = [];
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
      required: true,
      availability: "available",
      sha256: "c".repeat(64),
      size_bytes: 4096,
      signature_required: true,
    }],
  };

  const runtime = createProfileProvisioningRuntime({
    distributions: [raw],
    readInstalledComponentIds: () => installed,
    readNetworkAvailable: () => online,
  });

  assert.equal(runtime.get("legal-br", 1).state, "network-required");
  online = true;
  assert.equal(runtime.refresh()[0].state, "ready");
  installed = ["knowledge.legal-br-core"];
  online = false;
  assert.equal(runtime.get("legal-br", 1).state, "already-provisioned");
  assert.equal(runtime.get("legal-br", 1).offlineAfterInstall, true);
});

test("runtime rejects duplicate profile distribution identity", () => {
  assert.throws(
    () => createProfileProvisioningRuntime({
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
  });
  runtime.dispose();
  assert.throws(() => runtime.list(), /disposed/);
});

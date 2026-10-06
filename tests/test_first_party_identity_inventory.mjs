import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { listFirstPartyAppDeliveryPolicies } from "../system/services/apps/delivery-policy.mjs";

const inventoryUrl = new URL(
  "../system/services/apps/first-party-identities.json",
  import.meta.url,
);

async function readInventory() {
  return JSON.parse(await readFile(inventoryUrl, "utf8"));
}

test("first-party identity inventory covers delivery policy and matches embedded runtime versions", async () => {
  const inventory = await readInventory();
  assert.deepEqual(Object.keys(inventory).sort(), [
    "$schema",
    "apps",
    "authority",
    "status",
    "verificationGeneration",
    "verificationPolicy",
  ]);
  assert.equal(inventory.$schema, "ordax.first-party-app-identity-inventory/1");
  assert.equal(inventory.status, "system-release-authenticated-source");
  assert.equal(inventory.authority, "semantic-identity-only");
  assert.equal(inventory.verificationPolicy, "ordax.publisher-trust/1");
  assert.equal(inventory.verificationGeneration, 1);
  assert.ok(Array.isArray(inventory.apps));

  const embeddedApps = new Map(
    listFirstPartyApps().map((app) => [app.id, app.component.version]),
  );
  const policyIds = listFirstPartyAppDeliveryPolicies()
    .map((policy) => policy.appId)
    .sort();

  const actual = new Map();
  for (const entry of inventory.apps) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "appId",
      "publisherPrincipalId",
      "version",
    ]);
    assert.match(entry.appId, /^[a-z][a-z0-9-]{0,63}$/);
    assert.match(entry.publisherPrincipalId, /^[a-z][a-z0-9.-]{0,95}$/);
    assert.match(entry.version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/);
    assert.equal(entry.publisherPrincipalId, "ordax-official");
    assert.equal(actual.has(entry.appId), false, `duplicate app identity: ${entry.appId}`);
    actual.set(entry.appId, entry.version);
  }

  assert.deepEqual(
    [...actual.keys()].sort(),
    policyIds,
    "every first-party delivery identity must remain verifiable even when its payload is external",
  );

  for (const [appId, version] of embeddedApps) {
    assert.equal(
      actual.get(appId),
      version,
      `${appId} identity version drifted from embedded component manifest`,
    );
  }

  assert.equal(
    embeddedApps.has("notes"),
    false,
    "external Notes must not be reintroduced into the embedded runtime catalog",
  );
  assert.equal(actual.get("notes"), "0.4.2", "external Notes identity must match the canonical external package");
});

test("identity inventory never treats signing or display metadata as the durable principal", async () => {
  const inventory = await readInventory();
  const serialized = JSON.stringify(inventory);
  for (const forbidden of [
    "keyId",
    "key_id",
    "publicKeyFingerprint",
    "signingKeyFingerprint",
    "publisherDisplayName",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not enter durable app identity`);
  }
});

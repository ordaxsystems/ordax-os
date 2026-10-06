import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import {
  STORE_LIFECYCLE_SCHEMA,
  STORE_LIFECYCLE_SNAPSHOT_SCHEMA,
  assertStoreLifecyclePort,
  validateStoreLifecycleSnapshot,
} from "../system/contracts/store-lifecycle.mjs";
import { getFirstPartyAppDeliveryPolicy } from "../system/services/apps/delivery-policy.mjs";

function observation(overrides = {}) {
  return {
    installed: false,
    catalogued: true,
    transition: "idle",
    blockedReason: null,
    failedRetained: false,
    ...overrides,
  };
}

test("Store is structural, bundled and non-removable", () => {
  const app = getFirstPartyApp("store");
  const policy = getFirstPartyAppDeliveryPolicy("store");
  assert.equal(app.id, "store");
  assert.equal(app.component.releaseMode, "bundled");
  assert.equal(policy.deliveryClass, "structural");
  assert.equal(policy.removable, false);
  assert.equal(policy.discovery, "installed-only");
  assert.equal(policy.authority, "none");
});

test("Store lifecycle snapshot validates observations without granting authority", () => {
  const snapshot = validateStoreLifecycleSnapshot({
    schema: STORE_LIFECYCLE_SNAPSHOT_SCHEMA,
    observations: [
      { appId: "notes", observation: observation() },
      { appId: "studio", observation: observation({ installed: true, catalogued: false }) },
    ],
    authority: "none",
  });
  assert.equal(snapshot.observations.length, 2);
  assert.equal(snapshot.authority, "none");
  assert.throws(
    () => validateStoreLifecycleSnapshot({ ...snapshot, authority: "install" }),
    /authority:none/,
  );
});

test("Store lifecycle port is request-only presentation boundary", () => {
  const snapshot = {
    schema: STORE_LIFECYCLE_SNAPSHOT_SCHEMA,
    observations: [],
    authority: "none",
  };
  const port = {
    schema: STORE_LIFECYCLE_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    requestInstall: async () => ({ accepted: false }),
  };
  assert.equal(assertStoreLifecyclePort(port), port);
});


const rootUrl = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

test("Store UI remains presentation-only and is mounted symmetrically", async () => {
  const ui = await source("system/surface/ui/store-overview-controls.mjs");
  const web = await source("system/composition/web/main.mjs");
  const native = await source("system/composition/native/main.mjs");
  const contract = JSON.parse(await source("docs/contracts/first-party-app-delivery.json"));

  assert.match(ui, /requestInstall/);
  for (const forbidden of ["componentManager", "runtime-component", "/__ordax/native/", "fetch("]) {
    assert.equal(ui.includes(forbidden), false, `Store UI must not own ${forbidden}`);
  }

  for (const composition of [web, native]) {
    assert.match(composition, /mountStoreOverviewControls\(root, surface, null\)/);
    assert.match(composition, /storeOverviewControls\.destroy\(\)/);
  }

  assert.equal(contract.store_boundary.public_store_ui_enabled, true);
  assert.equal(contract.store_boundary.store_ui_implemented, true);
  assert.equal(contract.store_boundary.store_service_implemented, false);
  assert.equal(contract.store_boundary.must_reuse_component_manager, true);
  assert.equal(contract.store_boundary.may_create_parallel_updater, false);
});

import assert from "node:assert/strict";
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

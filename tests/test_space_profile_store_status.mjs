import assert from "node:assert/strict";
import test from "node:test";
import { projectSpaceProfileStoreStatus } from "../system/services/spaces/profile-store-status.mjs";

const space = (profilePack) => ({
  id: "space-1", name: "Meu Space", kind: "professional", state: "active",
  ownerId: "owner-1", profilePack,
});
const profile = (version, apps = ["orders"]) => ({ slug: "pizzaria", version, apps });
const storeSnapshot = {
  schema: "ordax.app-store-catalog/2", state: "unavailable",
  entries: [], reason: "signed-catalog-unavailable", authority: "none",
};

test("without active Space or linked Profile, no app list is invented", () => {
  assert.equal(projectSpaceProfileStoreStatus({ space: null }).state, "no-space");
  assert.equal(projectSpaceProfileStoreStatus({ space: space(null) }).state, "no-profile");
});

test("unknown and ambiguous profile versions never select arbitrary apps", () => {
  const missing = projectSpaceProfileStoreStatus({
    space: space("pizzaria"), profiles: [], storeSnapshot,
  });
  assert.equal(missing.state, "profile-not-listed");
  const ambiguous = projectSpaceProfileStoreStatus({
    space: space("pizzaria"), profiles: [profile(1), profile(2)], storeSnapshot,
  });
  assert.equal(ambiguous.state, "profile-ambiguous");
  assert.deepEqual(ambiguous.entries, []);
});

test("unique Profile references reuse the Store projection without installation claims", () => {
  const result = projectSpaceProfileStoreStatus({
    space: space("pizzaria"), profiles: [profile(1)], storeSnapshot,
  });
  assert.equal(result.state, "store-unavailable");
  assert.equal(result.profileVersion, 1);
  assert.deepEqual(result.entries.map(e => e.status), ["unknown"]);
  assert.equal("installable" in result.entries[0], false);
  assert.ok(Object.isFrozen(result.entries));
});

test("rejects invalid Space and invalid resolved Profile", () => {
  assert.throws(() => projectSpaceProfileStoreStatus({
    space: { ...space("pizzaria"), kind: "invalid" }, profiles: [], storeSnapshot,
  }), /Space kind/);
  assert.throws(() => projectSpaceProfileStoreStatus({
    space: space("pizzaria"), profiles: [{ slug: "pizzaria", version: 0, apps: [] }], storeSnapshot,
  }), /invalid/);
});

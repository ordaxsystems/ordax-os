import assert from "node:assert/strict";
import test from "node:test";
import { projectSpaceProfileStoreStatus } from "../system/services/spaces/profile-store-status.mjs";

const space = profilePack => ({
  id: "space-1", name: "Meu Space", kind: "professional", state: "active",
  ownerId: "owner-1", profilePack,
});
const profile = (version, apps = ["orders"], overrides = {}) => ({
  schema: "ordax.profile-pack-catalog-entry/1",
  slug: "pizzaria-br", version, title: "Pizzaria", category: "Comércio",
  spaceKind: "professional", apps, templates: [],
  intelligence: { preferredPurpose: null, externalProviderRequired: false },
  ...overrides,
});
const unavailableStore = {
  schema: "ordax.app-store-catalog/2", state: "unavailable",
  entries: [], reason: "signed-catalog-unavailable", authority: "none",
};

test("without selected Space or linked Profile, no app list is invented", () => {
  assert.equal(projectSpaceProfileStoreStatus({ space: null }).state, "no-space");
  assert.equal(projectSpaceProfileStoreStatus({ space: space(null) }).state, "no-profile");
});

test("archived Space cannot expose bound Profile apps or Store observations", () => {
  const result = projectSpaceProfileStoreStatus({
    space: { ...space("pizzaria-br@1"), state: "archived" },
    profiles: [profile(1)], storeSnapshot: unavailableStore,
  });
  assert.equal(result.state, "space-inactive");
  assert.equal(result.profile, null);
  assert.deepEqual(result.entries, []);
});

test("bare slug never silently selects a Profile version even if only one exists", () => {
  const result = projectSpaceProfileStoreStatus({
    space: space("pizzaria-br"), profiles: [profile(1)], storeSnapshot: unavailableStore,
  });
  assert.equal(result.state, "profile-unpinned");
  assert.deepEqual(result.entries, []);
});

test("canonical slug@version resolves exactly, not latest or first", () => {
  const result = projectSpaceProfileStoreStatus({
    space: space("pizzaria-br@1"),
    profiles: [profile(2, ["other-app"]), profile(1, ["orders"])],
    storeSnapshot: unavailableStore,
  });
  assert.equal(result.state, "store-unavailable");
  assert.equal(result.profile, "pizzaria-br@1");
  assert.equal(result.profileVersion, 1);
  assert.deepEqual(result.entries.map(x => x.appId), ["orders"]);
  assert.deepEqual(result.entries.map(x => x.status), ["unknown"]);
  assert.equal("installable" in result.entries[0], false);
  assert.ok(Object.isFrozen(result.entries));
});

test("missing pinned version never falls back to another published version", () => {
  const result = projectSpaceProfileStoreStatus({
    space: space("pizzaria-br@3"), profiles: [profile(1), profile(2)],
    storeSnapshot: unavailableStore,
  });
  assert.equal(result.state, "profile-not-listed");
  assert.deepEqual(result.entries, []);
});

test("invalid identity and Space/Profile kind mismatch fail closed", () => {
  for (const binding of ["pizzaria-br@0", "pizzaria-br@01", "pizzaria-br@x", "pizzaria-br@9007199254740992", "pizzaria-br@1@2"]) {
    const result = projectSpaceProfileStoreStatus({
      space: space(binding), profiles: [profile(1)], storeSnapshot: unavailableStore,
    });
    assert.equal(result.state, "profile-invalid-binding", binding);
    assert.deepEqual(result.entries, [], binding);
  }
  const mismatch = projectSpaceProfileStoreStatus({
    space: space("pizzaria-br@1"),
    profiles: [profile(1, ["orders"], { spaceKind: "personal" })],
    storeSnapshot: unavailableStore,
  });
  assert.equal(mismatch.state, "profile-kind-mismatch");
  assert.deepEqual(mismatch.entries, []);
});

test("invalid published catalog and invalid Space are rejected", () => {
  assert.throws(() => projectSpaceProfileStoreStatus({
    space: { ...space("pizzaria-br@1"), kind: "invalid" }, profiles: [], storeSnapshot: unavailableStore,
  }), /Space kind/);
  assert.throws(() => projectSpaceProfileStoreStatus({
    space: space("pizzaria-br@1"), profiles: [profile(0)], storeSnapshot: unavailableStore,
  }), /invalid/);
  assert.throws(() => projectSpaceProfileStoreStatus({
    space: space("pizzaria-br@1"), profiles: [profile(1), profile(1)], storeSnapshot: unavailableStore,
  }), /unique/);
});

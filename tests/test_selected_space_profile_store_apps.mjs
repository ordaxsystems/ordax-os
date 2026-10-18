import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectSelectedSpaceProfileStoreApps } from "../system/services/spaces/selected-profile-store-apps.mjs";
import { validateProfilePackCatalogProjection } from "../system/contracts/profile-pack-catalog.mjs";

const space = (overrides = {}) => ({
  id: "space-01", name: "Minha Pizzaria", kind: "professional",
  state: "active", ownerId: "user-01", profilePack: "pizzaria-br@1", ...overrides,
});
const profile = (overrides = {}) => validateProfilePackCatalogProjection({
  schema: "ordax.profile-pack-catalog-entry/1",
  slug: "pizzaria-br", version: 1, title: "Pizzaria", category: "food",
  spaceKind: "professional", apps: ["orders", "files"],
  templates: [], intelligence: { preferredPurpose: null, externalProviderRequired: false }, ...overrides,
});
const store = (state = "ready", entries = [], reason = null) => ({
  schema: "ordax.app-store-catalog/2", state, entries, reason, authority: "none",
});
const installed = {
  appId: "orders", title: "Pedidos", state: "installed",
  installedVersion: "1.0.0", availableVersion: null,
  installable: false, updatable: false, removable: true,
  blockedReason: null, artifactIdentityVerified: false, provenanceVerified: false,
};

test("unselected Space exposes no Profile, apps or Store observations", () => {
  assert.deepEqual(projectSelectedSpaceProfileStoreApps(), {
    state: "no-selection", profileTitle: null, storeState: null, entries: [],
  });
});

test("exact account Profile identity joins published apps to Store without Space installation authority", () => {
  const result = projectSelectedSpaceProfileStoreApps({
    space: space(), profileEntries: [profile()], storeSnapshot: store("ready", [installed]),
  });
  assert.equal(result.state, "ready");
  assert.equal(result.profileTitle, "Pizzaria");
  assert.deepEqual(result.entries.map(entry => [entry.appId, entry.status]), [
    ["orders", "installed"], ["files", "not-listed"],
  ]);
  assert.equal("spaceId" in result.entries[0], false);
  assert.equal("installable" in result.entries[0], false);
  assert.ok(Object.isFrozen(result.entries));
});

test("missing Profile link exposes no inferred apps or latest binding", () => {
  assert.equal(projectSelectedSpaceProfileStoreApps({ space: space({ profilePack: null }) }).state, "no-profile");
  for (const bound of ["pizzaria-br", "pizzaria-br@latest", "pizzaria-br@01", "pizzaria-br@2"]) {
    const result = projectSelectedSpaceProfileStoreApps({
      space: space({ profilePack: bound }), profileEntries: [profile()], storeSnapshot: store(),
    });
    assert.equal(result.state, "profile-unavailable", bound);
    assert.deepEqual(result.entries, []);
  }
});

test("Space kind mismatch and retired/unpublished Profile never produce app suggestions", () => {
  const result = projectSelectedSpaceProfileStoreApps({
    space: space(), profileEntries: [profile({ spaceKind: "work" })], storeSnapshot: store(),
  });
  assert.equal(result.state, "profile-unavailable");
  assert.deepEqual(result.entries, []);
});

test("unavailable Store never implies install, uninstallation or availability for selected Space", () => {
  const result = projectSelectedSpaceProfileStoreApps({
    space: space(), profileEntries: [profile()],
    storeSnapshot: store("unavailable", [], "transport-unavailable"),
  });
  assert.equal(result.state, "ready");
  assert.equal(result.storeState, "unavailable");
  assert.deepEqual(result.entries.map(x => x.status), ["unknown", "unknown"]);
});

test("invalid Profile or Store data fails closed and cannot supply invented state", () => {
  assert.throws(() => projectSelectedSpaceProfileStoreApps({
    space: space(), profileEntries: [profile({ apps: ["orders", "orders"] })], storeSnapshot: store(),
  }), /duplicate/);
  assert.throws(() => projectSelectedSpaceProfileStoreApps({
    space: space(), profileEntries: [profile()],
    storeSnapshot: store("ready", [{ ...installed, appId: "Orders" }]),
  }), /canonical|invalid|app/i);
  assert.equal(projectSelectedSpaceProfileStoreApps({ space: space({ state: "archived" }) }).state, "unavailable");
});

test("Surface uses canonical account selection, Profile reader and Store snapshot, no direct mutation", () => {
  const root = new URL("../system/surface/workspace/components/central/", import.meta.url);
  const source = readFileSync(new URL("space-profile-apps-panel.tsx", root), "utf8");
  const spaces = readFileSync(new URL("spaces-experience.tsx", root), "utf8");
  assert.match(source, /useWebAccount\(\)/);
  assert.match(source, /authorized\.activeSpace/);
  assert.match(source, /useProfileCatalogReader\(\)/);
  assert.match(source, /useStoreCatalog\(\)/);
  assert.match(source, /projectSelectedSpaceProfileStoreApps/);
  assert.match(spaces, /<SpaceProfileAppsPanel/);
  assert.doesNotMatch(source, /\bfetch\s*\(|supabase|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /\.install\s*\(|\.update\s*\(|\.remove\s*\(/);
});

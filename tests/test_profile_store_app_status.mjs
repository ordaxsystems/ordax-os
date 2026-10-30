import assert from "node:assert/strict";
import test from "node:test";
import { projectProfileStoreAppStatus } from "../system/services/profile-packs/store-app-status.mjs";

const entry = (appId, overrides = {}) => ({
  appId, title: appId, state: "installed",
  installedVersion: "1.0.0", availableVersion: null,
  installable: false, updatable: false, removable: true,
  blockedReason: null, artifactIdentityVerified: false,
  provenanceVerified: false, ...overrides,
});
const snapshot = (state, entries = [], reason = null) => ({
  schema: "ordax.app-store-catalog/2", state, entries, reason, authority: "none",
});

test("Profile references join verified Store state without installation authority", () => {
  const result = projectProfileStoreAppStatus({
    apps: ["orders", "files", "missing"],
    storeSnapshot: snapshot("ready", [
      entry("orders", { availableVersion: "2.0.0", updatable: true,
        artifactIdentityVerified: true, provenanceVerified: true }),
      entry("files"),
    ]),
  });
  assert.deepEqual(result.entries.map((app) => app.status), [
    "update-available", "installed", "not-listed",
  ]);
  assert.equal(result.entries[0].installedVersion, "1.0.0");
  assert.equal("installable" in result.entries[0], false);
  assert.ok(Object.isFrozen(result.entries));
});

test("unavailable catalog never implies apps are absent or installed", () => {
  const result = projectProfileStoreAppStatus({
    apps: ["orders"],
    storeSnapshot: snapshot("unavailable", [], "signed-catalog-unavailable"),
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.entries[0].status, "unknown");
});

test("blocked and in-flight states are represented without permissions", () => {
  const result = projectProfileStoreAppStatus({
    apps: ["blocked", "busy"],
    storeSnapshot: snapshot("ready", [
      entry("blocked", { state: "blocked", blockedReason: "policy" }),
      entry("busy", { state: "updating", availableVersion: "2.0.0",
        updatable: false, removable: false,
        artifactIdentityVerified: true, provenanceVerified: true }),
    ]),
  });
  assert.deepEqual(result.entries.map((x) => x.status), ["blocked", "in-progress"]);
  assert.equal(result.entries[0].blockedReason, "policy");
});

test("invalid Store data and duplicate Profile IDs fail closed", () => {
  assert.throws(() => projectProfileStoreAppStatus({
    apps: ["orders", "orders"], storeSnapshot: snapshot("ready"),
  }), /duplicate/);
  assert.throws(() => projectProfileStoreAppStatus({
    apps: ["orders"], storeSnapshot: snapshot("unavailable", [entry("orders")], "offline"),
  }), /cannot claim product entries/);
});

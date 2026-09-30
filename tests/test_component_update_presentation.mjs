import assert from "node:assert/strict";

import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";
import {
  appVersionStage,
  createComponentUpdateScopes,
} from "../system/services/components/update-presentation.mjs";

const manager = createComponentManager({
  manifests: listSystemComponents(),
  now: () => 1_789_920_000_000,
});

const scopes = createComponentUpdateScopes(manager.getSnapshot());
const apps = new Map(scopes.applications.map((component) => [component.id, component]));
const system = new Map(scopes.system.map((component) => [component.id, component]));

assert.equal(appVersionStage("0.1.0"), "beta");
assert.equal(appVersionStage("0.4.0"), "beta");
assert.equal(appVersionStage("1.0.0-beta.1"), "beta");
assert.equal(appVersionStage("1.0.0"), "stable");

assert.deepEqual(
  new Set(apps.keys()),
  new Set(["files", "projects", "settings", "account", "internet", "notes"]),
);
assert.equal(system.has("system"), true, "Sistema belongs to the system update scope");
assert.equal(system.has("ordax-base"), true);
assert.equal(system.has("surface-shell"), true);

assert.equal(apps.get("files").version, "0.1.0");
assert.equal(apps.get("files").versionStage, "beta");
assert.equal(apps.get("files").updateChannel.id, "system-bundle");
assert.equal(apps.get("files").independentUpdate, false);

assert.equal(apps.get("projects").version, "0.1.0");
assert.equal(apps.get("projects").versionStage, "beta");
assert.equal(apps.get("projects").updateChannel.id, "development-git");
assert.equal(apps.get("settings").version, "0.1.0");
assert.equal(apps.get("account").version, "0.1.0");
assert.equal(apps.get("internet").version, "0.3.0");
assert.equal(apps.get("internet").versionStage, "beta");
assert.equal(apps.get("internet").updateChannel.id, "development-git");
assert.equal(apps.get("notes").version, "0.4.1");
assert.equal(apps.get("notes").versionStage, "beta");
assert.equal(apps.get("notes").updateChannel.id, "development-git");

assert.equal(system.get("system").version, "0.1.0");
assert.equal(system.get("system").versionStage, "beta");
assert.equal(system.get("system").updateChannel.id, "system-bundle");
assert.equal(system.get("ordax-base").updateChannel.id, "system-base");

manager.destroy();
console.log("component update presentation: PASS");

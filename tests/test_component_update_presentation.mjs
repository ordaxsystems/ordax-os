import assert from "node:assert/strict";
import test from "node:test";

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
  new Set(["files", "studio", "settings", "account", "store"]),
);
assert.equal(system.has("system"), true, "Sistema belongs to the system update scope");
assert.equal(system.has("ordax-base"), true);
assert.equal(system.has("surface-shell"), true);

assert.equal(apps.get("files").version, "0.1.0");
assert.equal(apps.get("files").versionStage, "beta");
assert.equal(apps.get("files").updateChannel.id, "system-bundle");
assert.equal(apps.get("files").independentUpdate, false);

assert.equal(apps.get("studio").version, "0.1.0");
assert.equal(apps.get("studio").versionStage, "beta");
assert.equal(apps.get("studio").updateChannel.id, "development-git");
assert.equal(apps.get("studio").independentUpdate, false);
assert.equal(apps.get("settings").version, "0.1.0");
assert.equal(apps.get("account").version, "0.1.0");
assert.equal(apps.get("store").version, "0.1.0");
assert.equal(apps.get("store").versionStage, "beta");
assert.equal(apps.get("store").updateChannel.id, "system-bundle");
assert.equal(apps.get("store").independentUpdate, false);

assert.equal(system.get("system").version, "0.1.0");
assert.equal(system.get("system").versionStage, "beta");
assert.equal(system.get("system").updateChannel.id, "system-bundle");
assert.equal(system.get("ordax-base").updateChannel.id, "system-base");

manager.destroy();
console.log("component update presentation: PASS");

test("delivery channel and version maturity remain separate for installed app components", () => {
  const template = listSystemComponents().find(({ id }) => id === "files");
  for (const [releaseMode, channelId, independentUpdate] of [
    ["bundled", "system-bundle", false],
    ["git-app", "development-git", false],
    ["component-slot", "independent-component", true],
  ]) {
    const fixture = createComponentManager({
      manifests: [{ ...template, dependencies: [], releaseMode, version: "1.0.0" }],
      now: () => 1_789_920_000_000,
    });
    try {
      const { applications, system } = createComponentUpdateScopes(fixture.getSnapshot());
      assert.equal(system.length, 0);
      assert.equal(applications.length, 1);
      assert.equal(applications[0].versionStage, "stable");
      assert.equal(applications[0].updateChannel.id, channelId);
      assert.equal(applications[0].independentUpdate, independentUpdate);
    } finally {
      fixture.destroy();
    }
  }
});

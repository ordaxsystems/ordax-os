import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";

test("system interfaces have a single system-interface descriptor source, not a removable app source", () => {
  for (const id of ["settings", "account", "store", "system"]) {
    const app = getFirstPartyApp(id);
    const component = getSystemComponent(id);
    assert.ok(app, id);
    assert.deepEqual(app.component, component);
    assert.equal(component.owner, "system/services/system-ui/" + id);
    assert.equal(component.releaseMode, "bundled");
    assert.equal(existsSync(new URL("../system/services/system-ui/" + id + "/app.mjs", import.meta.url)), true);
    assert.equal(existsSync(new URL("../system/apps/" + id + "/", import.meta.url)), false);
  }
});

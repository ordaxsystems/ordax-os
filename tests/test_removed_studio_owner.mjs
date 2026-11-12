import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getFirstPartyApp, listFirstPartyApps } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { listSurfaceShortcutAppIds } from "../system/services/surface/shortcut-catalog.mjs";
import { createNativeVerifiedInstalledAppCatalog } from "../system/composition/native/verified-installed-apps.mjs";
test("Studio is absent until a signed external package is installed", () => {
  assert.equal(existsSync(new URL("../system/apps/studio/", import.meta.url)), false);
  assert.equal(getFirstPartyApp("studio"), null);
  assert.equal(getSystemComponent("studio"), null);
  assert.ok(!listFirstPartyApps().some(app => app.id === "studio"));
  for (const area of ["central", "desktop", "dock", "navigation-menu"]) {
    assert.ok(!listSurfaceShortcutAppIds(area).includes("studio"), area);
  }
  const result = createNativeVerifiedInstalledAppCatalog([]);
  assert.equal(result.catalog.get("studio"), null);
  assert.deepEqual(result.installed, []);
});

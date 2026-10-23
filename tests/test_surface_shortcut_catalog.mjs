import test from "node:test";
import assert from "node:assert/strict";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  listSurfaceShortcutAppIds,
  SURFACE_SHORTCUT_CATALOG,
} from "../system/services/surface/shortcut-catalog.mjs";

test("surface shortcut placements reference real first-party app owners", () => {
  const appIds = new Set(listFirstPartyApps().map((app) => app.id));
  for (const shortcut of SURFACE_SHORTCUT_CATALOG) {
    assert.ok(appIds.has(shortcut.appId), `${shortcut.appId} must exist in the app catalog`);
  }
});

test("central, desktop, and dock shortcuts derive from the same ordered catalog", () => {
  assert.deepEqual(listSurfaceShortcutAppIds("central"), ["settings"]);
  assert.deepEqual(listSurfaceShortcutAppIds("desktop"), ["settings"]);
  assert.deepEqual(listSurfaceShortcutAppIds("dock"), ["settings", "store", "account", "system"]);
  assert.deepEqual(listSurfaceShortcutAppIds("navigation-menu"), ["settings", "system"]);
  assert.throws(() => listSurfaceShortcutAppIds("notes"), /Unknown Surface shortcut placement/);
});

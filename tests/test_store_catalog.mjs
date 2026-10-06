import assert from "node:assert/strict";
import test from "node:test";

import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import {
  getStoreCatalogEntry,
  listStoreCatalogEntries,
  STORE_CATALOG_ENTRY_SCHEMA,
} from "../system/services/apps/store-catalog.mjs";

test("Store is a structural bundled app with no independent authority", () => {
  const app = getFirstPartyApp("store");
  assert.ok(app);
  assert.equal(app.component.id, "store");
  assert.equal(app.component.releaseMode, "bundled");
  assert.equal(app.component.owner, "system/apps/store");
  assert.equal(app.panels.length, 1);
  assert.equal(app.panels[0].kind, "extension");
  assert.equal(app.panels[0].extensionId, "store-overview");

  const component = getSystemComponent("store");
  assert.ok(component);
  assert.equal(component.releaseMode, "bundled");
});

test("Store catalog is read-only discovery metadata for on-demand products", () => {
  const entries = listStoreCatalogEntries();
  assert.deepEqual(
    entries.map((entry) => entry.appId),
    ["assistant", "studio", "projects", "activity", "notes", "network"],
  );
  assert.equal(new Set(entries.map((entry) => entry.appId)).size, entries.length);

  for (const entry of entries) {
    assert.equal(entry.schema, STORE_CATALOG_ENTRY_SCHEMA);
    assert.equal(entry.deliveryClass, "on-demand");
    assert.equal(entry.removable, true);
    assert.equal(entry.presentation, "catalog-only");
    assert.equal(entry.installAction, "none");
    assert.equal(entry.authority, "none");
    assert.equal(getStoreCatalogEntry(entry.appId), entry);
  }
  assert.equal(getStoreCatalogEntry("store"), null);
  assert.equal(getStoreCatalogEntry("unknown"), null);
});

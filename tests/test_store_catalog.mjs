import assert from "node:assert/strict";
import test from "node:test";

import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { listFirstPartyAppDeliveryPolicies } from "../system/services/apps/delivery-policy.mjs";
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

test("Store catalog is the read-only projection of on-demand delivery policy", () => {
  const entries = listStoreCatalogEntries();
  const onDemandPolicies = listFirstPartyAppDeliveryPolicies()
    .filter((policy) => policy.deliveryClass === "on-demand");

  assert.deepEqual(
    entries.map((entry) => entry.appId),
    onDemandPolicies.map((policy) => policy.appId),
  );
  assert.equal(entries.length, 6);
  assert.equal(new Set(entries.map((entry) => entry.appId)).size, entries.length);

  for (const [index, entry] of entries.entries()) {
    const policy = onDemandPolicies[index];
    assert.equal(entry.schema, STORE_CATALOG_ENTRY_SCHEMA);
    assert.equal(entry.appId, policy.appId);
    assert.equal(entry.deliveryClass, policy.deliveryClass);
    assert.equal(entry.discovery, policy.discovery);
    assert.equal(entry.removable, policy.removable);
    assert.equal(entry.presentation, "catalog-only");
    assert.equal(entry.installAction, "none");
    assert.equal(entry.authority, "none");
    assert.equal(getStoreCatalogEntry(entry.appId), entry);
  }
  assert.equal(getStoreCatalogEntry("store"), null);
  assert.equal(getStoreCatalogEntry("unknown"), null);
});

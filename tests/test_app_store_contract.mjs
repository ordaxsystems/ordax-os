import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { storeApp } from "../system/apps/store/app.mjs";
import {
  APP_STORE_CATALOG_SCHEMA,
  APP_STORE_INSTALL_REQUEST_RESULT_SCHEMA,
  createUnavailableAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
  validateAppStoreInstallRequestResult,
} from "../system/contracts/app-store.mjs";

test("Store is a bundled structural presentation surface", () => {
  assert.equal(storeApp.id, "store");
  assert.equal(storeApp.component.id, "store");
  assert.equal(storeApp.component.releaseMode, "bundled");
  assert.equal(storeApp.component.owner, "system/apps/store");
  assert.equal(storeApp.panels[0].extensionId, "store-overview");
  assert.deepEqual(storeApp.requiredCapabilities, []);
});

test("Store catalog fails closed when signed catalog is unavailable", () => {
  const port = createUnavailableAppStoreCatalogPort();
  const snapshot = port.getSnapshot();
  assert.equal(snapshot.schema, APP_STORE_CATALOG_SCHEMA);
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.reason, "signed-catalog-unavailable");
  assert.deepEqual(snapshot.entries, []);
  assert.equal(snapshot.authority, "none");
});

test("Store never marks an unverified artifact as installable", () => {
  assert.throws(
    () => validateAppStoreCatalogSnapshot({
      schema: APP_STORE_CATALOG_SCHEMA,
      state: "ready",
      entries: [{
        appId: "notes",
        title: "Notas",
        version: "0.4.3",
        state: "available",
        installable: true,
        installed: false,
        blockedReason: null,
        artifactIdentityVerified: true,
        provenanceVerified: false,
      }],
      reason: null,
      authority: "none",
    }),
    /verified artifact identity and provenance/,
  );
});

test("Store accepts verified catalog presentation without granting authority", () => {
  const snapshot = validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries: [{
      appId: "notes",
      title: "Notas",
      version: "0.4.3",
      state: "available",
      installable: true,
      installed: false,
      blockedReason: null,
      artifactIdentityVerified: true,
      provenanceVerified: true,
    }],
    reason: null,
    authority: "none",
  });
  assert.equal(snapshot.entries[0].installable, true);
  assert.equal(snapshot.authority, "none");
});

test("Store lifecycle response is only a request receipt and remains authority:none", () => {
  const accepted = validateAppStoreInstallRequestResult({
    schema: APP_STORE_INSTALL_REQUEST_RESULT_SCHEMA,
    appId: "notes",
    state: "accepted",
    requestId: "request:notes:1",
    reason: null,
    authority: "none",
  });
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.authority, "none");

  assert.throws(
    () => validateAppStoreInstallRequestResult({
      schema: APP_STORE_INSTALL_REQUEST_RESULT_SCHEMA,
      appId: "notes",
      state: "accepted",
      requestId: "request:notes:2",
      reason: null,
      authority: "install",
    }),
    /authority:none/,
  );
});

test("Store controls cannot import component lifecycle authority directly", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /requestInstall/);
  assert.match(source, /data-store-authority/);
  assert.doesNotMatch(source, /services\/components/);
  assert.doesNotMatch(source, /runtime-component-channel/);
  assert.doesNotMatch(source, /promote\(/);
  assert.doesNotMatch(source, /stage\(/);
});

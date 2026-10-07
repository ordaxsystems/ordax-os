import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { storeApp } from "../system/apps/store/app.mjs";
import {
  APP_STORE_CATALOG_SCHEMA,
  createUnavailableAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../system/contracts/app-store.mjs";

function entry(overrides = {}) {
  return {
    appId: "notes",
    title: "Notas",
    state: "available",
    installedVersion: null,
    availableVersion: "0.4.3",
    installable: true,
    updatable: false,
    removable: false,
    blockedReason: null,
    artifactIdentityVerified: true,
    provenanceVerified: true,
    ...overrides,
  };
}

function snapshot(value) {
  return {
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries: [value],
    reason: null,
    authority: "none",
  };
}

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
  const value = port.getSnapshot();
  assert.equal(value.schema, APP_STORE_CATALOG_SCHEMA);
  assert.equal(value.state, "unavailable");
  assert.equal(value.reason, "signed-catalog-unavailable");
  assert.deepEqual(value.entries, []);
  assert.equal(value.authority, "none");
});

test("Store never marks an unverified candidate as installable or updatable", () => {
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({ provenanceVerified: false }))),
    /Installable App Store entry is semantically inconsistent/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "installed",
      installedVersion: "0.4.2",
      availableVersion: "0.4.3",
      installable: false,
      updatable: true,
      removable: true,
      provenanceVerified: false,
    }))),
    /Updatable App Store entry is semantically inconsistent/,
  );
});

test("Store models install, update and remove without granting lifecycle authority", () => {
  const install = validateAppStoreCatalogSnapshot(snapshot(entry())).entries[0];
  assert.equal(install.installable, true);

  const update = validateAppStoreCatalogSnapshot(snapshot(entry({
    state: "installed",
    installedVersion: "0.4.2",
    availableVersion: "0.4.3",
    installable: false,
    updatable: true,
    removable: true,
  }))).entries[0];
  assert.equal(update.updatable, true);
  assert.equal(update.removable, true);

  const removeOnly = validateAppStoreCatalogSnapshot(snapshot(entry({
    state: "installed",
    installedVersion: "0.4.3",
    availableVersion: null,
    installable: false,
    updatable: false,
    removable: true,
    artifactIdentityVerified: false,
    provenanceVerified: false,
  }))).entries[0];
  assert.equal(removeOnly.removable, true);
});

test("Store rejects downgrade/equal candidates and lifecycle contradictions", () => {
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "installed",
      installedVersion: "0.4.3",
      availableVersion: "0.4.3",
      installable: false,
      updatable: true,
      removable: true,
    }))),
    /newer than installedVersion/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "updating",
      installedVersion: "0.4.2",
      installable: false,
      updatable: true,
      removable: false,
    }))),
    /In-flight App Store entry cannot expose/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "blocked",
      installable: false,
      artifactIdentityVerified: false,
      provenanceVerified: false,
    }))),
    /requires blockedReason/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "installing",
      availableVersion: null,
      installable: false,
      artifactIdentityVerified: false,
      provenanceVerified: false,
    }))),
    /requires a verified candidate/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "updating",
      installedVersion: "0.4.2",
      installable: false,
      updatable: false,
      removable: false,
      provenanceVerified: false,
    }))),
    /requires installed and verified candidate versions/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({
      state: "staged",
      availableVersion: null,
      installable: false,
      artifactIdentityVerified: false,
      provenanceVerified: false,
    }))),
    /requires a verified candidate/,
  );
});

test("failed update retains installed version and may still be removable", () => {
  const retained = validateAppStoreCatalogSnapshot(snapshot(entry({
    state: "failed-retained",
    installedVersion: "0.4.2",
    availableVersion: null,
    installable: false,
    updatable: false,
    removable: true,
    artifactIdentityVerified: false,
    provenanceVerified: false,
  }))).entries[0];
  assert.equal(retained.installedVersion, "0.4.2");
  assert.equal(retained.removable, true);
});

test("Store controls request lifecycle operations but cannot import component lifecycle authority", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /app-lifecycle-request\.mjs/);
  assert.match(source, /APP_LIFECYCLE_REQUEST_SCHEMA/);
  assert.match(source, /requestLifecycle/);
  assert.match(source, /data-store-operation/);
  assert.match(source, /dataset\.storeAuthority/);
  assert.match(source, /reconcileAcceptedRequest/);
  assert.match(source, /phase: "accepted"/);
  assert.doesNotMatch(source, /services\/components/);
  assert.doesNotMatch(source, /runtime-component-channel/);
  assert.doesNotMatch(source, /promote\(/);
  assert.doesNotMatch(source, /rollback\(/);
  assert.doesNotMatch(source, /uninstall\(/);
});

test("Store catalog remains bounded and canonical", () => {
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({ title: "x".repeat(161) }))),
    /bounded canonical title/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot(snapshot(entry({ availableVersion: "latest" }))),
    /canonical component version/,
  );
  assert.throws(
    () => validateAppStoreCatalogSnapshot({
      schema: APP_STORE_CATALOG_SCHEMA,
      state: "ready",
      entries: Array.from({ length: 257 }, (_, index) => entry({
        appId: `app-${index}`,
        installable: false,
      })),
      reason: null,
      authority: "none",
    }),
    /bounded array/,
  );
});

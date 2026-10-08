import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { storeApp } from "../system/apps/store/app.mjs";
import { createStoreRequestSessionId, filterStoreEntries, sortStoreEntries } from "../system/surface/ui/store-overview-controls.mjs";
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

test("Store discovery filters consume only canonical catalog entries", () => {
  const available = entry();
  const installed = entry({
    appId: "internet",
    title: "Internet",
    state: "installed",
    installedVersion: "0.3.0",
    availableVersion: null,
    installable: false,
    updatable: false,
    removable: true,
    artifactIdentityVerified: false,
    provenanceVerified: false,
  });
  const update = entry({
    appId: "studio",
    title: "OrdaX Studio",
    state: "installed",
    installedVersion: "0.5.0",
    availableVersion: "0.5.1",
    installable: false,
    updatable: true,
    removable: true,
  });
  const retained = entry({
    appId: "files",
    title: "Arquivos",
    state: "failed-retained",
    installedVersion: "0.2.0",
    availableVersion: null,
    installable: false,
    updatable: false,
    removable: true,
    artifactIdentityVerified: false,
    provenanceVerified: false,
  });
  const entries = validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries: [available, installed, update, retained],
    reason: null,
    authority: "none",
  }).entries;

  assert.deepEqual(filterStoreEntries(entries).map((item) => item.appId), [
    "notes", "internet", "studio", "files",
  ]);
  assert.deepEqual(filterStoreEntries(entries, "installed").map((item) => item.appId), [
    "internet", "studio", "files",
  ]);
  assert.deepEqual(filterStoreEntries(entries, "updates").map((item) => item.appId), [
    "studio", "files",
  ]);
  assert.deepEqual(filterStoreEntries(entries, "discover", "  STUDIO ").map((item) => item.appId), [
    "studio",
  ]);
  assert.deepEqual(filterStoreEntries(entries, "installed", "notes"), []);
  assert.throws(() => filterStoreEntries(entries, "admin"), /Invalid Store presentation filter/);
});

test("Store discovery uses accessible interaction and localized metadata without granting authority", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url), "utf8",
  );
  const styles = await readFile(
    new URL("../system/surface/ui/store.css", import.meta.url), "utf8",
  );
  const locale = await readFile(
    new URL("../system/services/i18n/catalog/store.mjs", import.meta.url), "utf8",
  );
  for (const marker of [
    "data-store-app-card", "data-store-search", "data-store-view",
    "data-store-details", "aria-label", "aria-pressed", "role",
    "filterStoreEntries", "entry.artifactIdentityVerified",
    "entry.provenanceVerified", "entry.blockedReason",
  ]) assert.ok(source.includes(marker), marker);
  assert.match(styles, /@container \(max-width: 800px\)/);
  assert.match(styles, /container-type: inline-size/);
  assert.match(styles, /ordax-store-removal-confirmation/);
  assert.match(styles, /var\(--ordax-accent/);
  assert.match(styles, /prefers-reduced-motion/);
  for (const key of [
    "store.navigation.discover", "store.navigation.installed",
    "store.navigation.updates", "store.search.placeholder",
    "store.details.permissionNote", "store.details.openFor",
    "store.details.notApplicable", "store.remove.confirmTitle",
    "store.remove.confirmDescription", "store.remove.confirmAction",
    "store.remove.cancel",
  ]) assert.equal(locale.split(key).length, 3, key + " must exist in both locales");
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|innerHTML|new Worker/);
});


test("Store search normalizes accents without changing installability or catalog state", () => {
  const entries = validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries: [
      entry({ appId: "audio", title: "Áudio" }),
      entry({ appId: "acoes", title: "Ações" }),
    ],
    reason: null,
    authority: "none",
  }).entries;
  assert.deepEqual(filterStoreEntries(entries, "discover", "audio").map((value) => value.appId), ["audio"]);
  assert.deepEqual(filterStoreEntries(entries, "discover", "AÇOES").map((value) => value.appId), ["acoes"]);
  assert.deepEqual(filterStoreEntries(entries, "updates", "audio"), []);
});

test("Store lifecycle controls confirm removal and survive synchronous as well as async delegate failures", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /removalConfirmationAppId = appId/);
  assert.match(source, /operation === "remove" && removalConfirmationAppId !== appId/);
  assert.match(source, /storeConfirmRemove/);
  assert.match(source, /storeCancelRemove/);
  // The delegate may only run while its request still belongs to the
  // exact signed catalog generation and the currently pending request.
  assert.match(source, /const isCurrentRequest = \(\) => !destroyed/);
  assert.match(source, /catalogGeneration === requestGeneration/);
  assert.match(source, /pendingRequest\?\.requestId === request\.requestId/);
  assert.match(source, /Promise\.resolve\(\)\s*\.then\(\(\) => \{\s*if \(!isCurrentRequest\(\)\) return null;\s*return lifecycleRequests\.requestLifecycle\(request\);/);
  assert.match(source, /\.catch\(\(\) => \{\s*if \(!isCurrentRequest\(\)\) return;\s*pendingRequest = null;/);
  assert.match(source, /restoreSearchFocus/);
  assert.match(source, /root\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(source, /root\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(source, /candidate\.dataset\.storeDetails === previousAppId/);
  assert.doesNotMatch(source, /Promise\.resolve\(lifecycleRequests\.requestLifecycle/);
});


test("Store request identifiers never fall back to a collision-prone clock token", () => {
  assert.equal(createStoreRequestSessionId(null), null);
  assert.equal(createStoreRequestSessionId({}), null);
  assert.equal(createStoreRequestSessionId({ randomUUID() { return "not-a-uuid"; } }), null);
  const uuid = createStoreRequestSessionId({
    randomUUID() { return "550e8400-e29b-41d4-a716-446655440000"; },
  });
  assert.equal(uuid, "550e8400e29b41d4a716446655440000");
  const fallback = createStoreRequestSessionId({
    getRandomValues(value) {
      value.fill(0xab);
      return value;
    },
  });
  assert.equal(fallback, "ab".repeat(16));
  assert.equal(createStoreRequestSessionId({
    getRandomValues() { throw new Error("entropy-unavailable"); },
  }), null);
});

test("Store list sorting is deterministic, localized and does not mutate canonical inventory", () => {
  const records = [
    { title: "Notas 10", appId: "notes10" },
    { title: "Áudio", appId: "audio" },
    { title: "Notas 2", appId: "notes2" },
  ];
  const sorted = sortStoreEntries(records, "pt-BR");
  assert.deepEqual(sorted.map((item) => item.appId), ["audio", "notes2", "notes10"]);
  assert.deepEqual(records.map((item) => item.appId), ["notes10", "audio", "notes2"]);
});

test("Store presents validated platform rejection reason but cannot mint authority", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url), "utf8",
  );
  const locales = await readFile(
    new URL("../system/services/i18n/catalog/store.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /result\.state === "rejected" \? result\.reason : null/);
  assert.match(source, /t\("store.request.reason", \{ reason: requestReason \}\)/);
  assert.match(source, /requestSessionId === null/);
  assert.match(source, /sortStoreEntries\(snapshot\.entries, localization\.getLocale\(\)\)/);
  assert.equal(locales.split('"store.request.reason"').length, 3);
  assert.doesNotMatch(source, /Date\.now\(\)/);
  assert.doesNotMatch(source, /innerHTML/);
});


test("Store never reactivates a stale lifecycle request after catalog replacement or teardown", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/store-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /let catalogFingerprint = JSON\.stringify\(snapshot\)/);
  assert.match(source, /let catalogGeneration = 0;/);
  assert.match(source, /fingerprint !== catalogFingerprint/);
  assert.match(source, /catalogGeneration \+= 1;\s*pendingRequest = null;/);
  assert.match(source, /const isCurrentRequest = \(\) => !destroyed/);
  assert.match(source, /catalogGeneration === requestGeneration/);
  assert.match(source, /pendingRequest\?\.requestId === request\.requestId/);
  assert.match(source, /if \(!isCurrentRequest\(\)\) return null;/);
  assert.match(source, /if \(!isCurrentRequest\(\)\) return;/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|new Map\(\)/);
});

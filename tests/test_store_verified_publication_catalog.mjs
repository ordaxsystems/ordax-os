import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA,
  VERIFIED_APP_PUBLICATION_SCHEMA,
  assertVerifiedAppPublicationCatalogPort,
  validateVerifiedAppPublicationCatalogSnapshot,
} from "../system/contracts/verified-app-publication-catalog.mjs";
import {
  projectVerifiedAppPublicationsToStoreCatalog,
} from "../system/services/apps/store-catalog.mjs";

function publication(overrides = {}) {
  return {
    schema: VERIFIED_APP_PUBLICATION_SCHEMA,
    appId: "notes",
    componentId: "notes",
    title: "Notas",
    version: "0.4.3",
    sourceRepository: "washingtonmsdj/ordax-apps",
    sourceCommit: "a".repeat(40),
    packageSha256: "b".repeat(64),
    releaseSha256: "c".repeat(64),
    envelopeSha256: "d".repeat(64),
    trustDomain: "runtime-components",
    keyId: "ordax-runtime-components-v1",
    compatibilityState: "compatible",
    compatibilityReason: null,
    publishedAt: 1,
    authority: "none",
    ...overrides,
  };
}

function ready(entries = [publication()]) {
  return {
    schema: VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA,
    state: "ready",
    entries,
    reason: null,
    authority: "none",
  };
}

test("verified Notes publication projects as installable Store entry without authority", () => {
  const projected = projectVerifiedAppPublicationsToStoreCatalog(ready());
  assert.equal(projected.state, "ready");
  assert.equal(projected.authority, "none");
  assert.deepEqual(projected.entries, [{
    appId: "notes",
    title: "Notas",
    version: "0.4.3",
    state: "available",
    installable: true,
    installed: false,
    blockedReason: null,
    artifactIdentityVerified: true,
    provenanceVerified: true,
  }]);
});

test("compatibility failure blocks Store installation before request", () => {
  const projected = projectVerifiedAppPublicationsToStoreCatalog(
    ready([publication({
      compatibilityState: "blocked",
      compatibilityReason: "host-contract-incompatible",
    })]),
  );
  assert.equal(projected.entries[0].state, "blocked");
  assert.equal(projected.entries[0].installable, false);
  assert.equal(projected.entries[0].blockedReason, "host-contract-incompatible");
});

test("active delivery transition comes only from platform observation", () => {
  const projected = projectVerifiedAppPublicationsToStoreCatalog(
    ready(),
    {
      observations: {
        notes: {
          installed: false,
          catalogued: true,
          transition: "installing",
          blockedReason: null,
          failedRetained: false,
        },
      },
    },
  );
  assert.equal(projected.entries[0].state, "installing");
  assert.equal(projected.entries[0].installable, false);
});

test("failed update retains installed app presentation", () => {
  const projected = projectVerifiedAppPublicationsToStoreCatalog(
    ready(),
    {
      observations: {
        notes: {
          installed: true,
          catalogued: true,
          transition: "idle",
          blockedReason: null,
          failedRetained: true,
        },
      },
    },
  );
  assert.equal(projected.entries[0].state, "failed-retained");
  assert.equal(projected.entries[0].installed, true);
  assert.equal(projected.entries[0].installable, false);
});

test("unknown and structural publications fail closed", () => {
  assert.throws(
    () => projectVerifiedAppPublicationsToStoreCatalog(
      ready([publication({ appId: "unknown-app", componentId: "unknown-app" })]),
    ),
    /unknown first-party app/,
  );
  assert.throws(
    () => projectVerifiedAppPublicationsToStoreCatalog(
      ready([publication({ appId: "store", componentId: "store", title: "Loja", version: "0.1.0" })]),
    ),
    /Structural app cannot be projected/,
  );
});

test("verified publication identity and compatibility evidence are strict", () => {
  assert.throws(
    () => validateVerifiedAppPublicationCatalogSnapshot(
      ready([publication({ componentId: "studio" })]),
    ),
    /component identity must match app identity/,
  );
  assert.throws(
    () => validateVerifiedAppPublicationCatalogSnapshot(
      ready([publication({ trustDomain: "whole-os-release" })]),
    ),
    /runtime-components trust/,
  );
  assert.throws(
    () => validateVerifiedAppPublicationCatalogSnapshot(
      ready([publication({ compatibilityState: "blocked", compatibilityReason: null })]),
    ),
    /requires a compatibility reason/,
  );
});

test("verified publication port is read-only and rejects lifecycle authority", () => {
  const snapshot = validateVerifiedAppPublicationCatalogSnapshot(ready());
  const safe = {
    schema: VERIFIED_APP_PUBLICATION_CATALOG_SCHEMA,
    authority: "none",
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  };
  assert.equal(assertVerifiedAppPublicationCatalogPort(safe), safe);

  assert.throws(
    () => assertVerifiedAppPublicationCatalogPort({ ...safe, install() {} }),
    /must not expose authority method install/,
  );
  assert.throws(
    () => assertVerifiedAppPublicationCatalogPort({ ...safe, publish() {} }),
    /must not expose authority method publish/,
  );
  assert.throws(
    () => assertVerifiedAppPublicationCatalogPort({ ...safe, promote() {} }),
    /must not expose authority method promote/,
  );
});

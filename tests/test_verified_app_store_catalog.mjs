import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_CATALOG_KEY_ID,
  APP_STORE_CATALOG_SOURCE_REPOSITORY,
  APP_STORE_CATALOG_TRUST_DOMAIN,
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../system/contracts/verified-app-store-catalog.mjs";

function artifact(name, char = "a") {
  return { name, sha256: char.repeat(64), size: 1234 };
}

function entry(overrides = {}) {
  return {
    appId: "notes",
    title: "Notas",
    version: "0.4.3",
    releaseMode: "component-slot",
    sourceCommit: "b".repeat(40),
    artifacts: {
      package: artifact("notes.zip", "c"),
      release: artifact("notes.release.json", "d"),
      compatibility: artifact("notes.compatibility.json", "e"),
      componentEnvelope: artifact("notes.runtime-component-envelope.json", "6"),
    },
    ...overrides,
  };
}

function ready(overrides = {}) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    sequence: 7,
    catalogSha256: "f".repeat(64),
    source: {
      repository: APP_STORE_CATALOG_SOURCE_REPOSITORY,
      commit: "b".repeat(40),
    },
    trust: {
      domain: APP_STORE_CATALOG_TRUST_DOMAIN,
      keyId: APP_STORE_CATALOG_KEY_ID,
    },
    entries: [entry()],
    reason: null,
    authority: "none",
    ...overrides,
  };
}

function unavailable(overrides = {}) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: [],
    reason: "catalog-not-verified",
    authority: "none",
    ...overrides,
  };
}

test("verified Store catalog accepts exact canonical source, trust and artifact identities", () => {
  const snapshot = validateVerifiedAppStoreCatalogSnapshot(ready());
  assert.equal(snapshot.sequence, 7);
  assert.equal(snapshot.catalogSha256, "f".repeat(64));
  assert.equal(snapshot.source.repository, "ordaxsystems/ordax-apps");
  assert.equal(snapshot.trust.domain, "runtime-components");
  assert.equal(snapshot.trust.keyId, "ordax-runtime-components-v1");
  assert.equal(snapshot.entries[0].appId, "notes");
  assert.equal(snapshot.entries[0].artifacts.package.sha256, "c".repeat(64));
  assert.equal(
    snapshot.entries[0].artifacts.componentEnvelope.sha256,
    "6".repeat(64),
  );
  assert.equal(snapshot.authority, "none");
});

test("verified Store catalog rejects non-canonical source, trust and mixed source commits", () => {
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      source: { repository: "example/apps", commit: "b".repeat(40) },
    })),
    /source repository is not canonical/,
  );
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      trust: { domain: "other", keyId: APP_STORE_CATALOG_KEY_ID },
    })),
    /trust identity is not canonical/,
  );
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      entries: [entry({ sourceCommit: "9".repeat(40) })],
    })),
    /source commit mismatch/,
  );
});

test("verified Store catalog requires monotonic publication identity fields", () => {
  for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => validateVerifiedAppStoreCatalogSnapshot(ready({ sequence })),
      /sequence must be a positive safe integer/,
    );
  }
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({ catalogSha256: "F".repeat(64) })),
    /must be lowercase SHA-256/,
  );
});

test("verified Store catalog rejects missing or non-canonical component envelope identity", () => {
  const missing = entry();
  delete missing.artifacts.componentEnvelope;
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({ entries: [missing] })),
    /artifacts fields are not canonical/,
  );

  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      entries: [entry({
        artifacts: {
          ...entry().artifacts,
          componentEnvelope: artifact("other-envelope.json", "6"),
        },
      })],
    })),
    /component envelope name is not canonical/,
  );
});

test("verified Store catalog rejects duplicate ids and non component-slot entries", () => {
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      entries: [entry(), entry()],
    })),
    /duplicated/,
  );
  assert.throws(
    () => validateVerifiedAppStoreCatalogSnapshot(ready({
      entries: [entry({ releaseMode: "bundled" })],
    })),
    /must use component-slot/,
  );
});

test("unavailable catalog cannot smuggle trusted identity or entries", () => {
  const snapshot = validateVerifiedAppStoreCatalogSnapshot(unavailable());
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.sequence, null);
  assert.deepEqual(snapshot.entries, []);

  for (const override of [
    { sequence: 7 },
    { catalogSha256: "a".repeat(64) },
    { source: ready().source },
    { trust: ready().trust },
    { entries: [entry()] },
  ]) {
    assert.throws(
      () => validateVerifiedAppStoreCatalogSnapshot(unavailable(override)),
      /cannot carry trusted catalog identity/,
    );
  }
});

test("verified catalog port is read-only and cannot expose lifecycle authority", () => {
  const snapshot = ready();
  const port = {
    schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() { return snapshot; },
    subscribe() { return () => {}; },
  };
  assert.strictEqual(assertVerifiedAppStoreCatalogPort(port), port);
  for (const method of ["install", "update", "remove", "promote", "rollback", "execute"]) {
    assert.throws(
      () => assertVerifiedAppStoreCatalogPort({ ...port, [method]() {} }),
      new RegExp(`must not expose ${method}`),
    );
  }
});

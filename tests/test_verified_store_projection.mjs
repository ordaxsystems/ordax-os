import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/verified-app-store-catalog.mjs";
import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
} from "../system/contracts/verified-component-package-source.mjs";
import {
  createVerifiedAppStoreProjection,
} from "../system/services/apps/verified-store-projection.mjs";

const SOURCE_COMMIT = "b".repeat(40);

function artifact(name, char) {
  return { name, sha256: char.repeat(64), size: 123 };
}

function candidate(appId = "notes", version = "0.4.3", title = "Notas") {
  return {
    appId,
    title,
    version,
    releaseMode: "component-slot",
    sourceCommit: SOURCE_COMMIT,
    artifacts: {
      package: artifact(`${appId}.zip`, "c"),
      release: artifact(`${appId}.release.json`, "d"),
      compatibility: artifact(`${appId}.compatibility.json`, "e"),
      componentEnvelope: artifact(`${appId}.runtime-component-envelope.json`, "6"),
    },
  };
}

function ready(entries = [candidate()]) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    sequence: 11,
    catalogSha256: "f".repeat(64),
    source: {
      repository: "ordaxsystems/ordax-apps",
      commit: SOURCE_COMMIT,
    },
    trust: {
      domain: "runtime-components",
      keyId: "ordax-runtime-components-v1",
    },
    entries,
    reason: null,
    authority: "none",
  };
}

function catalogPort(initial) {
  let current = initial;
  const listeners = new Set();
  return {
    port: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
      authority: "none",
      getSnapshot() { return current; },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    publish(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
  };
}

function source() {
  return Object.freeze({
    schema: VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
    metadataUrl(appId, state) {
      return `https://store.test/component-runtime?component=${appId}&state=${state}`;
    },
    fileUrl() {
      throw new Error("Store projection must not read package files");
    },
  });
}

function metadata(appId, {
  source: stateSource = "absent",
  version = null,
  sourceCommit = null,
  revision = 4,
} = {}) {
  return {
    componentId: appId,
    state: "current",
    source: stateSource,
    revision,
    version,
    sourceCommit,
    entrypoint: stateSource === "slot" ? `system/apps/${appId}/src/runtime.mjs` : null,
    pendingHealth: null,
  };
}

function fetchFrom(values, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const appId = new URL(url).searchParams.get("component");
    const value = values[appId];
    if (value instanceof Error) throw value;
    return {
      ok: value !== undefined,
      status: value === undefined ? 404 : 200,
      async json() { return value; },
    };
  };
}

test("verified Store projection offers install only from verified catalog plus explicit absent activation", async () => {
  const catalog = catalogPort(ready());
  const calls = [];
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes"),
      studio: metadata("studio"),
    }, calls),
  });
  await projection.refresh();

  const snapshot = projection.port.getSnapshot();
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].appId, "notes");
  assert.equal(snapshot.entries[0].state, "available");
  assert.equal(snapshot.entries[0].installable, true);
  assert.equal(snapshot.entries[0].availableVersion, "0.4.3");
  assert.equal(snapshot.entries[0].artifactIdentityVerified, true);
  assert.equal(snapshot.entries[0].provenanceVerified, true);
  assert.equal(calls.length >= 2, true);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
  }
  projection.destroy();
});

test("known optional utility is represented from verified catalog only; raw unknown stays blocked", async () => {
  const catalog = catalogPort(ready([
    candidate("calculator", "0.2.0", "Calculadora"),
    candidate("unapproved-product", "0.1.0", "Unapproved"),
  ]));
  const requests = [];
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      calculator: metadata("calculator"),
    }, requests),
  });
  await projection.refresh();
  const snapshot = projection.port.getSnapshot();
  assert.equal(snapshot.state, "ready");
  const calculator = snapshot.entries.find(item => item.appId === "calculator");
  assert.equal(calculator.state, "blocked");
  assert.equal(calculator.installable, false);
  assert.equal(calculator.updatable, false);
  assert.equal(calculator.blockedReason, "runtime-module-read-unavailable");
  assert.equal(calculator.artifactIdentityVerified, true);
  assert.equal(calculator.provenanceVerified, true);
  assert.ok(requests.some(row => row.url.includes("component=calculator")));
  const unknown = snapshot.entries.find(item => item.appId === "unapproved-product");
  assert.equal(unknown.state, "blocked");
  assert.equal(unknown.blockedReason, "first-party-delivery-policy-unavailable");
  assert.equal(unknown.installable, false);
  projection.destroy();
});

test("exact active slot is installed and a newer verified catalog candidate is updatable", async () => {
  for (const [currentVersion, currentCommit, expected] of [
    ["0.4.3", SOURCE_COMMIT, { updatable: false, availableVersion: null }],
    ["0.4.2", "a".repeat(40), { updatable: true, availableVersion: "0.4.3" }],
  ]) {
    const catalog = catalogPort(ready());
    const projection = createVerifiedAppStoreProjection({
      verifiedCatalogPort: catalog.port,
      componentSource: source(),
      fetchImpl: fetchFrom({
        notes: metadata("notes", {
          source: "slot",
          version: currentVersion,
          sourceCommit: currentCommit,
        }),
        studio: metadata("studio"),
      }),
    });
    await projection.refresh();
    const entry = projection.port.getSnapshot().entries.find((item) => item.appId === "notes");
    assert.equal(entry.state, "installed");
    assert.equal(entry.installedVersion, currentVersion);
    assert.equal(entry.updatable, expected.updatable);
    assert.equal(entry.availableVersion, expected.availableVersion);
    assert.equal(entry.removable, true);
    projection.destroy();
  }
});

test("installed external app remains removable even after it disappears from catalog", async () => {
  const catalog = catalogPort(ready([
    candidate("studio", "0.5.4", "ORDAX Studio"),
  ]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes", {
        source: "slot",
        version: "0.4.3",
        sourceCommit: SOURCE_COMMIT,
      }),
      studio: metadata("studio"),
    }),
  });
  await projection.refresh();

  const notes = projection.port.getSnapshot().entries.find((entry) => entry.appId === "notes");
  assert.equal(notes.title, "notes");
  assert.equal(notes.state, "installed");
  assert.equal(notes.installedVersion, "0.4.3");
  assert.equal(notes.availableVersion, null);
  assert.equal(notes.removable, true);
  assert.equal(notes.artifactIdentityVerified, false);
  projection.destroy();
});

test("catalog drift, bundled source and unavailable activation fail closed without minting lifecycle authority", async () => {
  for (const [current, expectedReason] of [
    [
      metadata("notes", {
        source: "slot",
        version: "0.4.3",
        sourceCommit: "9".repeat(40),
      }),
      "installed-catalog-identity-drift",
    ],
    [metadata("notes", { source: "bundled" }), "component-slot-bundled-source-conflict"],
    [new Error("native unavailable"), "activation-state-unavailable"],
  ]) {
    const catalog = catalogPort(ready());
    const projection = createVerifiedAppStoreProjection({
      verifiedCatalogPort: catalog.port,
      componentSource: source(),
      fetchImpl: fetchFrom({
        notes: current,
        studio: metadata("studio"),
      }),
    });
    await projection.refresh();
    const entry = projection.port.getSnapshot().entries.find((item) => item.appId === "notes");
    assert.equal(entry.state, "blocked");
    assert.equal(entry.blockedReason, expectedReason);
    assert.equal(entry.installable, false);
    assert.equal(entry.updatable, false);
    projection.destroy();
  }
});

test("unknown first-party policy is visible only as blocked verified catalog metadata", async () => {
  const catalog = catalogPort(ready([
    candidate("future-app", "0.1.0", "Future App"),
  ]));
  const calls = [];
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes"),
      studio: metadata("studio"),
    }, calls),
  });
  await projection.refresh();
  const entry = projection.port.getSnapshot().entries.find((item) => item.appId === "future-app");
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "first-party-delivery-policy-unavailable");
  assert.equal(calls.some((call) => call.url.includes("future-app")), false);
  projection.destroy();
});

test("verified catalog unavailability propagates fail closed and live refresh cannot expose old entries", async () => {
  const catalog = catalogPort(ready());
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes"),
      studio: metadata("studio"),
    }),
  });
  await projection.refresh();
  assert.equal(projection.port.getSnapshot().state, "ready");

  catalog.publish({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: [],
    reason: "catalog-watermark-unavailable",
    authority: "none",
  });
  await projection.refresh();
  assert.equal(projection.port.getSnapshot().state, "unavailable");
  assert.deepEqual(projection.port.getSnapshot().entries, []);
  projection.destroy();
});


test("candidate with no Native module-read support cannot appear updatable but installed slot stays removable", async () => {
  const catalog = catalogPort(ready([
    candidate("calculator", "0.4.3", "Calculadora"),
  ]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      calculator: metadata("calculator", {
        source: "slot",
        version: "0.4.2",
        sourceCommit: "a".repeat(40),
      }),
    }),
  });
  await projection.refresh();
  const entry = projection.port.getSnapshot().entries.find((item) => item.appId === "calculator");
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "runtime-module-read-unavailable");
  assert.equal(entry.installedVersion, "0.4.2");
  assert.equal(entry.availableVersion, "0.4.3");
  assert.equal(entry.artifactIdentityVerified, true);
  assert.equal(entry.provenanceVerified, true);
  assert.equal(entry.updatable, false);
  assert.equal(entry.installable, false);
  assert.equal(entry.removable, true);
  projection.destroy();
});

test("Native module-read capability remains a necessary condition, not trust or install authority", async () => {
  const catalog = catalogPort(ready([
    candidate("notes", "0.4.3", "Notas"),
    candidate("calculator", "0.2.0", "Calculadora"),
  ]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes"),
      calculator: metadata("calculator"),
      studio: metadata("studio"),
    }),
  });
  await projection.refresh();
  const entries = projection.port.getSnapshot().entries;
  assert.equal(entries.find((item) => item.appId === "notes").installable, true);
  assert.equal(entries.find((item) => item.appId === "calculator").installable, false);
  assert.equal(projection.port.authority, "none");
  assert.equal(typeof projection.port.requestLifecycle, "undefined");
  projection.destroy();
});

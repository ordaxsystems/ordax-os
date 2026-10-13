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

test("calculator module read is ready while unsupported Native probation keeps Store installs blocked", async () => {
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
  assert.equal(calculator.blockedReason, "runtime-probation-unavailable");
  assert.equal(calculator.installable, false);
  assert.equal(calculator.updatable, false);
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

test("explicitly removed component is absent but permits only deliberate verified Store reinstall", async () => {
  const catalog = catalogPort(ready([candidate("notes", "0.4.3", "Notas")]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      notes: metadata("notes", { source: "removed", revision: 9 }),
      studio: metadata("studio"),
    }),
  });
  await projection.refresh();
  const notes = projection.port.getSnapshot().entries.find(item => item.appId === "notes");
  assert.equal(notes.state, "available");
  assert.equal(notes.installedVersion, null);
  assert.equal(notes.installable, true);
  assert.equal(notes.removable, false);
  assert.equal(notes.artifactIdentityVerified, true);
  assert.equal(notes.provenanceVerified, true);
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


test("Native status reads use bounded concurrency and deterministic catalog order", async () => {
  const catalog = catalogPort(ready([
    candidate("notes", "0.4.3", "Notas"),
    candidate("calculator", "0.2.0", "Calculadora"),
  ]));
  let active = 0, peak = 0;
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: async (url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return metadata(new URL(url).searchParams.get("component"));
        },
      };
    },
  });
  const snapshot = await new Promise((resolve) => {
    projection.port.subscribe((next) => {
      if (next.state === "ready") resolve(next);
    });
  });
  assert.equal(active, 0);
  assert.ok(peak > 1 && peak <= 4, "Native queries must have a bounded fan-out");
  assert.deepEqual(snapshot.entries.map((entry) => entry.appId), ["calculator", "notes"]);
  assert.equal(snapshot.entries.find((entry) => entry.appId === "notes").installable, true);
  const calculator = snapshot.entries.find((entry) => entry.appId === "calculator");
  assert.equal(calculator.installable, false);
  assert.equal(calculator.blockedReason, "runtime-probation-unavailable");
  projection.destroy();
});

test("one unresponsive current-state lookup is blocked without stalling other verified apps", async () => {
  const catalog = catalogPort(ready([
    candidate("calculator", "0.2.0", "Calculadora"),
    candidate("notes", "0.4.3", "Notas"),
  ]));
  let slowSignal = null, resolveSlow;
  const slow = new Promise((resolve) => { resolveSlow = resolve; });
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    metadataTimeoutMs: 15,
    fetchImpl: (url, options) => {
      const appId = new URL(url).searchParams.get("component");
      if (appId === "calculator") {
        slowSignal = options.signal;
        return slow; // Intentionally ignores AbortSignal to exercise the deadline.
      }
      return Promise.resolve({
        ok: true, status: 200,
        async json() { return metadata(appId); },
      });
    },
  });
  const snapshot = await new Promise((resolve) => {
    projection.port.subscribe((next) => {
      if (next.state === "ready") resolve(next);
    });
  });
  assert.equal(slowSignal.aborted, true);
  assert.equal(snapshot.entries.find((entry) => entry.appId === "notes").state, "available");
  const calculator = snapshot.entries.find((entry) => entry.appId === "calculator");
  assert.equal(calculator.state, "blocked");
  assert.equal(calculator.blockedReason, "activation-state-unavailable");
  assert.equal(calculator.installable, false);
  resolveSlow({
    ok: true, status: 200,
    async json() { return metadata("calculator"); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(projection.port.getSnapshot(), snapshot);
  projection.destroy();
});

test("new signed catalog cancels stale Native reads and cannot display old candidates", async () => {
  const catalog = catalogPort(ready([
    candidate("notes", "0.4.3", "Notas"),
    candidate("calculator", "0.2.0", "Calculadora"),
  ]));
  let phase = "old", firstSignal = null, resolveOld;
  const old = new Promise((resolve) => { resolveOld = resolve; });
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: (url, options) => {
      const appId = new URL(url).searchParams.get("component");
      if (appId === "calculator" && phase === "old") {
        firstSignal = options.signal;
        return old;
      }
      return Promise.resolve({
        ok: true, status: 200,
        async json() { return metadata(appId); },
      });
    },
  });
  assert.ok(firstSignal !== null, "first catalog must start Native read");
  phase = "new";
  const updated = new Promise((resolve) => {
    projection.port.subscribe((next) => {
      if (next.state === "ready") resolve(next);
    });
  });
  catalog.publish(ready([candidate("notes", "0.4.3", "Notas")]));
  const snapshot = await updated;
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(snapshot.entries.map((entry) => entry.appId), ["notes"]);
  resolveOld({
    ok: true, status: 200,
    async json() {
      return metadata("calculator", {
        source: "slot", version: "0.2.0", sourceCommit: SOURCE_COMMIT,
      });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(projection.port.getSnapshot(), snapshot);
  projection.destroy();
});

test("destroy aborts outstanding Native queries and invalid timeouts fail closed", async () => {
  const catalog = catalogPort(ready([candidate("calculator", "0.2.0")]));
  for (const invalid of [0, -1, Number.POSITIVE_INFINITY, "3000", 30_001]) {
    assert.throws(() => createVerifiedAppStoreProjection({
      verifiedCatalogPort: catalog.port,
      componentSource: source(),
      metadataTimeoutMs: invalid,
      fetchImpl: fetchFrom({calculator: metadata("calculator")}),
    }), /bounded positive integer/);
  }
  let signal;
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: (url, options) => {
      if (new URL(url).searchParams.get("component") === "calculator") {
        signal = options.signal;
      }
      return new Promise(() => {}); // A non-cooperative Native adapter.
    },
  });
  assert.ok(signal);
  projection.destroy();
  assert.equal(signal.aborted, true);
  assert.equal(projection.port.getSnapshot().state, "unavailable");
});


test("Native probation gate blocks upgrades without blocking verified uninstall", async () => {
  const catalog = catalogPort(ready([candidate("calculator", "0.4.3", "Calculadora")]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      calculator: metadata("calculator", {
        source: "slot", version: "0.4.2", sourceCommit: "a".repeat(40),
      }),
    }),
  });
  await projection.refresh();
  const value = projection.port.getSnapshot().entries.find((item) => item.appId === "calculator");
  assert.equal(value.state, "blocked");
  assert.equal(value.blockedReason, "runtime-probation-unavailable");
  assert.equal(value.installedVersion, "0.4.2");
  assert.equal(value.availableVersion, "0.4.3");
  assert.equal(value.updatable, false);
  assert.equal(value.installable, false);
  assert.equal(value.removable, true);
  projection.destroy();
});

test("new signed catalog immediately clears stale Store actions while Native refresh is slow", async () => {
  const catalog = catalogPort(ready([candidate("notes", "0.4.3", "Notas")]));
  let pauseReads = false;
  let resume;
  const delayed = new Promise((resolve) => { resume = resolve; });
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: async (url) => {
      if (pauseReads) await delayed;
      return {
        ok: true, status: 200,
        async json() { return metadata(new URL(url).searchParams.get("component")); },
      };
    },
  });
  await projection.refresh();
  assert.equal(projection.port.getSnapshot().state, "ready");
  assert.equal(projection.port.getSnapshot().entries[0].installable, true);

  pauseReads = true;
  const newest = new Promise((resolve) => {
    projection.port.subscribe((next) => {
      if (next.state === "ready") resolve(next);
    });
  });
  catalog.publish(ready([candidate("notes", "0.4.4", "Notas")]));
  const suspended = projection.port.getSnapshot();
  assert.equal(suspended.state, "unavailable");
  assert.equal(suspended.reason, "verified-store-projection-refreshing");
  assert.deepEqual(suspended.entries, []);
  assert.equal(suspended.authority, "none");

  resume();
  const fresh = await newest;
  assert.equal(fresh.entries[0].availableVersion, "0.4.4");
  assert.equal(fresh.entries[0].installable, true);
  projection.destroy();
});

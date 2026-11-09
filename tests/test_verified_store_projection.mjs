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

test("Windows Store refuses new installs and updates without a trusted probation host while keeping CURRENT removal", async () => {
  const catalog = catalogPort(ready());
  let current = metadata("notes");
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: async url => {
      const appId = new URL(url).searchParams.get("component");
      return {
        ok: true, status: 200,
        json: async () => appId === "notes" ? current : metadata(appId),
      };
    },
    probationHostReady: false,
  });
  const read = async () => {
    await projection.refresh();
    return projection.port.getSnapshot().entries.find(x => x.appId === "notes");
  };
  let entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "runtime-probation-host-unavailable");
  assert.equal(entry.installable, false);
  assert.equal(entry.installedVersion, null);

  current = metadata("notes", {
    source: "slot", version: "0.4.2", sourceCommit: "a".repeat(40),
    revision: 5,
  });
  entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "runtime-probation-host-unavailable");
  assert.equal(entry.updatable, false);
  assert.equal(entry.removable, true,
    "A previously verified CURRENT installation remains explicitly removable");

  current = metadata("notes", {
    source: "slot", version: "0.4.3", sourceCommit: SOURCE_COMMIT,
    revision: 6,
  });
  entry = await read();
  assert.equal(entry.state, "installed");
  assert.equal(entry.removable, true);
  assert.equal(entry.updatable, false);
  projection.destroy();
});

test("Windows Store observes Go pending-health without falsely enabling a second install", async () => {
  const catalog = catalogPort(ready());
  let pending = null;
  let nativeCurrent = metadata("notes", {revision: 5});
  let pendingUnavailable = false;
  let requests = 0;
  const fetchImpl = async url => {
    requests++;
    const query = new URL(url).searchParams;
    if (query.get("component") !== "notes") {
      return {ok: true, status: 200, json: async () =>
        metadata(query.get("component"))};
    }
    if (query.get("state") === "current")
      return {ok: true, status: 200, json: async () => nativeCurrent};
    if (pendingUnavailable) return {ok: false, status: 503};
    return pending === null
      ? {ok: true, status: 204}
      : {ok: true, status: 200, json: async () => pending};
  };
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(), fetchImpl, observePending: true,
  });
  const read = async () => {
    await projection.refresh();
    return projection.port.getSnapshot().entries.find(x => x.appId === "notes");
  };
  let entry = await read();
  assert.equal(entry.state, "available");
  assert.equal(entry.installable, true);

  pending = {
    componentId: "notes", state: "pending", source: "slot",
    revision: 5, version: "0.4.3", sourceCommit: SOURCE_COMMIT,
    entrypoint: "system/apps/notes/src/runtime.mjs",
    pendingHealth: "unknown",
  };
  entry = await read();
  assert.equal(entry.state, "staged");
  assert.equal(entry.installable, false);
  assert.equal(entry.updatable, false);
  assert.equal(entry.removable, false);
  assert.equal(entry.installedVersion, null);
  assert.equal(entry.availableVersion, "0.4.3");
  assert.equal(entry.blockedReason, null);

  pending = {...pending, pendingHealth: "healthy"};
  entry = await read();
  assert.equal(entry.state, "staged", "Healthy pending is not yet promoted CURRENT");

  pending = {...pending, pendingHealth: "failed"};
  entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "pending-slot-health-failed");
  assert.equal(entry.installable, false);

  pending = {...pending, pendingHealth: "unknown", sourceCommit: "c".repeat(40)};
  entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "pending-slot-identity-drift");

  pending = {...pending, sourceCommit: SOURCE_COMMIT, revision: 6};
  entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "pending-slot-identity-drift",
    "An unpaired CURRENT and pending revision must fail closed");

  pendingUnavailable = true;
  entry = await read();
  assert.equal(entry.state, "blocked");
  assert.equal(entry.blockedReason, "pending-activation-state-unavailable");

  pendingUnavailable = false; pending = null;
  nativeCurrent = metadata("notes", {
    source: "slot", version: "0.4.3",
    sourceCommit: SOURCE_COMMIT, revision: 7,
  });
  entry = await read();
  assert.equal(entry.state, "installed");
  assert.equal(entry.updatable, false);
  assert.equal(entry.availableVersion, null);
  assert.equal(entry.installedVersion, "0.4.3");
  assert.ok(requests > 10, "Every staged state is re-read from the Go-backed endpoint");
  projection.destroy();
});

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

test("calculator signed module read and probation permit only verified Store proposal", async () => {
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
  assert.equal(calculator.state, "available");
  assert.equal(calculator.blockedReason, null);
  assert.equal(calculator.installable, true);
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

test("Aura derives its displayed title from verified catalog but cannot install without probation", async () => {
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalogPort(ready([
      candidate("assistant", "0.1.2", "Aura"),
    ])).port,
    componentSource: source(),
    fetchImpl: fetchFrom({ assistant: metadata("assistant") }),
  });
  await projection.refresh();
  const snapshot = projection.port.getSnapshot();
  assert.equal(snapshot.state, "ready");
  const aura = snapshot.entries.find(item => item.appId === "assistant");
  assert.ok(aura);
  assert.equal(aura.title, "Aura");
  assert.equal(aura.state, "blocked");
  assert.equal(aura.blockedReason, "runtime-probation-unavailable");
  assert.equal(aura.installable, false);
  assert.equal(aura.updatable, false);
  assert.equal(aura.artifactIdentityVerified, true);
  assert.equal(aura.provenanceVerified, true);
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
  assert.equal(calculator.installable, true);
  assert.equal(calculator.blockedReason, null);
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
  const catalog = catalogPort(ready([candidate("assistant", "0.4.3", "Aura")]));
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({
      assistant: metadata("assistant", {
        source: "slot", version: "0.4.2", sourceCommit: "a".repeat(40),
      }),
    }),
  });
  await projection.refresh();
  const value = projection.port.getSnapshot().entries.find((item) => item.appId === "assistant");
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

test("disposing a ready Store projection revokes installable candidates for all retained readers", async () => {
  const catalog = catalogPort(ready());
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({ notes: metadata("notes") }),
  });
  await projection.refresh();
  assert.equal(projection.port.getSnapshot().state, "ready");
  assert.equal(projection.port.getSnapshot().entries[0].installable, true);
  assert.ok(projection.getCurrentObservations().length > 0);

  const seen = [];
  projection.port.subscribe((snapshot) => seen.push(snapshot.state));
  projection.destroy();
  const closed = projection.port.getSnapshot();
  assert.equal(closed.state, "unavailable");
  assert.equal(closed.reason, "verified-store-projection-disposed");
  assert.deepEqual(closed.entries, []);
  assert.deepEqual(projection.getCurrentObservations(), []);
  assert.deepEqual(seen, ["unavailable"]);

  await projection.refresh();
  assert.equal(projection.port.getSnapshot(), closed);
  assert.deepEqual(seen, ["unavailable"], "a disposed projection never publishes another candidate");
});

test("one failing Store subscriber cannot suppress CURRENT revocation or notify the next reader", async t => {
  const catalog = catalogPort(ready());
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({ notes: metadata("notes") }),
  });
  t.after(() => projection.destroy());
  await projection.waitForCurrentRefresh();
  assert.equal(projection.port.getSnapshot().state, "ready");
  const delivered = [];
  projection.port.subscribe(() => { throw new Error("broken Store UI subscriber"); });
  projection.port.subscribe(value => delivered.push(value.state));

  await assert.doesNotReject(projection.refresh(),
    "the first subscriber must not prevent Native CURRENT reconciliation");
  assert.deepEqual(delivered, ["unavailable", "ready"],
    "the next subscriber must observe both fail-closed withdrawal and attested restoration");
  assert.equal(projection.port.getSnapshot().state, "ready");
  assert.ok(projection.getCurrentObservations().length > 0);

  projection.destroy();
  assert.equal(delivered.at(-1), "unavailable",
    "even dispose must notify healthy consumers after a subscriber throws");
});

test("reentrant Store refresh never sends a superseded ready snapshot after newer withdrawal", async t => {
  const catalog = catalogPort(ready());
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: catalog.port,
    componentSource: source(),
    fetchImpl: fetchFrom({ notes: metadata("notes") }),
  });
  t.after(() => projection.destroy());
  await projection.waitForCurrentRefresh();
  const delivered = [];
  let nested = null;
  projection.port.subscribe(value => {
    if (value.state === "ready" && nested === null) {
      nested = projection.refresh();
    }
  });
  projection.port.subscribe(value => delivered.push(value.state));
  await projection.refresh();
  assert.ok(nested, "the first Store reader must initiate the one nested reconciliation");
  await nested;
  assert.deepEqual(delivered, ["unavailable", "unavailable", "ready"],
    "the superseded ready emission must not reach later readers after nested withdrawal");
  assert.equal(projection.port.getSnapshot().state, "ready");
});

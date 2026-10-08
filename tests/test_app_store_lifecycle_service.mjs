import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_LIFECYCLE_PLAN_SCHEMA,
  validateAppLifecyclePlan,
} from "../system/contracts/app-lifecycle-plan.mjs";
import {
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
  APP_LIFECYCLE_REQUEST_SCHEMA,
} from "../system/contracts/app-lifecycle-request.mjs";
import {
  APP_STORE_CATALOG_PORT_SCHEMA,
  APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/app-store.mjs";
import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/verified-app-store-catalog.mjs";
import {
  APP_LIFECYCLE_DELEGATE_SCHEMA,
  createAppLifecycleRequestService,
} from "../system/services/apps/store-lifecycle-request-service.mjs";

const COMMIT = "a".repeat(40);

function artifact(name, char) {
  return { name, sha256: char.repeat(64), size: 123 };
}

function request(operation = "install", overrides = {}) {
  return {
    schema: APP_LIFECYCLE_REQUEST_SCHEMA,
    requestId: `store:${operation}:notes:service-test`,
    appId: "notes",
    operation,
    source: "store",
    authority: "none",
    ...overrides,
  };
}

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

function catalogPort(snapshot) {
  return Object.freeze({
    schema: APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  });
}

function ready(value = entry()) {
  return {
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries: [value],
    reason: null,
    authority: "none",
  };
}

function unavailable() {
  return {
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    entries: [],
    reason: "signed-catalog-unavailable",
    authority: "none",
  };
}

function verifiedEntry(overrides = {}) {
  const appId = overrides.appId ?? "notes";
  return {
    appId,
    title: appId === "notes" ? "Notas" : appId,
    version: "0.4.3",
    releaseMode: "component-slot",
    sourceCommit: COMMIT,
    artifacts: {
      package: artifact(`${appId}.zip`, "b"),
      release: artifact(`${appId}.release.json`, "c"),
      compatibility: artifact(`${appId}.compatibility.json`, "d"),
      componentEnvelope: artifact(`${appId}.runtime-component-envelope.json`, "e"),
    },
    ...overrides,
  };
}

function verifiedReady(entries = [verifiedEntry()]) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    sequence: 9,
    catalogSha256: "f".repeat(64),
    source: {
      repository: "ordaxsystems/ordax-apps",
      commit: COMMIT,
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

function verifiedUnavailable() {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: [],
    reason: "catalog-envelope-unavailable",
    authority: "none",
  };
}

function verifiedPort(snapshot) {
  return Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  });
}

function resultFor(value, state = "accepted", reason = null) {
  const identity = value.request ?? value;
  return {
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: identity.requestId,
    appId: identity.appId,
    operation: identity.operation,
    source: identity.source,
    state,
    reason,
    authority: "none",
  };
}

function delegate(executeLifecycle) {
  return Object.freeze({
    schema: APP_LIFECYCLE_DELEGATE_SCHEMA,
    authority: "platform-component-lifecycle",
    executeLifecycle,
  });
}

function service({
  projection = ready(),
  verified = verifiedReady(),
  executeLifecycle = async (plan) => resultFor(plan),
} = {}) {
  return createAppLifecycleRequestService({
    catalogPort: catalogPort(projection),
    verifiedCatalogPort: verifiedPort(verified),
    lifecycleDelegate: delegate(executeLifecycle),
  });
}

test("Store lifecycle service delegates a private plan bound to signed artifact identity", async () => {
  const seen = [];
  const runtime = service({
    executeLifecycle: async (plan) => {
      seen.push(plan);
      return resultFor(plan);
    },
  });

  const value = request();
  const response = await runtime.requestLifecycle(value);
  assert.equal(response.state, "accepted");
  assert.equal(seen.length, 1);

  const plan = validateAppLifecyclePlan(seen[0]);
  assert.equal(plan.schema, APP_LIFECYCLE_PLAN_SCHEMA);
  assert.deepEqual(plan.request, value);
  assert.equal(plan.authority, "none");
  assert.equal(plan.catalogSequence, 9);
  assert.equal(plan.catalogSha256, "f".repeat(64));
  assert.equal(plan.catalogSourceCommit, COMMIT);
  assert.equal(plan.candidate.version, "0.4.3");
  assert.equal(plan.candidate.artifacts.package.sha256, "b".repeat(64));
  assert.equal(
    plan.candidate.artifacts.componentEnvelope.name,
    "notes.runtime-component-envelope.json",
  );
  assert.equal(runtime.authority, "none");
});

test("Store lifecycle service rejects unavailable or divergent verified candidate before privileged delegation", async () => {
  let calls = 0;
  const executeLifecycle = async (plan) => {
    calls += 1;
    return resultFor(plan);
  };

  for (const [projection, verified, expectedReason] of [
    [unavailable(), verifiedReady(), "verified-catalog-unavailable"],
    [ready(entry({ appId: "studio" })), verifiedReady(), "app-not-catalogued"],
    [ready(entry({ installable: false })), verifiedReady(), "lifecycle-operation-not-available"],
    [ready(), verifiedUnavailable(), "verified-catalog-unavailable"],
    [ready(), verifiedReady([verifiedEntry({ appId: "studio", title: "ORDAX Studio" })]), "verified-candidate-projection-mismatch"],
    [
      ready(entry({ availableVersion: "0.4.4" })),
      verifiedReady(),
      "verified-candidate-projection-mismatch",
    ],
  ]) {
    const runtime = service({ projection, verified, executeLifecycle });
    const response = await runtime.requestLifecycle(request());
    assert.equal(response.state, "rejected");
    assert.equal(response.reason, expectedReason);
  }
  assert.equal(calls, 0);
});

test("remove remains possible from verified current activation when app is no longer catalogued remotely", async () => {
  const seen = [];
  const runtime = service({
    projection: ready(entry({
      state: "installed",
      installedVersion: "0.4.3",
      availableVersion: null,
      installable: false,
      updatable: false,
      removable: true,
      artifactIdentityVerified: false,
      provenanceVerified: false,
    })),
    verified: verifiedReady([verifiedEntry({ appId: "studio", title: "ORDAX Studio" })]),
    executeLifecycle: async (plan) => {
      seen.push(plan);
      return resultFor(plan);
    },
  });

  const response = await runtime.requestLifecycle(request("remove"));
  assert.equal(response.state, "accepted");
  assert.equal(seen.length, 1);
  const plan = validateAppLifecyclePlan(seen[0]);
  assert.equal(plan.request.operation, "remove");
  assert.equal(plan.candidate, null);
});

test("Store lifecycle service serializes mutations per app even if UI state has not refreshed yet", async () => {
  let release;
  const firstDone = new Promise((resolve) => { release = resolve; });
  const runtime = service({
    executeLifecycle: async (plan) => {
      await firstDone;
      return resultFor(plan);
    },
  });

  const first = request("install", { requestId: "store:install:notes:first" });
  const second = request("install", { requestId: "store:install:notes:second" });
  const firstPromise = runtime.requestLifecycle(first);
  const secondResult = await runtime.requestLifecycle(second);
  assert.equal(secondResult.state, "rejected");
  assert.equal(secondResult.reason, "lifecycle-request-in-flight");

  release();
  assert.equal((await firstPromise).state, "accepted");
});

test("same lifecycle request id is idempotent while replay with different identity fails closed", async () => {
  let calls = 0;
  const runtime = service({
    executeLifecycle: async (plan) => {
      calls += 1;
      return resultFor(plan);
    },
  });

  const value = request("install", { requestId: "store:install:notes:idempotent" });
  const first = runtime.requestLifecycle(value);
  const replay = runtime.requestLifecycle(value);
  assert.strictEqual(replay, first);
  assert.equal((await first).state, "accepted");
  assert.equal(calls, 1);

  assert.throws(
    () => runtime.requestLifecycle({ ...value, appId: "studio" }),
    /requestId replay identity mismatch/,
  );
});

test("mismatched or failing privileged delegates are converted into bounded fail-closed rejection", async () => {
  const value = request();
  for (const executeLifecycle of [
    async (plan) => resultFor({
      ...plan.request,
      appId: "studio",
    }),
    async () => { throw new Error("private detail must not escape"); },
  ]) {
    const runtime = service({ executeLifecycle });
    const response = await runtime.requestLifecycle(value);
    assert.equal(response.state, "rejected");
    assert.equal(response.reason, "platform-lifecycle-unavailable");
  }
});

test("Store lifecycle delegate remains private platform authority while plan and public port remain authority-free", () => {
  assert.throws(
    () => createAppLifecycleRequestService({
      catalogPort: catalogPort(ready()),
      verifiedCatalogPort: verifiedPort(verifiedReady()),
      lifecycleDelegate: {
        schema: APP_LIFECYCLE_DELEGATE_SCHEMA,
        authority: "none",
        executeLifecycle() {},
      },
    }),
    /requires platform component lifecycle authority/,
  );

  assert.throws(
    () => validateAppLifecyclePlan({
      schema: APP_LIFECYCLE_PLAN_SCHEMA,
      request: request(),
      catalogSequence: 9,
      catalogSha256: "f".repeat(64),
      catalogSourceCommit: COMMIT,
      candidate: {
        appId: "notes",
        version: "0.4.3",
        sourceCommit: COMMIT,
        artifacts: verifiedEntry().artifacts,
      },
      authority: "platform-component-lifecycle",
    }),
    /must remain authority:none/,
  );
});


test("early rejection stays tied to its requestId when the verified catalog later becomes available", async () => {
  let currentProjection = unavailable();
  let calls = 0;
  const runtime = createAppLifecycleRequestService({
    catalogPort: Object.freeze({
      schema: APP_STORE_CATALOG_PORT_SCHEMA,
      authority: "none",
      getSnapshot() { return currentProjection; },
      subscribe() { return () => {}; },
    }),
    verifiedCatalogPort: verifiedPort(verifiedReady()),
    lifecycleDelegate: delegate(async (plan) => {
      calls += 1;
      return resultFor(plan);
    }),
  });

  const original = request("install", { requestId: "store:install:notes:denied-once" });
  const denied = runtime.requestLifecycle(original);
  assert.equal((await denied).reason, "verified-catalog-unavailable");

  currentProjection = ready();
  assert.strictEqual(runtime.requestLifecycle(original), denied);
  assert.equal((await runtime.requestLifecycle(original)).state, "rejected");
  assert.equal(calls, 0);
  assert.throws(
    () => runtime.requestLifecycle(request("remove", { requestId: original.requestId })),
    /requestId replay identity mismatch/,
  );

  const newRequest = request("install", { requestId: "store:install:notes:new-verified-catalog" });
  assert.equal((await runtime.requestLifecycle(newRequest)).state, "accepted");
  assert.equal(calls, 1);
});

test("concurrent rejection stays idempotent even after the first request resolves", async () => {
  let release;
  const settled = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const runtime = service({
    executeLifecycle: async (plan) => {
      calls += 1;
      await settled;
      return resultFor(plan);
    },
  });
  const firstRequest = request("install", { requestId: "store:install:notes:held-request" });
  const competingRequest = request("install", { requestId: "store:install:notes:denied-busy" });
  const running = runtime.requestLifecycle(firstRequest);
  const denied = runtime.requestLifecycle(competingRequest);
  assert.equal((await denied).reason, "lifecycle-request-in-flight");

  release();
  assert.equal((await running).state, "accepted");
  assert.strictEqual(runtime.requestLifecycle(competingRequest), denied);
  assert.equal((await runtime.requestLifecycle(competingRequest)).reason, "lifecycle-request-in-flight");
  assert.equal(calls, 1);
});

test("signed candidate mismatch denial cannot be replayed after catalog reconciliation", async () => {
  let currentVerified = verifiedUnavailable();
  let calls = 0;
  const runtime = createAppLifecycleRequestService({
    catalogPort: catalogPort(ready()),
    verifiedCatalogPort: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
      authority: "none",
      getSnapshot() { return currentVerified; },
      subscribe() { return () => {}; },
    }),
    lifecycleDelegate: delegate(async (plan) => {
      calls += 1;
      return resultFor(plan);
    }),
  });
  const original = request("install", { requestId: "store:install:notes:verified-denied" });
  assert.equal((await runtime.requestLifecycle(original)).reason, "verified-catalog-unavailable");
  currentVerified = verifiedReady();
  assert.equal((await runtime.requestLifecycle(original)).reason, "verified-catalog-unavailable");
  assert.equal(calls, 0);

  assert.equal((await runtime.requestLifecycle(
    request("install", { requestId: "store:install:notes:verified-new" }),
  )).state, "accepted");
  assert.equal(calls, 1);
});

test("unsigned runtime capability cannot be invented by a verified catalog for optional apps", async () => {
  let delegated = 0;
  const executeLifecycle = async (plan) => {
    delegated += 1;
    return resultFor(plan);
  };
  for (const operation of ["install", "update"]) {
    const projection = entry({
      appId: "calculator",
      title: "Calculadora",
      state: operation === "install" ? "available" : "installed",
      installedVersion: operation === "install" ? null : "0.4.2",
      availableVersion: "0.4.3",
      installable: operation === "install",
      updatable: operation === "update",
      removable: operation === "update",
    });
    const runtime = service({
      projection: ready(projection),
      verified: verifiedReady([verifiedEntry({appId:"calculator"})]),
      executeLifecycle,
    });
    const ask = request(operation, {
      appId:"calculator",
      requestId:"store:" + operation + ":calculator:module-gate",
    });
    const denied = await runtime.requestLifecycle(ask);
    assert.equal(denied.state,"rejected");
    assert.equal(denied.reason,"runtime-module-read-unavailable");
    assert.strictEqual(await runtime.requestLifecycle(ask),denied,
      "same requestId remains rejected after checks change");
  }
  assert.equal(delegated,0,"Native lifecycle delegate must not be invoked");
});

test("store removal is not blocked by missing Native executable-read support", async () => {
  let calls=0;
  const runtime=service({
    projection:ready(entry({
      appId:"calculator",
      title:"Calculadora",
      state:"installed",
      installedVersion:"0.2.0",
      availableVersion:null,
      installable:false, updatable:false,
      removable:true,
      artifactIdentityVerified:false,
      provenanceVerified:false,
    })),
    // The verified catalog contract requires at least one valid entry.
    // Calculator has disappeared from that catalog, but is still installed
    // and must retain the ability to uninstall without Native module reads.
    verified:verifiedReady([verifiedEntry({appId:"studio"})]),
    executeLifecycle:async plan=>{
      calls += 1;
      return resultFor(plan);
    },
  });
  const response=await runtime.requestLifecycle(request("remove",{
    appId:"calculator",
    requestId:"store:remove:calculator:no-module-read",
  }));
  assert.equal(response.state,"accepted");
  assert.equal(calls,1);
});



test("revoked signed catalog or activation projection cannot reach Native after synchronous planning", async () => {
  const mutations = [
    ["projected action revoked", (state) => { state.projection = ready(entry({ installable: false })); }],
    ["projected catalog unavailable", (state) => { state.projection = unavailable(); }],
    ["signed catalog unavailable", (state) => { state.signed = verifiedUnavailable(); }],
    ["signed sequence rotated", (state) => {
      state.signed = { ...verifiedReady(), sequence: 10, catalogSha256: "1".repeat(64) };
    }],
    ["signed candidate artifacts replaced at same sequence", (state) => {
      state.signed = verifiedReady([verifiedEntry({
        artifacts: { ...verifiedEntry().artifacts, package: artifact("notes.zip", "7") },
      })]);
    }],
    ["signed candidate withdrawn", (state) => {
      state.signed = verifiedReady([verifiedEntry({ appId: "studio", title: "ORDAX Studio" })]);
    }],
  ];
  for (const [name, mutate] of mutations) {
    const state = { projection: ready(), signed: verifiedReady() };
    let delegated = 0;
    const runtime = createAppLifecycleRequestService({
      catalogPort: Object.freeze({
        schema: APP_STORE_CATALOG_PORT_SCHEMA,
        authority: "none",
        getSnapshot() { return state.projection; },
        subscribe() { return () => {}; },
      }),
      verifiedCatalogPort: Object.freeze({
        schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
        authority: "none",
        getSnapshot() { return state.signed; },
        subscribe() { return () => {}; },
      }),
      lifecycleDelegate: delegate((plan) => {
        delegated += 1;
        return resultFor(plan);
      }),
    });
    const ask = request("install", { requestId: "store:install:notes:revocation-" + name.replaceAll(" ", "-") });
    const pending = runtime.requestLifecycle(ask);
    mutate(state); // before the microtask that would cross into Native
    const denied = await pending;
    assert.equal(denied.state, "rejected", name);
    assert.equal(denied.reason, "verified-lifecycle-plan-stale", name);
    assert.equal(delegated, 0, name);
    assert.strictEqual(await runtime.requestLifecycle(ask), denied, name + ": idempotent rejection");
  }
});

test("unchanged canonical plan delegates exactly once even when snapshots are re-instantiated", async () => {
  const state = { projection: ready(), signed: verifiedReady() };
  let delegated = 0;
  const runtime = createAppLifecycleRequestService({
    catalogPort: Object.freeze({
      schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: "none",
      getSnapshot() { return { ...state.projection, entries: state.projection.entries.map((e) => ({ ...e })) }; },
      subscribe() { return () => {}; },
    }),
    verifiedCatalogPort: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA, authority: "none",
      getSnapshot() { return { ...state.signed, entries: state.signed.entries.map((e) => ({ ...e })) }; },
      subscribe() { return () => {}; },
    }),
    lifecycleDelegate: delegate((plan) => { delegated += 1; return resultFor(plan); }),
  });
  const ask = request("install", { requestId: "store:install:notes:same-plan-after-read" });
  const result = await runtime.requestLifecycle(ask);
  assert.equal(result.state, "accepted");
  assert.equal(delegated, 1);
});

test("unchanged verified installed slot remains removable without a listed candidate", async () => {
  const installed = ready(entry({
    state: "installed", installedVersion: "0.4.3",
    availableVersion: null, installable: false, updatable: false, removable: true,
    artifactIdentityVerified: false, provenanceVerified: false,
  }));
  let delegated = 0;
  const runtime = service({
    projection: installed,
    verified: verifiedReady([verifiedEntry({ appId: "studio", title: "ORDAX Studio" })]),
    executeLifecycle: async (plan) => { delegated += 1; return resultFor(plan); },
  });
  const result = await runtime.requestLifecycle(request("remove", {
    requestId: "store:remove:notes:still-installed",
  }));
  assert.equal(result.state, "accepted");
  assert.equal(delegated, 1);
});


test("installed slot version drift blocks stale update and remove before Native delegation", async () => {
  for (const operation of ["update", "remove"]) {
    let current = ready(entry({
      state: "installed",
      installedVersion: "0.4.1",
      availableVersion: operation === "update" ? "0.4.3" : null,
      installable: false,
      updatable: operation === "update",
      removable: true,
      artifactIdentityVerified: operation === "update",
      provenanceVerified: operation === "update",
    }));
    let delegated = 0;
    const runtime = createAppLifecycleRequestService({
      catalogPort: Object.freeze({
        schema: APP_STORE_CATALOG_PORT_SCHEMA,
        authority: "none",
        getSnapshot() { return current; },
        subscribe() { return () => {}; },
      }),
      verifiedCatalogPort: verifiedPort(verifiedReady()),
      lifecycleDelegate: delegate((plan) => {
        delegated += 1;
        return resultFor(plan);
      }),
    });
    const ask = request(operation, {
      requestId: "store:" + operation + ":notes:slot-drift",
    });
    const pending = runtime.requestLifecycle(ask);
    // The candidate digest and signed catalog remain identical. Only the
    // installed slot changes, while both actions remain otherwise permitted.
    current = ready(entry({
      ...current.entries[0],
      installedVersion: "0.4.2",
    }));
    const response = await pending;
    assert.equal(response.state, "rejected", operation);
    assert.equal(response.reason, "verified-lifecycle-plan-stale", operation);
    assert.equal(delegated, 0, operation);
    assert.deepEqual(await runtime.requestLifecycle(ask), response, operation + " replay");
  }
});

test("irrelevant signed Store metadata cannot silently switch requested entry before delegation", async () => {
  let current = ready();
  let delegated = 0;
  const runtime = createAppLifecycleRequestService({
    catalogPort: Object.freeze({
      schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: "none",
      getSnapshot() { return current; },
      subscribe() { return () => {}; },
    }),
    verifiedCatalogPort: verifiedPort(verifiedReady()),
    lifecycleDelegate: delegate((plan) => { delegated += 1; return resultFor(plan); }),
  });
  const pending = runtime.requestLifecycle(request("install", {
    requestId: "store:install:notes:title-replaced",
  }));
  current = ready(entry({ title: "Notas desconhecidas" }));
  const result = await pending;
  assert.equal(result.state, "rejected");
  assert.equal(result.reason, "verified-lifecycle-plan-stale");
  assert.equal(delegated, 0);
});

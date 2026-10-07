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
      repository: "washingtonmsdj/ordax-apps",
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

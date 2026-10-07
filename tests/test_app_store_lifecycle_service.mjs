import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
  APP_LIFECYCLE_REQUEST_SCHEMA,
} from "../system/contracts/app-lifecycle-request.mjs";
import {
  APP_STORE_CATALOG_PORT_SCHEMA,
  APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/app-store.mjs";
import {
  APP_LIFECYCLE_DELEGATE_SCHEMA,
  createAppLifecycleRequestService,
} from "../system/services/apps/store-lifecycle-request-service.mjs";

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

function resultFor(value, state = "accepted", reason = null) {
  return {
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: value.requestId,
    appId: value.appId,
    operation: value.operation,
    source: value.source,
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

test("Store lifecycle service delegates only an operation currently offered by verified catalog projection", async () => {
  const seen = [];
  const service = createAppLifecycleRequestService({
    catalogPort: catalogPort(ready()),
    lifecycleDelegate: delegate(async (value) => {
      seen.push(value);
      return resultFor(value);
    }),
  });

  const value = request();
  const response = await service.requestLifecycle(value);
  assert.equal(response.state, "accepted");
  assert.deepEqual(seen, [value]);
  assert.equal(service.authority, "none");
});

test("Store lifecycle service revalidates catalog and fails closed before privileged delegation", async () => {
  let calls = 0;
  const lifecycleDelegate = delegate(async (value) => {
    calls += 1;
    return resultFor(value);
  });

  for (const [snapshot, expectedReason] of [
    [unavailable(), "verified-catalog-unavailable"],
    [ready(entry({ appId: "studio" })), "app-not-catalogued"],
    [ready(entry({ installable: false })), "lifecycle-operation-not-available"],
  ]) {
    const service = createAppLifecycleRequestService({
      catalogPort: catalogPort(snapshot),
      lifecycleDelegate,
    });
    const response = await service.requestLifecycle(request());
    assert.equal(response.state, "rejected");
    assert.equal(response.reason, expectedReason);
  }
  assert.equal(calls, 0);
});

test("Store lifecycle service serializes mutations per app even if UI state has not refreshed yet", async () => {
  let release;
  const firstDone = new Promise((resolve) => { release = resolve; });
  const service = createAppLifecycleRequestService({
    catalogPort: catalogPort(ready()),
    lifecycleDelegate: delegate(async (value) => {
      await firstDone;
      return resultFor(value);
    }),
  });

  const first = request("install", { requestId: "store:install:notes:first" });
  const second = request("install", { requestId: "store:install:notes:second" });
  const firstPromise = service.requestLifecycle(first);
  const secondResult = await service.requestLifecycle(second);
  assert.equal(secondResult.state, "rejected");
  assert.equal(secondResult.reason, "lifecycle-request-in-flight");

  release();
  assert.equal((await firstPromise).state, "accepted");
});

test("same lifecycle request id is idempotent while replay with different identity fails closed", async () => {
  let calls = 0;
  const service = createAppLifecycleRequestService({
    catalogPort: catalogPort(ready()),
    lifecycleDelegate: delegate(async (value) => {
      calls += 1;
      return resultFor(value);
    }),
  });

  const value = request("install", { requestId: "store:install:notes:idempotent" });
  const first = service.requestLifecycle(value);
  const replay = service.requestLifecycle(value);
  assert.strictEqual(replay, first);
  assert.equal((await first).state, "accepted");
  assert.equal(calls, 1);

  assert.throws(
    () => service.requestLifecycle({ ...value, appId: "studio" }),
    /requestId replay identity mismatch/,
  );
});

test("mismatched or failing privileged delegates are converted into bounded fail-closed rejection", async () => {
  const value = request();
  for (const executeLifecycle of [
    async (candidate) => resultFor({ ...candidate, appId: "studio" }),
    async () => { throw new Error("private detail must not escape"); },
  ]) {
    const service = createAppLifecycleRequestService({
      catalogPort: catalogPort(ready()),
      lifecycleDelegate: delegate(executeLifecycle),
    });
    const response = await service.requestLifecycle(value);
    assert.equal(response.state, "rejected");
    assert.equal(response.reason, "platform-lifecycle-unavailable");
  }
});

test("Store lifecycle delegate is a private platform boundary, not another UI updater", async () => {
  const source = await import("../system/services/apps/store-lifecycle-request-service.mjs");
  assert.equal(source.APP_LIFECYCLE_DELEGATE_SCHEMA, "ordax.app-lifecycle-delegate/1");

  assert.throws(
    () => createAppLifecycleRequestService({
      catalogPort: catalogPort(ready()),
      lifecycleDelegate: {
        schema: APP_LIFECYCLE_DELEGATE_SCHEMA,
        authority: "none",
        executeLifecycle() {},
      },
    }),
    /requires platform component lifecycle authority/,
  );
});

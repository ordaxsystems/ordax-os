import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_STORE_CATALOG_PORT_SCHEMA,
  APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/app-store.mjs";
import {
  APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
} from "../system/contracts/app-lifecycle-request.mjs";
import {
  STORE_UPDATE_BATCH_SCHEMA,
  createStoreUpdateRequestBatch,
} from "../system/services/apps/store-update-request-batch.mjs";

function entry(appId, options = {}) {
  return {
    appId,
    title: appId,
    state: "installed",
    installedVersion: "1.0.0",
    availableVersion: "1.1.0",
    installable: false,
    updatable: true,
    removable: true,
    blockedReason: null,
    artifactIdentityVerified: true,
    provenanceVerified: true,
    ...options,
  };
}

function snapshot(entries = [entry("notes"), entry("calculator")]) {
  return {
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    entries,
    reason: null,
    authority: "none",
  };
}

function harness(entries = [entry("notes"), entry("calculator")], handler = async () => "accepted") {
  let latest = snapshot(entries);
  let seq = 0;
  const calls = [];
  const catalogPort = Object.freeze({
    schema: APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() { return latest; },
    subscribe(listener) { listener(latest); return () => {}; },
  });
  const lifecycleRequestPort = Object.freeze({
    schema: APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
    authority: "none",
    async requestLifecycle(request) {
      calls.push(request);
      const state = await handler(request, calls.length);
      if (typeof state === "object") return state;
      return {
        schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
        requestId: request.requestId,
        appId: request.appId,
        operation: request.operation,
        source: request.source,
        state,
        reason: state === "rejected" ? "platform-refused" : null,
        authority: "none",
      };
    },
  });
  const factory = (appId) => `store:update:${appId}:trusted-session:${++seq}`;
  const create = (requestIdFactory = factory) => createStoreUpdateRequestBatch({
    catalogPort, lifecycleRequestPort, requestIdFactory,
  });
  return {
    create, calls,
    setEntries(entries) { latest = snapshot(entries); },
    setUnavailable() {
      latest = { schema: APP_STORE_CATALOG_SCHEMA, state: "unavailable",
        entries: [], reason: "signed-catalog-unavailable", authority: "none" };
    },
    setMalformed() { latest = { ...latest, authority: "platform" }; },
  };
}

test("Update all delegates serial authority-free update requests without claiming install completion", async () => {
  let firstRelease;
  const h = harness([entry("notes"), entry("calculator"), entry("unavailable", {
    state: "blocked", updatable: false, blockedReason: "not-supported",
  })], async (_request, index) => {
    if (index === 1) await new Promise((resolve) => { firstRelease = resolve; });
    return "accepted";
  });
  const queue = h.create();
  const first = queue.submitAvailableUpdates();
  assert.equal(queue.submitAvailableUpdates(), first, "double-click must share one promise");
  await Promise.resolve();
  assert.equal(h.calls.length, 1, "next request must not run before previous response");
  assert.equal(h.calls[0].operation, "update");
  assert.equal(h.calls[0].source, "store");
  assert.equal(h.calls[0].authority, "none");
  firstRelease();
  const report = await first;
  assert.equal(report.schema, STORE_UPDATE_BATCH_SCHEMA);
  assert.equal(report.authority, "none");
  assert.equal(report.state, "requests-processed");
  assert.equal(report.intendedCount, 2);
  assert.equal(report.acceptedRequests, 2);
  assert.equal(report.rejectedRequests, 0);
  assert.equal(report.skippedRequests, 0);
  assert.deepEqual(h.calls.map(({ appId }) => appId), ["notes", "calculator"]);
  assert.equal(Object.isFrozen(report.outcomes), true);
  assert.deepEqual(report.outcomes.map((item) => item.state), ["accepted", "accepted"]);
  assert.equal("installedCount" in report, false, "accepted request is not a health-checked update");

  const repeated = await queue.submitAvailableUpdates();
  assert.equal(repeated.state, "requests-already-accepted");
  assert.equal(h.calls.length, 2, "repeated clicks must not issue accepted version again");
  h.setEntries([entry("notes", { installedVersion: "1.1.0", availableVersion: "1.2.0" }),
    entry("calculator")]);
  const followUp = await queue.submitAvailableUpdates();
  assert.equal(followUp.acceptedRequests, 1);
  assert.equal(h.calls[2].appId, "notes");
});

test("Update all stops before delegation when the signed Store becomes unavailable", async () => {
  const h = harness();
  const queue = h.create();
  const running = queue.submitAvailableUpdates();
  h.setUnavailable();
  const report = await running;
  assert.equal(report.state, "requests-processed");
  assert.equal(report.intendedCount, 2);
  assert.equal(report.skippedRequests, 2);
  assert.deepEqual(report.outcomes.map((item) => item.reason), [
    "catalog-unavailable", "catalog-unavailable",
  ]);
  assert.equal(h.calls.length, 0);
  assert.equal((await queue.submitAvailableUpdates()).state, "catalog-unavailable");
});

test("Malformed initial catalog fails closed without throwing or delegating", async () => {
  const h = harness();
  const queue = h.create();
  h.setMalformed();
  const report = await queue.submitAvailableUpdates();
  assert.equal(report.state, "catalog-unavailable");
  assert.equal(report.intendedCount, 0);
  assert.equal(report.acceptedRequests, 0);
  assert.equal(h.calls.length, 0);
});

test("A replaced candidate is never replayed from the initial Store snapshot", async () => {
  const h = harness(undefined, async (_req, index) => {
    if (index === 1) h.setEntries([
      entry("notes"),
      entry("calculator", { availableVersion: "1.2.0" }),
    ]);
    return "accepted";
  });
  const queue = h.create();
  const report = await queue.submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 1);
  assert.equal(report.skippedRequests, 1);
  assert.equal(report.outcomes[1].reason, "candidate-changed");
  assert.deepEqual(h.calls.map((req) => req.appId), ["notes"]);
  // The next deliberate batch can use the currently verified projection.
  const next = await queue.submitAvailableUpdates();
  assert.equal(next.acceptedRequests, 1);
  assert.equal(h.calls[1].appId, "calculator");
});

test("Rejection or service error cannot be converted into success or grant authority", async () => {
  const h = harness(undefined, async (_req, index) => {
    if (index === 1) return "rejected";
    throw new Error("Native rejected before response");
  });
  const report = await h.create().submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 0);
  assert.equal(report.rejectedRequests, 2);
  assert.deepEqual(report.outcomes.map((item) => item.reason), [
    "platform-refused", "lifecycle-request-unavailable",
  ]);
  assert.equal(report.authority, "none");
});

test("Identity mismatch from delegate never produces accepted status", async () => {
  const h = harness([entry("notes")], async (req) => ({
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: req.requestId,
    appId: "another-app",
    operation: "update",
    source: "store",
    state: "accepted",
    reason: null,
    authority: "none",
  }));
  const report = await h.create().submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 0);
  assert.equal(report.rejectedRequests, 1);
  assert.equal(report.outcomes[0].reason, "lifecycle-request-unavailable");
});

test("Secure request identity is mandatory; duplicate identities stop the remaining batch", async () => {
  const h = harness([entry("notes"), entry("calculator"), entry("internet")]);
  assert.throws(() => h.create(null), /Secure Store requestIdFactory/);
  const queue = h.create(() => "store:update:reused-identity:secure-session");
  const report = await queue.submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 1);
  assert.equal(report.skippedRequests, 2);
  assert.equal(report.outcomes[1].reason, "request-id-unavailable");
  assert.equal(report.outcomes[2].reason, "request-id-unavailable");
  assert.equal(h.calls.length, 1);
});

test("A reused lifecycle request ID is rejected even across different update-all batches", async () => {
  const h = harness([entry("notes")]);
  const queue = h.create(() => "store:update:notes:repeated-identity");
  const first = await queue.submitAvailableUpdates();
  assert.equal(first.acceptedRequests, 1);
  h.setEntries([entry("notes", {
    installedVersion: "1.1.0", availableVersion: "1.2.0",
  })]);
  const second = await queue.submitAvailableUpdates();
  assert.equal(second.acceptedRequests, 0);
  assert.equal(second.skippedRequests, 1);
  assert.equal(second.outcomes[0].reason, "request-id-unavailable");
  assert.equal(h.calls.length, 1, "a new candidate must not replay a prior lifecycle decision");
});

test("Missing entropy fails closed without a time-derived fallback", async () => {
  const h = harness();
  const report = await h.create(() => null).submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 0);
  assert.equal(report.outcomes[0].reason, "request-id-unavailable");
  assert.equal(h.calls.length, 0);
});

test("Cancellation stops only requests not yet delegated", async () => {
  let release;
  const h = harness(undefined, async () => {
    await new Promise((resolve) => { release = resolve; });
    return "accepted";
  });
  const queue = h.create();
  const pending = queue.submitAvailableUpdates();
  await Promise.resolve();
  assert.equal(queue.cancelPending(), true);
  release();
  const report = await pending;
  assert.equal(report.state, "cancelled");
  assert.equal(report.acceptedRequests, 1);
  assert.equal(report.skippedRequests, 1);
  assert.equal(report.outcomes[1].reason, "batch-cancelled");
  assert.equal(h.calls.length, 1);
  assert.equal(queue.cancelPending(), false);
});

test("No eligible app causes no request, even with other unverified installed apps", async () => {
  const h = harness([entry("notes", {
    availableVersion: null, updatable: false,
    artifactIdentityVerified: false, provenanceVerified: false,
  })]);
  const report = await h.create().submitAvailableUpdates();
  assert.equal(report.state, "no-updates");
  assert.equal(report.intendedCount, 0);
  assert.equal(h.calls.length, 0);
});

test("Malformed catalog cannot be trusted for another batch item", async () => {
  const h = harness(undefined, async (_req, index) => {
    if (index === 1) h.setMalformed();
    return "accepted";
  });
  const report = await h.create().submitAvailableUpdates();
  assert.equal(report.acceptedRequests, 1);
  assert.equal(report.outcomes[1].reason, "catalog-invalidated");
  assert.equal(h.calls.length, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createMemoryReviewSession } from "../system/services/memory/review-session.mjs";
import {
  MEMORY_REVIEW_VIEW_SCHEMA,
  createMemoryReviewViewModel,
} from "../system/services/memory/review-view-model.mjs";

function item(index, overrides = {}) {
  return {
    id: `mem-${String(index).padStart(2, "0")}`,
    ownerKind: "device",
    ownerId: null,
    scope: "device",
    kind: "fact",
    sensitivity: "private",
    content: `conteúdo ${index}`,
    provenance: "test",
    sourceTimestamp: `2026-09-24T12:${String(index).padStart(2, "0")}:00Z`,
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function identityPort(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

const signedIn = () => ({
  state: "signed-in",
  subjectId: "account-1",
  displayName: "Conta",
});
const signedOut = () => ({ state: "signed-out", subjectId: null, displayName: null });

test("review view paginates with one bounded lookahead item", () => {
  const memory = createMemoryRuntime();
  for (let index = 0; index < 12; index += 1) memory.remember(item(index));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session, { pageSize: 5 });

  let snapshot = view.getSnapshot();
  assert.equal(snapshot.schema, MEMORY_REVIEW_VIEW_SCHEMA);
  assert.equal(snapshot.items.length, 5);
  assert.equal(snapshot.items[0].id, "mem-11");
  assert.equal(snapshot.canPrevious, false);
  assert.equal(snapshot.canNext, true);

  snapshot = view.nextPage();
  assert.equal(snapshot.offset, 5);
  assert.equal(snapshot.items[0].id, "mem-06");
  assert.equal(snapshot.canPrevious, true);
  assert.equal(snapshot.canNext, true);

  snapshot = view.nextPage();
  assert.equal(snapshot.offset, 10);
  assert.deepEqual(snapshot.items.map((entry) => entry.id), ["mem-01", "mem-00"]);
  assert.equal(snapshot.canNext, false);

  snapshot = view.previousPage();
  assert.equal(snapshot.offset, 5);
  view.dispose();
  session.dispose();
});

test("review view search resets pagination and remains bounded", () => {
  const memory = createMemoryRuntime();
  for (let index = 0; index < 8; index += 1) memory.remember(item(index));
  memory.remember(item(20, { content: "agulha especial" }));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session, { pageSize: 3 });
  view.nextPage();
  assert.equal(view.getSnapshot().offset, 3);

  const result = view.setQuery("agulha");
  assert.equal(result.offset, 0);
  assert.deepEqual(result.items.map((entry) => entry.id), ["mem-20"]);
  assert.equal(result.canNext, false);
  assert.throws(() => view.setQuery("x".repeat(1025)), /query/);
  view.dispose();
  session.dispose();
});

test("review view resets to device owner when account disappears", () => {
  const memory = createMemoryRuntime();
  memory.remember(item(1));
  memory.remember(item(2));
  memory.remember(item(3, {
    id: "account-item",
    ownerKind: "account",
    ownerId: "account-1",
    content: "conta",
  }));
  const identity = identityPort(signedIn());
  const session = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identity,
  });
  const view = createMemoryReviewViewModel(session, { pageSize: 2 });

  view.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  assert.equal(view.getSnapshot().selectedOwner.key, "account:account-1");
  assert.deepEqual(view.getSnapshot().items.map((entry) => entry.id), ["account-item"]);

  identity.publish(signedOut());
  assert.equal(view.getSnapshot().selectedOwner.key, "device");
  assert.deepEqual(view.getSnapshot().items.map((entry) => entry.id), ["mem-02", "mem-01"]);
  view.dispose();
  session.dispose();
});

test("review view exposes pending then saved persistence state", async () => {
  let releaseFlush;
  const flushGate = new Promise((resolve) => { releaseFlush = resolve; });
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      await flushGate;
      return true;
    },
  });
  memory.remember(item(1));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session);

  const update = view.update("mem-01", { content: "revisado" });
  assert.equal(view.getSnapshot().persistenceState, "pending");
  assert.equal(view.getSnapshot().items[0].content, "revisado");
  releaseFlush();
  const result = await update;
  assert.equal(result.content, "revisado");
  assert.equal(view.getSnapshot().persistenceState, "saved");
  assert.equal(view.getSnapshot().persistenceError, null);
  view.dispose();
  session.dispose();
});

test("only the latest overlapping mutation may publish saved state", async () => {
  const flushResolvers = [];
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    flush() {
      return new Promise((resolve) => flushResolvers.push(resolve));
    },
  });
  memory.remember(item(1));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session);

  const first = view.update("mem-01", { content: "primeira" });
  const second = view.update("mem-01", { content: "segunda" });
  assert.equal(flushResolvers.length, 2);
  assert.equal(view.getSnapshot().persistenceState, "pending");
  assert.equal(view.getSnapshot().items[0].content, "segunda");

  flushResolvers[0](true);
  await first;
  assert.equal(view.getSnapshot().persistenceState, "pending");
  assert.equal(view.getSnapshot().items[0].content, "segunda");

  flushResolvers[1](true);
  await second;
  assert.equal(view.getSnapshot().persistenceState, "saved");
  assert.equal(view.getSnapshot().items[0].content, "segunda");
  view.dispose();
  session.dispose();
});

test("review view exposes only a generic persistence failure", async () => {
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      throw new Error("/var/lib/private/path: errno 5");
    },
  });
  memory.remember(item(1));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session);

  let rejection = null;
  try {
    await view.remove("mem-01");
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection instanceof Error);
  assert.equal(rejection.message, "Memory review persistence failed");
  assert.equal(rejection.message.includes("/var/lib/private/path"), false);
  assert.equal(rejection.message.includes("errno"), false);

  const snapshot = view.getSnapshot();
  assert.equal(snapshot.persistenceState, "error");
  assert.equal(snapshot.persistenceError, "persistence-failed");
  assert.equal(JSON.stringify(snapshot).includes("/var/lib/private/path"), false);
  assert.equal(JSON.stringify(snapshot).includes("errno"), false);
  view.dispose();
  session.dispose();
});

test("owner change clears stale persistence status from the previous owner", async () => {
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      throw new Error("private host failure");
    },
  });
  memory.remember(item(1));
  memory.remember(item(2, {
    id: "account-item",
    ownerKind: "account",
    ownerId: "account-1",
    content: "conta",
  }));
  const session = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
  });
  const view = createMemoryReviewViewModel(session);

  await assert.rejects(() => view.update("mem-01", { content: "alterado" }), /persistence failed/);
  assert.equal(view.getSnapshot().persistenceState, "error");
  assert.equal(view.getSnapshot().persistenceError, "persistence-failed");

  view.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  assert.equal(view.getSnapshot().selectedOwner.key, "account:account-1");
  assert.equal(view.getSnapshot().persistenceState, "idle");
  assert.equal(view.getSnapshot().persistenceError, null);
  view.dispose();
  session.dispose();
});

test("owner change invalidates an in-flight persistence completion", async () => {
  let releaseFlush;
  const flushGate = new Promise((resolve) => { releaseFlush = resolve; });
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      await flushGate;
      return true;
    },
  });
  memory.remember(item(1));
  memory.remember(item(2, {
    id: "account-item",
    ownerKind: "account",
    ownerId: "account-1",
    content: "conta",
  }));
  const session = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
  });
  const view = createMemoryReviewViewModel(session);

  const pending = view.update("mem-01", { content: "alterado" });
  assert.equal(view.getSnapshot().persistenceState, "pending");
  view.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  assert.equal(view.getSnapshot().persistenceState, "idle");
  assert.equal(view.getSnapshot().selectedOwner.key, "account:account-1");

  releaseFlush();
  await pending;
  assert.equal(view.getSnapshot().persistenceState, "idle");
  assert.equal(view.getSnapshot().selectedOwner.key, "account:account-1");
  view.dispose();
  session.dispose();
});

test("review view rejects unsafe page size and work after dispose", () => {
  const session = createMemoryReviewSession({ memoryPort: createMemoryRuntime() });
  assert.throws(() => createMemoryReviewViewModel(session, { pageSize: 32 }), /page size/);
  const view = createMemoryReviewViewModel(session);
  view.dispose();
  assert.throws(() => view.refresh(), /disposed/);
  session.dispose();
});


test("review view persists manual Memory creation before reporting saved", async () => {
  let flushes = 0;
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      flushes += 1;
      return true;
    },
  });
  const session = createMemoryReviewSession({
    memoryPort: memory,
    idFactory: () => "manual-view",
  });
  const view = createMemoryReviewViewModel(session);

  const created = await view.create("Memória manual");
  assert.equal(created.id, "manual-view");
  assert.equal(created.scope, "device");
  assert.equal(flushes, 1);
  assert.equal(view.getSnapshot().persistenceState, "saved");
  assert.deepEqual(view.getSnapshot().items.map((entry) => entry.id), ["manual-view"]);
  view.dispose();
  session.dispose();
});


test("review view exports the selected owner independently of page and search state", () => {
  const memory = createMemoryRuntime();
  for (let index = 0; index < 6; index += 1) memory.remember(item(index));
  const session = createMemoryReviewSession({ memoryPort: memory });
  const view = createMemoryReviewViewModel(session, { pageSize: 2 });

  view.setQuery("5");
  assert.equal(view.getSnapshot().items.length, 1);
  const exported = view.exportSnapshot();
  assert.equal(exported.items.length, 6);
  assert.deepEqual(exported.owner, { ownerKind: "device", ownerId: null });

  view.dispose();
  assert.throws(() => view.exportSnapshot(), /disposed/);
  session.dispose();
});

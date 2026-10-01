import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { MEMORY_MUTATION_PORT_SCHEMA } from "../system/contracts/memory-mutation.mjs";
import {
  MEMORY_REVIEW_SESSION_SCHEMA,
  createMemoryReviewSession,
} from "../system/services/memory/review-session.mjs";

function memoryItem(overrides = {}) {
  return {
    id: "mem-1",
    ownerId: "account-1",
    scope: "device",
    kind: "fact",
    sensitivity: "private",
    content: "conteúdo",
    provenance: "test",
    sourceTimestamp: "2026-09-24T12:00:00Z",
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

const signedOut = () => ({ state: "signed-out", subjectId: null, displayName: null });
const signedIn = (subjectId = "account-1") => ({
  state: "signed-in",
  subjectId,
  displayName: "Conta",
});

test("review session starts with device owner and exposes account as an additional owner", () => {
  const memory = createMemoryRuntime();
  const identity = identityPort(signedIn());
  const review = createMemoryReviewSession({ memoryPort: memory, identitySessionPort: identity });

  const snapshot = review.getSnapshot();
  assert.equal(snapshot.schema, MEMORY_REVIEW_SESSION_SCHEMA);
  assert.deepEqual(snapshot.owners, [
    { ownerKind: "device", ownerId: null, key: "device" },
    { ownerKind: "account", ownerId: "account-1", key: "account:account-1" },
  ]);
  assert.equal(snapshot.selectedOwner.key, "device");
  review.dispose();
});

test("review session switches owners without mixing their items", () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem({
    id: "device-item",
    ownerKind: "device",
    ownerId: null,
    content: "local",
  }));
  memory.remember(memoryItem({ id: "account-item", content: "conta" }));
  const review = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
  });

  assert.deepEqual(review.list().map((item) => item.id), ["device-item"]);
  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  assert.deepEqual(review.list().map((item) => item.id), ["account-item"]);
  review.selectOwner({ ownerKind: "device", ownerId: null });
  assert.deepEqual(review.list().map((item) => item.id), ["device-item"]);
  review.dispose();
});

test("sign-out falls back from account review to device owner and notifies listeners", () => {
  const memory = createMemoryRuntime();
  const identity = identityPort(signedIn());
  const review = createMemoryReviewSession({ memoryPort: memory, identitySessionPort: identity });
  const observed = [];
  review.subscribe((snapshot) => observed.push(snapshot.selectedOwner.key));

  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  identity.publish(signedOut());

  assert.equal(review.getSnapshot().selectedOwner.key, "device");
  assert.deepEqual(review.getSnapshot().owners, [
    { ownerKind: "device", ownerId: null, key: "device" },
  ]);
  assert.deepEqual(observed, ["account:account-1", "device"]);
  review.dispose();
});

test("review session rejects unavailable account owners", () => {
  const review = createMemoryReviewSession({
    memoryPort: createMemoryRuntime(),
    identitySessionPort: identityPort(signedOut()),
  });
  assert.throws(
    () => review.selectOwner({ ownerKind: "account", ownerId: "account-1" }),
    /not available/,
  );
  review.dispose();
});

test("review session edits/removes only selected owner and forwards flush", async () => {
  let flushes = 0;
  const base = createMemoryRuntime();
  const memory = Object.freeze({
    ...base,
    async flush() {
      flushes += 1;
      return true;
    },
  });
  memory.remember(memoryItem({
    id: "device-item",
    ownerKind: "device",
    ownerId: null,
    content: "antes",
  }));
  memory.remember(memoryItem({ id: "account-item", content: "conta" }));

  const review = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
    now: () => new Date("2026-09-24T21:00:00Z"),
  });
  const updated = await review.update("device-item", { content: "depois" });
  assert.equal(updated.content, "depois");
  assert.equal(updated.sourceTimestamp, "2026-09-24T21:00:00.000Z");
  assert.equal(await review.remove("account-item"), false);
  assert.equal(await review.flush(), true);
  assert.equal(flushes, 2, "mutation durability plus explicit flush must both reach the Memory store");
  review.dispose();
});

test("disposed review session rejects further work", async () => {
  const review = createMemoryReviewSession({ memoryPort: createMemoryRuntime() });
  review.dispose();
  assert.throws(() => review.list(), /disposed/);
  assert.throws(() => review.selectOwner({ ownerKind: "device", ownerId: null }), /disposed/);
  await assert.rejects(() => review.flush(), /disposed/);
});


test("review session creates manual memory for the selected owner", async () => {
  const memory = createMemoryRuntime();
  const review = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
    now: () => new Date("2026-09-29T11:35:00Z"),
    idFactory: () => "manual-session",
  });
  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  const created = await review.create("Lembrar desta preferência");
  assert.equal(created.ownerKind, "account");
  assert.equal(created.ownerId, "account-1");
  assert.equal(created.scope, "account");
  assert.deepEqual(review.list().map((item) => item.id), ["manual-session"]);
  review.dispose();
});


test("review session exports only the currently selected owner", () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem({
    id: "device-export",
    ownerKind: "device",
    ownerId: null,
    content: "local",
  }));
  memory.remember(memoryItem({ id: "account-export", content: "conta" }));
  const review = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
    now: () => new Date("2026-09-30T03:01:00Z"),
  });

  assert.deepEqual(review.exportSnapshot().items.map((entry) => entry.id), ["device-export"]);
  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  const exported = review.exportSnapshot();
  assert.deepEqual(exported.items.map((entry) => entry.id), ["account-export"]);
  assert.deepEqual(exported.owner, { ownerKind: "account", ownerId: "account-1" });
  review.dispose();
});


test("review session clearAll follows the selected owner without crossing ownership", async () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem({
    id: "device-keep-clear",
    ownerKind: "device",
    ownerId: null,
    content: "local",
  }));
  memory.remember(memoryItem({ id: "account-clear-session", content: "conta" }));
  const review = createMemoryReviewSession({
    memoryPort: memory,
    identitySessionPort: identityPort(signedIn()),
  });

  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });
  const result = await review.clearAll();

  assert.equal(result.removed, 1);
  assert.equal(result.ownerKind, "account");
  assert.equal(result.ownerId, "account-1");
  assert.deepEqual(review.list(), []);

  review.selectOwner({ ownerKind: "device", ownerId: null });
  assert.deepEqual(review.list().map((entry) => entry.id), ["device-keep-clear"]);
  review.dispose();
});


test("in-flight clearAll keeps the owner captured before sign-out", async () => {
  const memory = createMemoryRuntime();
  memory.remember(memoryItem({
    id: "device-must-survive",
    ownerKind: "device",
    ownerId: null,
    content: "device",
  }));
  memory.remember(memoryItem({ id: "account-clear-a", content: "a" }));
  memory.remember(memoryItem({ id: "account-clear-b", content: "b" }));

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let first = true;
  const forgotten = [];
  const mutationPort = {
    schema: MEMORY_MUTATION_PORT_SCHEMA,
    async remember(value) {
      return memory.remember(value);
    },
    async forget(value) {
      forgotten.push({ ...value });
      if (first) {
        first = false;
        await firstGate;
      }
      return memory.forget(value);
    },
  };
  const identity = identityPort(signedIn());
  const review = createMemoryReviewSession({
    memoryPort: memory,
    mutationPort,
    identitySessionPort: identity,
  });
  review.selectOwner({ ownerKind: "account", ownerId: "account-1" });

  const clearing = review.clearAll();
  await Promise.resolve();
  identity.publish(signedOut());
  assert.equal(review.getSnapshot().selectedOwner.key, "device");

  releaseFirst();
  const result = await clearing;

  assert.equal(result.ownerKind, "account");
  assert.equal(result.ownerId, "account-1");
  assert.deepEqual(
    forgotten.map((entry) => [entry.ownerKind, entry.ownerId]).sort(),
    [["account", "account-1"], ["account", "account-1"]],
  );
  assert.deepEqual(
    review.list().map((entry) => entry.id),
    ["device-must-survive"],
  );
  review.dispose();
});

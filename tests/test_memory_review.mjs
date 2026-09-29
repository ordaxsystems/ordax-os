import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRuntime } from "../system/services/memory/runtime.mjs";
import { createMemoryReviewRuntime } from "../system/services/memory/review.mjs";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function item(overrides = {}) {
  return {
    id: "mem-1",
    ownerId: "user-1",
    scope: "project",
    kind: "fact",
    sensitivity: "private",
    content: "conteúdo inicial",
    provenance: "source",
    sourceTimestamp: "2026-09-24T12:00:00Z",
    spaceId: "space-a",
    projectId: "project-a",
    ...overrides,
  };
}

test("memory review lists, edits and removes only inside its owner boundary", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  memory.remember(item({ id: "other-space", spaceId: "space-b", projectId: "project-a" }));
  memory.remember(item({ id: "other-owner", ownerId: "user-2" }));

  const review = createMemoryReviewRuntime(memory, {
    ownerId: "user-1",
    spaceId: "space-a",
    projectId: "project-a",
    now: () => new Date("2026-09-24T18:30:00Z"),
  });

  assert.deepEqual(review.list().map((entry) => entry.id), ["mem-1"]);
  const updated = review.update("mem-1", {
    content: "conteúdo revisado",
    provenance: "user-review",
    sensitivity: "restricted",
  });
  assert.equal(updated.content, "conteúdo revisado");
  assert.equal(updated.provenance, "user-review");
  assert.equal(updated.sensitivity, "restricted");
  assert.equal(updated.sourceTimestamp, "2026-09-24T18:30:00.000Z");

  assert.equal(review.remove("mem-1"), true);
  assert.equal(review.remove("mem-1"), false);
  assert.deepEqual(review.list(), []);

  assert.equal(
    memory.search({
      ownerId: "user-2",
      scopes: ["project"],
      spaceId: "space-a",
      projectId: "project-a",
      includeRestricted: true,
    }).length,
    1,
  );
});

test("device memory review works without account identity and cannot see account items", () => {
  const memory = createMemoryRuntime();
  memory.remember(item({
    id: "device-item",
    ownerKind: "device",
    ownerId: null,
    scope: "device",
    spaceId: null,
    projectId: null,
    content: "local-only",
  }));
  memory.remember(item({
    id: "account-item",
    scope: "account",
    spaceId: null,
    projectId: null,
    content: "account-only",
  }));

  const review = createMemoryReviewRuntime(memory, {
    ownerKind: "device",
    ownerId: null,
    now: () => new Date("2026-09-24T18:45:00Z"),
  });
  assert.deepEqual(review.list().map((entry) => entry.id), ["device-item"]);

  const updated = review.update("device-item", { content: "local revisado" });
  assert.equal(updated.ownerKind, "device");
  assert.equal(updated.ownerId, null);
  assert.equal(updated.content, "local revisado");
  assert.equal(review.update("account-item", { content: "não deve mudar" }), null);
  assert.equal(review.remove("account-item"), false);
  assert.equal(
    memory.search({ ownerId: "user-1", scopes: ["account"] })[0].content,
    "account-only",
  );
});

test("memory review cannot mutate identity, owner, kind or structural scope", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const review = createMemoryReviewRuntime(memory, {
    ownerId: "user-1",
    spaceId: "space-a",
    projectId: "project-a",
  });

  for (const patch of [
    { id: "other" },
    { ownerKind: "device" },
    { ownerId: "user-2" },
    { scope: "account" },
    { spaceId: "space-b" },
    { projectId: "project-b" },
    { kind: "instruction" },
  ]) {
    assert.throws(() => review.update("mem-1", patch), /cannot change/);
  }
});

test("memory review locates old items through bounded pagination", () => {
  const memory = createMemoryRuntime();
  for (let index = 0; index < 40; index += 1) {
    memory.remember(item({
      id: `mem-${String(index).padStart(2, "0")}`,
      content: `conteúdo ${index}`,
      sourceTimestamp: `2026-09-24T12:${String(index).padStart(2, "0")}:00Z`,
    }));
  }
  const review = createMemoryReviewRuntime(memory, {
    ownerId: "user-1",
    spaceId: "space-a",
    projectId: "project-a",
    now: () => new Date("2026-09-24T19:00:00Z"),
  });

  assert.equal(review.list({ limit: 4 }).length, 4);
  assert.equal(review.list({ limit: 4, offset: 32 })[0].id, "mem-07");

  const updated = review.update("mem-00", { content: "memória antiga revisada" });
  assert.ok(updated);
  assert.equal(updated.id, "mem-00");
  assert.equal(updated.content, "memória antiga revisada");
  assert.equal(updated.sourceTimestamp, "2026-09-24T19:00:00.000Z");
});

test("review update still enforces memory secret rejection", () => {
  const memory = createMemoryRuntime();
  memory.remember(item());
  const review = createMemoryReviewRuntime(memory, {
    ownerId: "user-1",
    spaceId: "space-a",
    projectId: "project-a",
  });

  assert.throws(
    () => review.update("mem-1", { content: "ghp_abcdefghijklmnopqrstuvwxyz123456" }),
    /Secrets are not valid/,
  );
});


test("manual Memory creation stays inside the selected personal owner scope", () => {
  const memory = createMemoryRuntime();
  const device = createMemoryReviewRuntime(memory, {
    ownerKind: "device",
    ownerId: null,
    now: () => new Date("2026-09-29T11:30:00Z"),
    idFactory: () => "manual-device",
  });
  const createdDevice = device.create("Preferência local");
  assert.equal(createdDevice.ownerKind, "device");
  assert.equal(createdDevice.ownerId, null);
  assert.equal(createdDevice.scope, "device");
  assert.equal(createdDevice.kind, "fact");
  assert.equal(createdDevice.sensitivity, "private");
  assert.equal(createdDevice.provenance, "user-manual");

  const account = createMemoryReviewRuntime(memory, {
    ownerKind: "account",
    ownerId: "user-1",
    now: () => new Date("2026-09-29T11:31:00Z"),
    idFactory: () => "manual-account",
  });
  const createdAccount = account.create("Preferência da conta");
  assert.equal(createdAccount.ownerKind, "account");
  assert.equal(createdAccount.ownerId, "user-1");
  assert.equal(createdAccount.scope, "account");
  assert.equal(createdAccount.spaceId, null);
  assert.equal(createdAccount.projectId, null);
});

test("default manual account Memory identity is a portable UUID v4", () => {
  const memory = createMemoryRuntime();
  const review = createMemoryReviewRuntime(memory, {
    ownerKind: "account",
    ownerId: "user-1",
    now: () => new Date("2026-09-29T11:32:00Z"),
  });

  const created = review.create("Memória criada offline com identidade estável");
  assert.match(created.id, UUID_V4_RE);
  assert.equal(created.ownerKind, "account");
  assert.equal(created.ownerId, "user-1");
  assert.equal(created.scope, "account");
});

test("manual Memory creation refuses structural Space/project review boundaries", () => {
  const review = createMemoryReviewRuntime(createMemoryRuntime(), {
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-a",
    idFactory: () => "manual-space",
  });
  assert.throws(() => review.create("não criar aqui"), /personal owner scopes/);
});

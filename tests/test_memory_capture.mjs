import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { MEMORY_CAPTURE_AUTH_SCHEMA } from "../system/contracts/memory-capture.mjs";
import {
  MEMORY_CAPTURE_RUNTIME_SCHEMA,
  createMemoryCaptureRuntime,
} from "../system/services/memory/capture.mjs";

function memoryPort({ flushError = null } = {}) {
  const remembered = [];
  let flushes = 0;
  return {
    schema: MEMORY_PORT_SCHEMA,
    remembered,
    get flushes() { return flushes; },
    search() { return []; },
    remember(item) {
      remembered.push(item);
      return item;
    },
    forget() { return false; },
    async flush() {
      flushes += 1;
      if (flushError) throw flushError;
      return true;
    },
  };
}

const accountAuthorization = Object.freeze({
  schema: MEMORY_CAPTURE_AUTH_SCHEMA,
  authority: "composition",
  ownerKind: "account",
  ownerId: "user-1",
  scope: "account",
  spaceId: null,
});

test("Memory capture persists automatically inside a trusted composition boundary", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    now: () => new Date("2026-09-29T11:20:00Z"),
    idFactory: () => "capture-1",
  });

  assert.equal(runtime.schema, MEMORY_CAPTURE_RUNTIME_SCHEMA);
  const result = await runtime.capture({
    content: "Prefere respostas objetivas.",
    kind: "preference",
    sensitivity: "private",
    provenance: "intelligence:conversation",
  }, accountAuthorization);

  assert.equal(result.durable, true);
  assert.equal(result.item.id, "capture-1");
  assert.equal(result.item.ownerKind, "account");
  assert.equal(result.item.ownerId, "user-1");
  assert.equal(result.item.scope, "account");
  assert.equal(memory.remembered.length, 1);
  assert.equal(memory.flushes, 1);
});

test("Memory capture draft cannot choose owner scope Space id or persistent id", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-2",
  });

  for (const injected of [
    { ownerId: "other-user" },
    { ownerKind: "device" },
    { scope: "space" },
    { spaceId: "space-other" },
    { id: "forced-id" },
    { projectId: "project-x" },
  ]) {
    await assert.rejects(
      () => runtime.capture({
        content: "texto",
        kind: "fact",
        provenance: "intelligence",
        ...injected,
      }, accountAuthorization),
      /cannot choose/,
    );
  }
  assert.equal(memory.remembered.length, 0);
});

test("Memory capture authorization forbids project session restricted and invalid Space ownership", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-3",
  });
  const draft = {
    content: "texto",
    kind: "fact",
    provenance: "intelligence",
  };

  await assert.rejects(
    () => runtime.capture(draft, { ...accountAuthorization, scope: "project" }),
    /scope is not allowed/,
  );
  await assert.rejects(
    () => runtime.capture(draft, { ...accountAuthorization, scope: "session" }),
    /scope is not allowed/,
  );
  await assert.rejects(
    () => runtime.capture({ ...draft, sensitivity: "restricted" }, accountAuthorization),
    /sensitivity is not allowed/,
  );
  await assert.rejects(
    () => runtime.capture(draft, {
      schema: MEMORY_CAPTURE_AUTH_SCHEMA,
      authority: "composition",
      ownerKind: "device",
      ownerId: null,
      scope: "space",
      spaceId: "space-a",
    }),
    /requires an account owner/,
  );
});

test("Memory capture can be disabled without writing anything", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-disabled",
    captureEnabled: false,
  });

  const result = await runtime.capture({
    content: "não salvar automaticamente",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);

  assert.equal(result, null);
  assert.equal(memory.remembered.length, 0);
  assert.equal(memory.flushes, 0);
});

test("Memory capture never reports durable success when flush fails", async () => {
  const memory = memoryPort({ flushError: new Error("durability unavailable") });
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-5",
  });

  await assert.rejects(
    () => runtime.capture({
      content: "persistência precisa ser confirmada pelo store",
      kind: "fact",
      provenance: "intelligence",
    }, accountAuthorization),
    /durability unavailable/,
  );
  assert.equal(memory.remembered.length, 1);
  assert.equal(memory.flushes, 1);
});

test("Memory capture accepts exact account-owned Space target only from composition", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-space",
  });
  const result = await runtime.capture({
    content: "Preferência específica deste Space.",
    kind: "preference",
    provenance: "intelligence:conversation",
  }, {
    schema: MEMORY_CAPTURE_AUTH_SCHEMA,
    authority: "composition",
    ownerKind: "account",
    ownerId: "user-1",
    scope: "space",
    spaceId: "space-a",
  });

  assert.equal(result.item.ownerId, "user-1");
  assert.equal(result.item.scope, "space");
  assert.equal(result.item.spaceId, "space-a");
});

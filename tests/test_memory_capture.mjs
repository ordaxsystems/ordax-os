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

function searchableMemoryPort({ flushError = null } = {}) {
  const remembered = [];
  let flushes = 0;
  let currentFlushError = flushError;
  return {
    schema: MEMORY_PORT_SCHEMA,
    remembered,
    get flushes() { return flushes; },
    setFlushError(value) { currentFlushError = value; },
    search(request) {
      const matches = remembered.filter((item) => (
        item.ownerKind === request.ownerKind
        && item.ownerId === request.ownerId
        && request.scopes.includes(item.scope)
        && (item.scope !== "space" || item.spaceId === request.spaceId)
        && (item.scope !== "project" || item.projectId === request.projectId)
        && (!request.query || item.content.includes(request.query))
      ));
      return matches.slice(request.offset, request.offset + request.limit);
    },
    remember(item) {
      remembered.push(item);
      return item;
    },
    forget() { return false; },
    async flush() {
      flushes += 1;
      if (currentFlushError) throw currentFlushError;
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
    readCaptureEnabled: () => false,
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


test("Memory capture policy is reevaluated for every capture", async () => {
  const memory = memoryPort();
  let enabled = true;
  let ordinal = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => `dynamic-${++ordinal}`,
    readCaptureEnabled: () => enabled,
  });

  await runtime.capture({
    content: "primeira",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);
  enabled = false;
  const blocked = await runtime.capture({
    content: "segunda",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);
  enabled = true;
  await runtime.capture({
    content: "terceira",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);

  assert.equal(blocked, null);
  assert.deepEqual(memory.remembered.map((item) => item.content), ["primeira", "terceira"]);
  assert.equal(memory.flushes, 2);
});


test("exact duplicate automatic capture reuses the existing memory identity", async () => {
  const memory = searchableMemoryPort();
  let ids = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    now: () => new Date("2026-09-29T12:00:00Z"),
    idFactory: () => `dedup-${++ids}`,
  });
  const draft = {
    content: "Prefere respostas objetivas.",
    kind: "preference",
    sensitivity: "private",
    provenance: "intelligence:conversation",
  };

  const first = await runtime.capture(draft, accountAuthorization);
  const second = await runtime.capture(
    { ...draft, provenance: "intelligence:conversation-later" },
    accountAuthorization,
  );

  assert.equal(first.item.id, "dedup-1");
  assert.equal(second.item.id, "dedup-1");
  assert.equal(ids, 1, "duplicate capture must not mint another persistent id");
  assert.equal(memory.remembered.length, 1);
  assert.equal(memory.flushes, 2, "existing memory must still pass the durability barrier");
});

test("exact capture dedup does not merge different kinds or Space boundaries", async () => {
  const memory = searchableMemoryPort();
  let ids = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => `boundary-${++ids}`,
  });
  const baseDraft = {
    content: "Usa respostas curtas.",
    kind: "preference",
    sensitivity: "private",
    provenance: "intelligence",
  };
  const spaceA = {
    schema: MEMORY_CAPTURE_AUTH_SCHEMA,
    authority: "composition",
    ownerKind: "account",
    ownerId: "user-1",
    scope: "space",
    spaceId: "space-a",
  };
  const spaceB = { ...spaceA, spaceId: "space-b" };

  await runtime.capture(baseDraft, spaceA);
  await runtime.capture({ ...baseDraft, kind: "fact" }, spaceA);
  await runtime.capture(baseDraft, spaceB);

  assert.equal(memory.remembered.length, 3);
  assert.deepEqual(
    memory.remembered.map((item) => [item.id, item.kind, item.spaceId]),
    [
      ["boundary-1", "preference", "space-a"],
      ["boundary-2", "fact", "space-a"],
      ["boundary-3", "preference", "space-b"],
    ],
  );
});

test("deduplicated capture still fails closed when durability cannot be confirmed", async () => {
  const memory = searchableMemoryPort();
  let ids = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => `durable-${++ids}`,
  });
  const draft = {
    content: "Lembrança já existente",
    kind: "fact",
    sensitivity: "private",
    provenance: "intelligence",
  };

  await runtime.capture(draft, accountAuthorization);
  memory.setFlushError(new Error("dedup durability unavailable"));
  await assert.rejects(
    () => runtime.capture(draft, accountAuthorization),
    /dedup durability unavailable/,
  );
  assert.equal(ids, 1);
  assert.equal(memory.remembered.length, 1);
});

test("long exact Memory capture dedup stays within search-query bounds", async () => {
  const memory = searchableMemoryPort();
  let ids = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => `long-${++ids}`,
  });
  const longContent = `prefix-${"x".repeat(3000)}`;
  const draft = {
    content: longContent,
    kind: "summary",
    sensitivity: "private",
    provenance: "intelligence:long-context",
  };

  const first = await runtime.capture(draft, accountAuthorization);
  const second = await runtime.capture(draft, accountAuthorization);

  assert.equal(first.item.id, "long-1");
  assert.equal(second.item.id, "long-1");
  assert.equal(ids, 1);
  assert.equal(memory.remembered.length, 1);
});

test("exact Memory capture dedup scans beyond the first bounded search page", async () => {
  const memory = searchableMemoryPort();
  const content = "Mesmo conteúdo para paginação.";
  for (let index = 0; index < 40; index += 1) {
    memory.remembered.push({
      id: `near-${index}`,
      ownerKind: "account",
      ownerId: "user-1",
      scope: "account",
      kind: "fact",
      sensitivity: "private",
      content: `${content} variante-${index}`,
      provenance: "fixture",
      sourceTimestamp: "2026-09-29T12:00:00.000Z",
      spaceId: null,
      projectId: null,
    });
  }
  memory.remembered.push({
    id: "existing-exact",
    ownerKind: "account",
    ownerId: "user-1",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content,
    provenance: "older-source",
    sourceTimestamp: "2026-09-29T11:00:00.000Z",
    spaceId: null,
    projectId: null,
  });

  let minted = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => `unexpected-${++minted}`,
  });
  const result = await runtime.capture({
    content,
    kind: "fact",
    sensitivity: "private",
    provenance: "new-source",
  }, accountAuthorization);

  assert.equal(result.item.id, "existing-exact");
  assert.equal(minted, 0);
  assert.equal(memory.remembered.length, 41);
});


test("Memory capture can delegate durable persistence to a composition-owned async writer", async () => {
  const memory = memoryPort();
  const persisted = [];
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-protected",
    async persistItem(item) {
      persisted.push(item);
      return true;
    },
  });

  const result = await runtime.capture({
    content: "Persistência protegida pela composição.",
    kind: "fact",
    sensitivity: "private",
    provenance: "intelligence:conversation",
  }, accountAuthorization);

  assert.equal(result.durable, true);
  assert.equal(result.item.id, "capture-protected");
  assert.equal(persisted.length, 1);
  assert.equal(memory.remembered.length, 0, "capture runtime must not bypass the injected writer");
  assert.equal(memory.flushes, 0, "the injected writer owns durability for a newly persisted item");
});

test("Memory capture fails closed when composition-owned persistence rejects", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-protected-failure",
    async persistItem() {
      throw new Error("protected mutation durability unavailable");
    },
  });

  await assert.rejects(
    () => runtime.capture({
      content: "Não declarar durável sem confirmação.",
      kind: "instruction",
      sensitivity: "private",
      provenance: "intelligence:conversation",
    }, accountAuthorization),
    /protected mutation durability unavailable/,
  );
  assert.equal(memory.remembered.length, 0);
  assert.equal(memory.flushes, 0);
});

test("Memory capture requires explicit durability confirmation from an injected writer", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "capture-boundary",
    async persistItem() {
      return false;
    },
  });

  await assert.rejects(
    () => runtime.capture({
      content: "Não declarar durável sem confirmação explícita.",
      kind: "fact",
      sensitivity: "private",
      provenance: "intelligence:conversation",
    }, accountAuthorization),
    /did not confirm durability/,
  );
});

test("exact duplicate capture keeps using the Memory durability barrier and does not invoke the writer", async () => {
  const memory = searchableMemoryPort();
  const draft = {
    content: "Memória já persistida.",
    kind: "fact",
    sensitivity: "private",
    provenance: "intelligence:first",
  };
  const existing = {
    id: "existing-protected",
    ownerKind: "account",
    ownerId: "user-1",
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: draft.content,
    provenance: draft.provenance,
    sourceTimestamp: "2026-09-30T03:30:00.000Z",
    spaceId: null,
    projectId: null,
  };
  memory.remembered.push(existing);
  let writerCalls = 0;
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "must-not-be-minted",
    async persistItem() {
      writerCalls += 1;
      return true;
    },
  });

  const result = await runtime.capture(
    { ...draft, provenance: "intelligence:later" },
    accountAuthorization,
  );

  assert.equal(result.item.id, "existing-protected");
  assert.equal(writerCalls, 0);
  assert.equal(memory.flushes, 1);
});

import assert from "node:assert/strict";
import test from "node:test";

import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import {
  MEMORY_CAPTURE_AUTH_SCHEMA,
  MEMORY_CAPTURE_CONFIRMATION_SCHEMA,
} from "../system/contracts/memory-capture.mjs";
import {
  MEMORY_CAPTURE_RUNTIME_SCHEMA,
  createMemoryCaptureRuntime,
} from "../system/services/memory/capture.mjs";

function memoryPort() {
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

test("Memory capture proposal never persists before explicit confirmation", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    now: () => new Date("2026-09-29T11:20:00Z"),
    idFactory: () => "proposal-1",
  });

  assert.equal(runtime.schema, MEMORY_CAPTURE_RUNTIME_SCHEMA);
  const proposal = runtime.propose({
    content: "Prefere respostas objetivas.",
    kind: "preference",
    sensitivity: "private",
    provenance: "intelligence:user-request",
  }, accountAuthorization);

  assert.equal(proposal.proposalId, "proposal-1");
  assert.equal(proposal.item.ownerKind, "account");
  assert.equal(proposal.item.ownerId, "user-1");
  assert.equal(proposal.item.scope, "account");
  assert.equal(memory.remembered.length, 0);
  assert.equal(memory.flushes, 0);

  await assert.rejects(
    () => runtime.confirm({
      schema: MEMORY_CAPTURE_CONFIRMATION_SCHEMA,
      authority: "model",
      proposalId: "proposal-1",
      approved: true,
    }),
    /explicit user confirmation/,
  );
  assert.equal(memory.remembered.length, 0);

  await runtime.confirm({
    schema: MEMORY_CAPTURE_CONFIRMATION_SCHEMA,
    authority: "explicit-user-confirmation",
    proposalId: "proposal-1",
    approved: true,
  });
  assert.equal(memory.remembered.length, 1);
  assert.equal(memory.flushes, 1);
  assert.equal(runtime.getPending("proposal-1"), null);
});

test("Memory capture draft cannot choose owner scope Space id or persistent id", () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "proposal-2",
  });

  for (const injected of [
    { ownerId: "other-user" },
    { ownerKind: "device" },
    { scope: "space" },
    { spaceId: "space-other" },
    { id: "forced-id" },
    { projectId: "project-x" },
  ]) {
    assert.throws(
      () => runtime.propose({
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

test("Memory capture authorization forbids project session restricted and cross-owner Space shortcuts", () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "proposal-3",
  });
  const draft = {
    content: "texto",
    kind: "fact",
    provenance: "intelligence",
  };

  assert.throws(
    () => runtime.propose(draft, {
      ...accountAuthorization,
      scope: "project",
    }),
    /scope is not allowed/,
  );
  assert.throws(
    () => runtime.propose(draft, {
      ...accountAuthorization,
      scope: "session",
    }),
    /scope is not allowed/,
  );
  assert.throws(
    () => runtime.propose({
      ...draft,
      sensitivity: "restricted",
    }, accountAuthorization),
    /sensitivity is not allowed/,
  );
  assert.throws(
    () => runtime.propose(draft, {
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

test("Memory capture discard prevents later persistence", async () => {
  const memory = memoryPort();
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "proposal-4",
  });
  runtime.propose({
    content: "não salvar",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);

  assert.equal(runtime.discard("proposal-4"), true);
  await assert.rejects(
    () => runtime.confirm({
      schema: MEMORY_CAPTURE_CONFIRMATION_SCHEMA,
      authority: "explicit-user-confirmation",
      proposalId: "proposal-4",
      approved: true,
    }),
    /no longer pending/,
  );
  assert.equal(memory.remembered.length, 0);
});

test("Memory capture keeps proposal pending when durable flush fails", async () => {
  const remembered = [];
  const memory = {
    schema: MEMORY_PORT_SCHEMA,
    search() { return []; },
    remember(item) {
      remembered.push(item);
      return item;
    },
    forget() { return false; },
    async flush() { throw new Error("durability unavailable"); },
  };
  const runtime = createMemoryCaptureRuntime(memory, {
    idFactory: () => "proposal-5",
  });
  runtime.propose({
    content: "persistência deve ser confirmada",
    kind: "fact",
    provenance: "intelligence",
  }, accountAuthorization);

  await assert.rejects(
    () => runtime.confirm({
      schema: MEMORY_CAPTURE_CONFIRMATION_SCHEMA,
      authority: "explicit-user-confirmation",
      proposalId: "proposal-5",
      approved: true,
    }),
    /durability unavailable/,
  );
  assert.equal(remembered.length, 1);
  assert.notEqual(runtime.getPending("proposal-5"), null);
});

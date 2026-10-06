import assert from "node:assert/strict";
import test from "node:test";

import {
  WORK_COORDINATION_STORE_SCHEMA,
  assertWorkCoordinationStore,
  createEmptyWorkCoordinationStoreState,
} from "../system/contracts/work-coordination-store.mjs";
import {
  WORK_COORDINATION_NATIVE_RECORD_SCHEMA,
  createNativeWorkCoordinationStateTransport,
  createNativeWorkCoordinationStore,
} from "../system/adapters/native/work-coordination-state.mjs";

const PARTITION = Object.freeze({
  ownerKind: "account",
  ownerId: "user-1",
  projectId: "project-1",
});

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function nativeRecord(revision = 1, state = createEmptyWorkCoordinationStoreState(PARTITION)) {
  return {
    $schema: WORK_COORDINATION_NATIVE_RECORD_SCHEMA,
    revision,
    ownerKind: PARTITION.ownerKind,
    ownerId: PARTITION.ownerId,
    projectId: PARTITION.projectId,
    payload: JSON.stringify(state),
  };
}

test("Native Work coordination read binds owner and project in the same-origin request", async () => {
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push({ url, options });
      return responseJson({ record: nativeRecord() });
    },
  };
  const transport = createNativeWorkCoordinationStateTransport(windowRef);
  const record = await transport.read(PARTITION);

  assert.equal(record.revision, 1);
  assert.equal(record.state.ownerId, PARTITION.ownerId);
  assert.equal(record.state.projectId, PARTITION.projectId);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/__ordax\/native\/work-coordination-state\?/);
  assert.match(calls[0].url, /ownerKind=account/);
  assert.match(calls[0].url, /ownerId=user-1/);
  assert.match(calls[0].url, /projectId=project-1/);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
});

test("Native Work coordination CAS sends exact partition and revision binding", async () => {
  let request = null;
  const windowRef = {
    async fetch(url, options) {
      request = { url, options };
      return responseJson({ ok: true, revision: 1 });
    },
  };
  const transport = createNativeWorkCoordinationStateTransport(windowRef);
  const state = createEmptyWorkCoordinationStoreState(PARTITION);
  const result = await transport.compareAndSwap(PARTITION, 0, state);

  assert.deepEqual(result, { accepted: true, revision: 1 });
  assert.equal(request.url, "/__ordax/native/work-coordination-state");
  assert.equal(request.options.method, "POST");
  const body = JSON.parse(request.options.body);
  assert.equal(body.action, "compare-and-swap");
  assert.equal(body.ownerKind, PARTITION.ownerKind);
  assert.equal(body.ownerId, PARTITION.ownerId);
  assert.equal(body.projectId, PARTITION.projectId);
  assert.equal(body.expectedRevision, 0);
  assert.deepEqual(JSON.parse(body.payload), state);
});

test("Native Work coordination CAS exposes conflict instead of overwriting", async () => {
  const windowRef = {
    async fetch() {
      return responseJson({ error: "conflict" }, 409);
    },
  };
  const transport = createNativeWorkCoordinationStateTransport(windowRef);
  const result = await transport.compareAndSwap(
    PARTITION,
    2,
    createEmptyWorkCoordinationStoreState(PARTITION),
  );
  assert.deepEqual(result, { accepted: false, revision: null });
});

test("Native Work coordination store is accepted as CAS-only device store", () => {
  const windowRef = { async fetch() { throw new Error("not called"); } };
  const store = createNativeWorkCoordinationStore(windowRef);
  assert.equal(store.schema, WORK_COORDINATION_STORE_SCHEMA);
  assert.equal(store.scope, "device");
  assert.equal(assertWorkCoordinationStore(store), store);
  for (const alias of ["save", "set", "put", "write", "update", "replace", "delete", "remove"]) {
    assert.equal(typeof store[alias], "undefined");
  }
});

test("Native Work coordination response cannot cross owner or project partition", async () => {
  const foreignState = createEmptyWorkCoordinationStoreState({
    ownerKind: "account",
    ownerId: "user-1",
    projectId: "project-2",
  });
  const windowRef = {
    async fetch() {
      return responseJson({
        record: {
          ...nativeRecord(),
          projectId: "project-2",
          payload: JSON.stringify(foreignState),
        },
      });
    },
  };
  const transport = createNativeWorkCoordinationStateTransport(windowRef);
  await assert.rejects(() => transport.read(PARTITION), /record shape is invalid/);
});

test("Native Work coordination validates next CAS revision returned by host", async () => {
  const windowRef = {
    async fetch() {
      return responseJson({ ok: true, revision: 4 });
    },
  };
  const transport = createNativeWorkCoordinationStateTransport(windowRef);
  await assert.rejects(
    () => transport.compareAndSwap(
      PARTITION,
      1,
      createEmptyWorkCoordinationStoreState(PARTITION),
    ),
    /mutation response shape is invalid/,
  );
});

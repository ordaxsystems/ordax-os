import assert from "node:assert/strict";
import test from "node:test";

import { createNativeSyncCheckpointStore } from "../system/adapters/native/sync-checkpoint.mjs";

const CHECKPOINT = Object.freeze({
  subjectId: "account-a",
  cursor: 41,
  revisions: Object.freeze({
    "appearance/theme": 2,
    "preferences/surface": 3,
    "workspace/portable": 4,
  }),
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function okJson(value) {
  return Object.freeze({
    ok: true,
    status: 200,
    async json() {
      return value;
    },
  });
}

test("Native checkpoint flush waits for the durable POST before confirming", async () => {
  const post = deferred();
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push([url, options]);
      if (options.method === "GET") return okJson({ checkpoint: null });
      await post.promise;
      return Object.freeze({ ok: true, status: 200 });
    },
  };

  const store = await createNativeSyncCheckpointStore(windowRef);
  assert.equal(store.scope, "device");
  assert.equal(store.load(), null);
  assert.equal(store.save(CHECKPOINT), true);

  let settled = false;
  const flushing = store.flush().then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, "flush must not confirm before the Native POST completes");

  post.resolve();
  assert.equal(await flushing, true);
  assert.equal(settled, true);
  assert.equal(calls.filter(([, options]) => options.method === "POST").length, 1);
});

test("Native checkpoint flush fails closed after bounded retry when persistence rejects", async () => {
  let postCalls = 0;
  const windowRef = {
    async fetch(url, options) {
      if (options.method === "GET") return okJson({ checkpoint: null });
      postCalls += 1;
      return Object.freeze({ ok: false, status: 503 });
    },
  };

  const store = await createNativeSyncCheckpointStore(windowRef);
  store.save(CHECKPOINT);

  await assert.rejects(store.flush(), /Native sync checkpoint persistence failed: 503/);
  assert.equal(postCalls, 2, "flush retries the newest checkpoint once before failing closed");
});

test("Native checkpoint bursts persist only the newest staged checkpoint", async () => {
  const post = deferred();
  const payloads = [];
  let firstPost = true;
  const windowRef = {
    async fetch(url, options) {
      if (options.method === "GET") return okJson({ checkpoint: null });
      payloads.push(JSON.parse(options.body).checkpoint);
      if (firstPost) {
        firstPost = false;
        await post.promise;
      }
      return Object.freeze({ ok: true, status: 200 });
    },
  };

  const store = await createNativeSyncCheckpointStore(windowRef);
  store.save({ ...CHECKPOINT, cursor: 41 });
  await Promise.resolve();
  store.save({ ...CHECKPOINT, cursor: 42 });
  store.save({ ...CHECKPOINT, cursor: 43 });
  post.resolve();

  assert.equal(await store.flush(), true);
  assert.equal(payloads.at(-1).cursor, 43);
  assert.equal(payloads.some((item) => item.cursor === 42), false);
});

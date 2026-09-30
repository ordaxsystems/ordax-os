import assert from "node:assert/strict";
import test from "node:test";

import { createNativeSyncStateStore } from "../system/adapters/native/sync-state.mjs";

function response(status, payload = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function windowWithFetch(handler) {
  return { fetch: handler };
}

test("Native sync state flush confirms the exact accepted revision", async () => {
  const calls = [];
  const store = await createNativeSyncStateStore(windowWithFetch(async (url, options) => {
    calls.push([url, options]);
    if (options.method === "GET") return response(200, { payload: null });
    return response(204);
  }));

  assert.equal(store.scope, "device");
  assert.equal(store.save("state-a"), true);
  assert.equal(store.load(), "state-a");
  await store.flush();

  const posts = calls.filter(([, options]) => options.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0][1].body), { payload: "state-a" });
});

test("Native sync state flush retries the newest revision after a failed persistence attempt", async () => {
  let postAttempts = 0;
  const store = await createNativeSyncStateStore(windowWithFetch(async (_url, options) => {
    if (options.method === "GET") return response(200, { payload: null });
    postAttempts += 1;
    return response(postAttempts === 1 ? 503 : 204);
  }));

  store.save("state-a");
  await store.flush();

  assert.equal(postAttempts, 2);
  assert.equal(store.load(), "state-a");
  assert.equal(store.scope, "device");
});

test("Native sync state flush fails closed when the newest revision cannot become durable", async () => {
  let postAttempts = 0;
  const store = await createNativeSyncStateStore(windowWithFetch(async (_url, options) => {
    if (options.method === "GET") return response(200, { payload: null });
    postAttempts += 1;
    return response(503);
  }));

  store.save("state-a");
  await assert.rejects(store.flush(), /Native sync state persistence failed: 503/);
  assert.equal(postAttempts, 2);
  assert.equal(store.load(), "state-a");
});

test("Native sync state coalesces synchronous edits and persists only the newest snapshot", async () => {
  const bodies = [];
  const store = await createNativeSyncStateStore(windowWithFetch(async (_url, options) => {
    if (options.method === "GET") return response(200, { payload: null });
    bodies.push(JSON.parse(options.body));
    return response(204);
  }));

  store.save("state-a");
  store.save("state-b");
  store.save("state-c");
  await store.flush();

  assert.deepEqual(bodies, [{ payload: "state-c" }]);
  assert.equal(store.load(), "state-c");
});

test("a successful write can promote a boot-time session fallback back to device durability", async () => {
  let first = true;
  const store = await createNativeSyncStateStore(windowWithFetch(async (_url, options) => {
    if (options.method === "GET") {
      if (first) {
        first = false;
        throw new Error("loopback unavailable during boot");
      }
      return response(503);
    }
    return response(204);
  }));

  assert.equal(store.scope, "session");
  store.save("recovered-state");
  await store.flush();
  assert.equal(store.scope, "device");
});

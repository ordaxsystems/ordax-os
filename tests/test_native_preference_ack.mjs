import test from "node:test";
import assert from "node:assert/strict";

import { createNativePreferenceStore } from "../system/adapters/native/preferences.mjs";
import { createPreferenceRuntime } from "../system/services/preferences/runtime.mjs";

function fakeNativeHost() {
  const requests = [];
  const windowRef = {
    fetch(url, options) {
      assert.equal(url, "/__ordax/native/preferences");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.cache, "no-store");
      if (options.method === "GET") {
        return Promise.resolve({ ok: true, json: async () => ({ "appearance.theme": "light" }) });
      }
      assert.equal(options.method, "POST");
      return new Promise((resolve, reject) => {
        requests.push({ data: JSON.parse(options.body), resolve, reject });
      });
    },
  };
  return { windowRef, requests };
}

test("Native preference store saves serially and reports only host-confirmed durability", async () => {
  const { windowRef, requests } = fakeNativeHost();
  const store = await createNativePreferenceStore(windowRef);
  const first = store.save({ "appearance.theme": "dark" });
  const second = store.save({ "appearance.theme": "light" });
  assert.equal(first instanceof Promise, true);
  assert.deepEqual(store.load(), { "appearance.theme": "light" });
  await Promise.resolve();
  assert.equal(requests.length, 1, "second write must not overtake first");
  assert.deepEqual(requests[0].data, { "appearance.theme": "dark" });
  requests[0].resolve({ ok: false, status: 503 });
  assert.equal(await first, false);
  await Promise.resolve();
  assert.equal(requests.length, 2, "a failed POST does not poison later writes");
  assert.deepEqual(requests[1].data, { "appearance.theme": "light" });
  requests[1].resolve({ ok: true });
  assert.equal(await second, true);
  assert.deepEqual(store.load(), { "appearance.theme": "light" });
});

test("Native preference rejection is contained and leaves the latest choice in memory", async () => {
  const { windowRef, requests } = fakeNativeHost();
  const store = await createNativePreferenceStore(windowRef);
  const runtime = createPreferenceRuntime(store);
  runtime.set("appearance.theme", "dark");
  assert.equal(runtime.getPersistenceSnapshot(), "pending");
  assert.equal(runtime.getSnapshot()["appearance.theme"], "dark");
  await Promise.resolve();
  requests[0].reject(new Error("no write permission"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.getPersistenceSnapshot(), "session-only");
  assert.equal(runtime.getSnapshot()["appearance.theme"], "dark");
  runtime.set("appearance.theme", "light");
  assert.equal(runtime.getPersistenceSnapshot(), "pending");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  requests[1].resolve({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.getPersistenceSnapshot(), "saved");
  runtime.dispose();
});

test("Native runtime does not report a first save until the host acknowledges it", async () => {
  const { windowRef, requests } = fakeNativeHost();
  const store = await createNativePreferenceStore(windowRef);
  const runtime = createPreferenceRuntime(store);
  const observed = [];
  runtime.subscribe(() => observed.push(runtime.getPersistenceSnapshot()));
  runtime.set("appearance.theme", "dark");
  assert.deepEqual(observed, ["not-written", "pending"]);
  await Promise.resolve();
  requests[0].resolve({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observed, ["not-written", "pending", "saved"]);
  runtime.dispose();
});

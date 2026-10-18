import test from "node:test";
import assert from "node:assert/strict";

import { createNativePreferenceStore } from "../system/adapters/native/preferences.mjs";
import { createPreferenceRuntime } from "../system/services/preferences/runtime.mjs";
import { createNativeFirstRunStateStore } from "../system/adapters/native/first-run-state.mjs";
import { createInitialFirstRunState, persistFirstRunCompletion } from "../system/services/state/first-run.mjs";

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

test("First Run confirmation uses the existing Native store and waits for its actual ACK", async () => {
  const { windowRef, requests } = fakeNativeHost();
  const store = await createNativePreferenceStore(windowRef);
  const runtime = createPreferenceRuntime(store);
  runtime.set("regional.locale", "en-US");
  const ack = runtime.persistConfirmed();
  assert.equal(runtime.getPersistenceSnapshot(), "pending");
  await Promise.resolve();
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].data["regional.locale"], "en-US");
  requests[1].resolve({ ok: false, status: 507 });
  assert.equal(await ack, false);
  assert.equal(runtime.getPersistenceSnapshot(), "session-only");
  const retry = runtime.persistConfirmed();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(requests.length, 3);
  requests[2].resolve({ ok: true });
  assert.equal(await retry, true);
  assert.equal(runtime.getPersistenceSnapshot(), "saved");
  runtime.dispose();
});

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


// A Native runtime restart creates a new adapter and reads only the host's
// last committed snapshot. An unconfirmed session edit is never promoted.
test("Native preference state survives restart only after a confirmed host write", async () => {
  let disk = { "appearance.theme": "light" };
  let failNext = false;
  const requests = [];
  const windowRef = {
    async fetch(url, options) {
      assert.equal(url, "/__ordax/native/preferences");
      assert.equal(options.credentials, "same-origin");
      if (options.method === "GET") {
        return { ok: true, json: async () => ({ ...disk }) };
      }
      assert.equal(options.method, "POST");
      const record = JSON.parse(options.body);
      requests.push(record);
      if (failNext) {
        failNext = false;
        return { ok: false, status: 507 };
      }
      disk = { ...record };
      return { ok: true, status: 204 };
    },
  };

  const originalStore = await createNativePreferenceStore(windowRef);
  const original = createPreferenceRuntime(originalStore);
  assert.equal(original.getSnapshot()["appearance.theme"], "light");
  original.set("appearance.theme", "dark");
  assert.equal(original.getPersistenceSnapshot(), "pending");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(original.getPersistenceSnapshot(), "saved");
  original.dispose();

  const restartedStore = await createNativePreferenceStore(windowRef);
  const restarted = createPreferenceRuntime(restartedStore);
  assert.equal(restarted.getSnapshot()["appearance.theme"], "dark");
  assert.equal(restarted.getPersistenceSnapshot(), "not-written");

  failNext = true;
  restarted.set("appearance.theme", "light");
  assert.equal(restarted.getSnapshot()["appearance.theme"], "light");
  assert.equal(restarted.getPersistenceSnapshot(), "pending");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.getPersistenceSnapshot(), "session-only");
  assert.equal(disk["appearance.theme"], "dark", "failed POST cannot overwrite last confirmed value");
  restarted.dispose();

  const afterFailureStore = await createNativePreferenceStore(windowRef);
  const afterFailure = createPreferenceRuntime(afterFailureStore);
  assert.equal(afterFailure.getSnapshot()["appearance.theme"], "dark");
  afterFailure.set("appearance.theme", "light");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(afterFailure.getPersistenceSnapshot(), "saved");
  afterFailure.dispose();

  const finalStore = await createNativePreferenceStore(windowRef);
  const finalRuntime = createPreferenceRuntime(finalStore);
  assert.equal(finalRuntime.getSnapshot()["appearance.theme"], "light");
  assert.equal(finalRuntime.getPersistenceSnapshot(), "not-written");
  assert.equal(requests.length, 3);
  finalRuntime.dispose();
});

test("Native GET failure keeps the next Surface usable without fabricated durability", async () => {
  const windowRef = {
    async fetch(url, options) {
      assert.equal(url, "/__ordax/native/preferences");
      if (options.method === "GET") throw new Error("loopback host unavailable at startup");
      return { ok: false, status: 503 };
    },
  };
  const store = await createNativePreferenceStore(windowRef);
  const runtime = createPreferenceRuntime(store);
  assert.equal(runtime.getSnapshot()["appearance.theme"], "light");
  assert.equal(runtime.getPersistenceSnapshot(), "not-written");
  runtime.set("appearance.theme", "dark");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.getSnapshot()["appearance.theme"], "dark");
  assert.equal(runtime.getPersistenceSnapshot(), "session-only");
  runtime.dispose();
});

function durableFirstRunFakeHost() {
  const disk = {
    firstRun: createInitialFirstRunState(),
    preferences: { "regional.locale": "pt-BR", "regional.time-zone": "America/Bahia" },
  };
  const events = [];
  let rejectPreferences = false;
  let rejectReceipt = false;
  const windowRef = {
    async fetch(path, options) {
      const firstRun = path === "/__ordax/native/first-run";
      assert.ok(firstRun || path === "/__ordax/native/preferences");
      assert.equal(options.credentials, "same-origin");
      if (options.method === "GET") {
        return { ok: true, json: async () => structuredClone(firstRun ? disk.firstRun : disk.preferences) };
      }
      assert.equal(options.method, "POST");
      const parsed = JSON.parse(options.body);
      if (firstRun) {
        events.push("receipt");
        if (rejectReceipt) return { ok: false, status: 507 };
        disk.firstRun = parsed;
      } else {
        events.push("preferences");
        if (rejectPreferences) return { ok: false, status: 507 };
        disk.preferences = parsed;
      }
      return { ok: true, status: 204 };
    },
  };
  return {
    disk, events, windowRef,
    failPreferences(value) { rejectPreferences = value; },
    failReceipt(value) { rejectReceipt = value; },
  };
}

test("USB First Run refuses false completion when the actual Native preference POST fails", async () => {
  const host = durableFirstRunFakeHost();
  const store = await createNativeFirstRunStateStore(host.windowRef);
  const preferences = createPreferenceRuntime(await createNativePreferenceStore(host.windowRef));
  host.failPreferences(true);
  const draft = { locale: "en-US", timeZone: "America/Bahia", accountMode: "local-only" };
  await assert.rejects(
    persistFirstRunCompletion(store, preferences, draft),
    /not durably confirmed/,
  );
  assert.equal(host.disk.firstRun.completed, false);
  assert.equal(host.disk.preferences["regional.locale"], "pt-BR");
  assert.equal(host.events.includes("receipt"), false);
  preferences.dispose();

  // USB/Suface restart must not skip onboarding after a rejected ACK.
  const restarted = await createNativeFirstRunStateStore(host.windowRef);
  assert.equal(restarted.load().completed, false);
  const recoveredPreferences = createPreferenceRuntime(await createNativePreferenceStore(host.windowRef));
  host.failPreferences(false);
  await persistFirstRunCompletion(restarted, recoveredPreferences, draft);
  assert.equal(host.disk.firstRun.completed, true);
  assert.equal(host.disk.firstRun.accountMode, "local-only");
  assert.equal(host.disk.preferences["regional.locale"], "en-US");
  assert.equal(host.events.at(-1), "receipt", "the durable receipt commits after the last preference ACK");
  recoveredPreferences.dispose();
});

test("Native receipt I/O failure leaves the user in First Run with durable regional choices", async () => {
  const host = durableFirstRunFakeHost();
  const store = await createNativeFirstRunStateStore(host.windowRef);
  const preferences = createPreferenceRuntime(await createNativePreferenceStore(host.windowRef));
  host.failReceipt(true);
  const draft = { locale: "en-US", timeZone: "America/Bahia", accountMode: "local-only" };
  await assert.rejects(persistFirstRunCompletion(store, preferences, draft), /Native first-run persistence failed: 507/);
  assert.equal(store.load().completed, false);
  assert.equal(host.disk.firstRun.completed, false);
  assert.equal(host.disk.preferences["regional.locale"], "en-US");
  preferences.dispose();

  host.failReceipt(false);
  const restarted = await createNativeFirstRunStateStore(host.windowRef);
  const resumedPreferences = createPreferenceRuntime(await createNativePreferenceStore(host.windowRef));
  await persistFirstRunCompletion(restarted, resumedPreferences, draft);
  assert.equal(host.disk.firstRun.completed, true);
  assert.equal(host.disk.preferences["regional.locale"], "en-US");
  resumedPreferences.dispose();
});

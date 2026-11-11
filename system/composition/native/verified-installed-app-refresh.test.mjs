import test from "node:test";
import assert from "node:assert/strict";
import { createNativeVerifiedInstalledAppRefresh, verifiedCurrentInstallationFingerprint } from "./verified-installed-app-refresh.mjs";

const entry = (id, rev = 1) => ({ component: { id }, metadata: { revision: rev } });
const catalog = (entries) => ({ catalog: { ids: entries.map(x => x.component.id) }, installed: entries });

test("CURRENT changed: withdraw synchronously, destroy old, mount verified app", async () => {
  const published = [];
  const calls = [];
  const previous = { destroy: async () => calls.push("old-destroyed") };
  const controller = createNativeVerifiedInstalledAppRefresh({
    initialMounts: previous,
    discover: async () => [entry("calculator")],
    createCatalog: catalog,
    mount: async (entries) => {
      calls.push("mounted:" + entries[0].component.id);
      return { mountedIds: ["calculator"], destroy: async () => calls.push("new-destroyed") };
    },
    publish: x => published.push(x.ids),
  });
  const run = controller.refresh();
  assert.deepEqual(published, [[]], "launch authority withdrawn before asynchronous reads");
  await run;
  assert.deepEqual(calls, ["old-destroyed", "mounted:calculator"]);
  assert.deepEqual(published, [[], ["calculator"]]);
  await controller.destroy();
  assert.deepEqual(calls.slice(-1), ["new-destroyed"]);
});

test("superseded refresh cannot restore removed slot", async () => {
  const published = [];
  let releaseDiscovery;
  const blockedDiscovery = new Promise(resolve => { releaseDiscovery = resolve; });
  let reads = 0;
  const controller = createNativeVerifiedInstalledAppRefresh({
    discover: async () => ++reads === 1 ? blockedDiscovery : [],
    createCatalog: catalog,
    mount: async () => { throw Error("No module should be imported"); },
    publish: x => published.push(x.ids),
  });
  const first = controller.refresh();
  await new Promise(resolve => setImmediate(resolve));
  const second = controller.refresh();
  releaseDiscovery([entry("calculator")]);
  await Promise.all([first, second]);
  assert.deepEqual(published, [[], []]);
  await controller.destroy();
});

test("mount failures never produce a visible installed app", async () => {
  const published = [], errors = [];
  const controller = createNativeVerifiedInstalledAppRefresh({
    discover: async () => [entry("clock")],
    createCatalog: catalog,
    mount: async () => ({ mountedIds: [], destroy: async () => {} }),
    publish: x => published.push(x.ids),
    onError: e => errors.push(e.message),
  });
  await controller.refresh();
  assert.deepEqual(published, [[], []]);
  assert.deepEqual(errors, ["One or more verified CURRENT apps could not be mounted"],
    "missing mounts stay hidden and surface a retryable verification failure");
  await controller.destroy();
});


test("synchronous subscriber refresh destroys the prior mount rather than leaking it", async () => {
  let refreshed;
  let discoveries = 0;
  let activeDestroyCount = 0;
  const emitted = [];
  let controller;
  controller = createNativeVerifiedInstalledAppRefresh({
    discover: async () => (++discoveries === 1 ? [entry("calculator")] : []),
    createCatalog: catalog,
    mount: async (entries) => entries.length === 0
      ? { mountedIds: [], destroy: async () => {} }
      : {
          mountedIds: ["calculator"],
          destroy: async () => { activeDestroyCount += 1; },
        },
    publish: next => {
      emitted.push(next.ids);
      if (next.ids.includes("calculator")) {
        refreshed = controller.refresh(); // synchronous re-entry during publication
      }
    },
  });
  await controller.refresh();
  await refreshed;
  assert.deepEqual(emitted, [[], ["calculator"], [], []]);
  assert.equal(activeDestroyCount, 1, "withdrawn runtime must be destroyed once");
  await controller.destroy();
  assert.equal(activeDestroyCount, 1, "must not double-destroy withdrawn runtime");
});

test("reentrant Surface teardown waits until withdrawn component is actually destroyed", async () => {
  let unblock;
  let previousDestroyBegan = false;
  let previousDestroyed = false;
  const previous = {
    destroy() {
      previousDestroyBegan = true;
      return new Promise(resolve => {
        unblock = () => { previousDestroyed = true; resolve(); };
      });
    },
  };
  let controller;
  let closePromise;
  controller = createNativeVerifiedInstalledAppRefresh({
    initialMounts: previous,
    discover: async () => { throw Error("Destroyed controller must not discover again"); },
    createCatalog: values => ({ catalog: { ids: values.map(e => e.component.id) }, installed: values }),
    mount: async () => { throw Error("Destroyed controller must not mount again"); },
    publish(next) {
      if (next.ids.length === 0) closePromise = controller.destroy();
    },
  });
  const refreshPromise = controller.refresh();
  let closeSettled = false;
  closePromise.then(() => { closeSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(previousDestroyBegan, true, "withdrawal owns the prior component cleanup");
    assert.equal(closeSettled, false, "teardown must await actual component destruction");
  } finally {
    unblock?.();
    await Promise.all([closePromise, refreshPromise]);
  }
  assert.equal(previousDestroyed, true);
});

test("verified CURRENT identity only changes on observed activation, not Store notification order", () => {
  const installed = { componentId: "calculator", source: "slot", revision: 7,
    version: "1.0.0", sourceCommit: "a".repeat(40), entrypoint: "system/apps/calculator/main.mjs" };
  const absent = { componentId: "notes", source: "absent", revision: 2,
    version: null, sourceCommit: null, entrypoint: null };
  const key = verifiedCurrentInstallationFingerprint([installed, absent]);
  assert.equal(verifiedCurrentInstallationFingerprint([absent, installed]), key);
  assert.equal(verifiedCurrentInstallationFingerprint([{...installed}, {...absent}]), key);
  assert.equal(verifiedCurrentInstallationFingerprint([
    installed, {...absent, revision: 300},
  ]), key, "an absent app revision cannot remount the installed app");
  assert.equal(verifiedCurrentInstallationFingerprint([absent]), "[]",
    "absence alone never claims an installed runtime");
  assert.equal(verifiedCurrentInstallationFingerprint([installed]), key,
    "boot discovery and full Store observations agree on signed CURRENT slots");
  assert.notEqual(verifiedCurrentInstallationFingerprint([
    {...installed, source: "removed", version: null, sourceCommit: null, entrypoint: null, revision: 8}, absent,
  ]), key, "signed CURRENT removal must force reconciliation");
  assert.notEqual(verifiedCurrentInstallationFingerprint([
    {...installed, revision: 9}, absent,
  ]), key, "new activation generation must be reverified");
  assert.throws(() => verifiedCurrentInstallationFingerprint([null]), TypeError);
});

test("a failed CURRENT refresh can recover on the next verified notification", async () => {
  const emitted = [], errors = [];
  let attempts = 0;
  const controller = createNativeVerifiedInstalledAppRefresh({
    discover: async () => {
      if (++attempts === 1) throw Error("Native verifier temporarily unavailable");
      return [entry("calculator")];
    },
    createCatalog: catalog,
    mount: async () => ({mountedIds: ["calculator"], destroy: async () => {}}),
    publish: next => emitted.push(next.ids),
    onError: error => errors.push(error.message),
  });
  await controller.refresh();
  assert.deepEqual(emitted, [[]], "failed verifier cannot publish installed apps");
  assert.deepEqual(errors, ["Native verifier temporarily unavailable"]);
  await controller.refresh();
  assert.deepEqual(emitted, [[], [], ["calculator"]]);
  await controller.destroy();
});

test("partial Native CURRENT mount keeps healthy apps but retries missing mounts", async () => {
  const emitted = [], errors = [];
  let attempts = 0, disposed = 0;
  const controller = createNativeVerifiedInstalledAppRefresh({
    discover: async () => [entry("calculator"), entry("notes")],
    createCatalog: catalog,
    mount: async () => {
      attempts += 1;
      return {
        mountedIds: attempts === 1 ? ["calculator"] : ["calculator", "notes"],
        destroy: async () => { disposed += 1; },
      };
    },
    publish: next => emitted.push(next.ids),
    onError: error => errors.push(error.message),
  });
  await controller.refresh();
  assert.deepEqual(emitted, [[], ["calculator"]],
    "unmounted app must not get launch authority");
  assert.deepEqual(errors, ["One or more verified CURRENT apps could not be mounted"]);
  await controller.refresh();
  assert.deepEqual(emitted, [[], ["calculator"], [], ["calculator", "notes"]]);
  assert.equal(errors.length, 1, "successful retry must not report an error");
  await controller.destroy();
  assert.equal(disposed, 2, "each owned runtime is torn down exactly once");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createNativeVerifiedInstalledAppRefresh } from "./verified-installed-app-refresh.mjs";

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
  assert.deepEqual(errors, []);
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

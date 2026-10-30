import test from "node:test";
import assert from "node:assert/strict";
import { createNativeUpdateWatcher } from "../system/adapters/native/update-runtime.mjs";

const SHA = "a".repeat(40);
const TOKEN = "owner-dev-token-".padEnd(32, "z");

async function createHarness(available) {
  const calls = [];
  const windowRef = {
    async fetch(path, options = {}) {
      calls.push({ path, options });
      if (path === "/__ordax/native/update") {
        return {
          ok: true,
          async json() {
            return {
              sourceSha: SHA,
              status: "running",
              applyMode: "initial",
              manualCheckAvailable: available,
              manualCheckPending: false,
              manualCheckToken: available ? TOKEN : "",
            };
          },
        };
      }
      if (path === "/__ordax/native/update-check") {
        return {
          ok: true,
          status: 202,
          async json() {
            return { schema: "ordax.owner-manual-update-request/1", state: "queued" };
          },
        };
      }
      throw new Error("Unexpected endpoint");
    },
    location: { href: "http://127.0.0.1:8765/", reload() {}, replace() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const watcher = createNativeUpdateWatcher(windowRef);
  for (let i = 0; i < 8 && !watcher.getSnapshot(); i += 1) await Promise.resolve();
  assert.ok(watcher.getSnapshot(), "first native update poll");
  return { watcher, calls };
}

test("Owner USB requests canonical manual check once using same-origin token", async () => {
  const { watcher, calls } = await createHarness(true);
  try {
    assert.equal(watcher.getSnapshot().manualCheckAvailable, true);
    assert.equal("manualCheckToken" in watcher.getSnapshot(), false);
    assert.equal(await watcher.requestCheck(), "queued");
    const request = calls.filter((entry) => entry.path === "/__ordax/native/update-check");
    assert.equal(request.length, 1);
    assert.equal(request[0].options.method, "POST");
    assert.equal(request[0].options.credentials, "same-origin");
    assert.equal(request[0].options.headers["X-OrdaX-Update-Token"], TOKEN);
    assert.deepEqual(JSON.parse(request[0].options.body), { action: "check-main" });
  } finally {
    watcher.dispose();
  }
});

test("Stable or unsupported host cannot dispatch manual update", async () => {
  const { watcher, calls } = await createHarness(false);
  try {
    assert.equal(watcher.getSnapshot().manualCheckAvailable, false);
    await assert.rejects(watcher.requestCheck(), /unavailable/);
    assert.equal(calls.some((entry) => entry.path === "/__ordax/native/update-check"), false);
  } finally {
    watcher.dispose();
  }
});

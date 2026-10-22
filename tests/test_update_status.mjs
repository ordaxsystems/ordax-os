import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_STATUS_SCHEMA,
  assertUpdateStatusPort,
  validateUpdateStatusSnapshot,
} from "../system/contracts/update-status.mjs";
import {
  buildReloadUrl,
  createNativeUpdateWatcher,
  shouldReloadForUpdate,
} from "../system/adapters/native/update-runtime.mjs";

function fakeWindow() {
  return {
    async fetch() {
      return {
        ok: true,
        async json() {
          return {
            sourceSha: "0123456789012345678901234567890123456789",
            status: "running",
            applyMode: "initial",
          };
        },
      };
    },
    location: { href: "http://127.0.0.1:8765/composition/native/index.html?source=old", reload() {}, replace() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
}

test("update status contract normalizes optional fields", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    status: "running",
    applyMode: "initial",
  });
  assert.equal(snapshot.bootRefreshRequired, false);
  assert.equal(snapshot.baseUpdatePhase, "none");
  assert.equal(snapshot.baseUpdateSha, "");
  assert.equal(snapshot.deliveryNumber, 0);
  assert.equal(snapshot.versionNumber, 0);
  assert.equal(snapshot.lastApplyDurationSeconds, 0);
  assert.equal(snapshot.lastStageDurationSeconds, 0);
  assert.equal(snapshot.runtimeSurfaceSha, snapshot.sourceSha);
  assert.equal(snapshot.targetSha, "");
  assert.equal(snapshot.phase, "idle");
  assert.equal(snapshot.attemptId, "");
  assert.equal(snapshot.checkedAt, "unknown");
  assert.equal(snapshot.lastAppliedSha, "");
  assert.equal(snapshot.rejectedSha, "");
  assert.equal(snapshot.lastError, "");
  assert.equal(snapshot.healthToken, "");
});

test("update status preserves runtime-effective Surface identity separately from Git HEAD", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeSurfaceSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    status: "running",
    applyMode: "none",
  });
  assert.equal(snapshot.sourceSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(snapshot.runtimeSurfaceSha, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("update status preserves human version and bounded durations", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    deliveryNumber: 124,
    status: "running",
    applyMode: "reload",
    lastApplyDurationSeconds: 5,
    lastStageDurationSeconds: 0,
  });
  assert.equal(snapshot.deliveryNumber, 124);
  assert.equal(snapshot.versionNumber, 124);
  assert.equal(snapshot.lastApplyDurationSeconds, 5);
  assert.equal(snapshot.lastStageDurationSeconds, 0);
});

test("update status preserves transaction context", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    targetSha: "abcdef0123456789abcdef0123456789abcdef01",
    status: "applied",
    phase: "health-wait",
    applyMode: "reload",
    attemptId: "2026-09-18T09:10:00Z",
    lastError: "health-check-pending",
  });
  assert.equal(snapshot.targetSha, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(snapshot.phase, "health-wait");
  assert.equal(snapshot.attemptId, "2026-09-18T09:10:00Z");
  assert.equal(snapshot.lastError, "health-check-pending");
});

test("update status preserves explicit Base pipeline progress", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    status: "running",
    applyMode: "none",
    bootRefreshRequired: true,
    baseUpdatePhase: "activation-ready",
    baseUpdateSha: "abcdef0123456789abcdef0123456789abcdef01",
  });
  assert.equal(snapshot.baseUpdatePhase, "activation-ready");
  assert.equal(snapshot.baseUpdateSha, "abcdef0123456789abcdef0123456789abcdef01");
});

test("boot refresh without a new Base phase remains backward compatible", () => {
  const snapshot = validateUpdateStatusSnapshot({
    sourceSha: "0123456789012345678901234567890123456789",
    status: "running",
    applyMode: "none",
    bootRefreshRequired: true,
  });
  assert.equal(snapshot.baseUpdatePhase, "waiting-candidate");
});

test("update status rejects unknown Base pipeline phase", () => {
  assert.throws(
    () => validateUpdateStatusSnapshot({
      sourceSha: "0123456789012345678901234567890123456789",
      status: "running",
      applyMode: "none",
      bootRefreshRequired: true,
      baseUpdatePhase: "mystery-base-phase",
    }),
    TypeError,
  );
});

test("update status rejects unknown transaction phase", () => {
  assert.throws(
    () => validateUpdateStatusSnapshot({
      sourceSha: "0123456789012345678901234567890123456789",
      status: "running",
      phase: "mystery",
      applyMode: "none",
    }),
    TypeError,
  );
});

test("update status rejects missing runtime identity", () => {
  assert.throws(
    () => validateUpdateStatusSnapshot({ status: "running", applyMode: "initial" }),
    TypeError,
  );
});

test("native update watcher implements neutral update status port", () => {
  const watcher = createNativeUpdateWatcher(fakeWindow(), { intervalMs: 1 });
  assert.equal(watcher.schema, UPDATE_STATUS_SCHEMA);
  assert.equal(assertUpdateStatusPort(watcher), watcher);
  watcher.dispose();
});

test("native update watcher polls less often at idle and publishes only changes", async () => {
  const scheduled = [];
  const sourceSha = "a".repeat(40);
  const update = {
    sourceSha,
    status: "running",
    phase: "idle",
    applyMode: "initial",
  };
  let reads = 0;
  const observed = [];
  const windowRef = {
    async fetch() {
      reads += 1;
      return { ok: true, async json() { return { ...update }; } };
    },
    location: { href: "http://127.0.0.1:8765/", reload() {}, replace() {} },
    setTimeout(callback, delay) {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeout() {},
  };
  const watcher = createNativeUpdateWatcher(windowRef, {
    intervalMs: 750,
    idleIntervalMs: 3000,
    onState: (value) => observed.push(value),
  });
  const notifications = [];
  const unsubscribe = watcher.subscribe((value) => notifications.push(value));
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  try {
    await flush();
    assert.equal(reads, 1);
    assert.equal(scheduled[0].delay, 3000);
    assert.equal(observed.length, 1);
    assert.equal(notifications.length, 1);

    scheduled[0].callback();
    await flush();
    assert.equal(reads, 2);
    assert.equal(scheduled[1].delay, 3000);
    assert.equal(observed.length, 1, "unchanged status must not rebroadcast");
    assert.equal(notifications.length, 1);

    update.phase = "checking";
    scheduled[1].callback();
    await flush();
    assert.equal(scheduled[2].delay, 750);
    assert.equal(observed.length, 2, "active state change must reach listeners");

    update.phase = "idle";
    update.manualCheckPending = true;
    scheduled[2].callback();
    await flush();
    assert.equal(scheduled[3].delay, 750, "manual checks remain responsive");
    assert.equal(observed.length, 3);
    assert.equal(watcher.getSnapshot().manualCheckPending, true);
  } finally {
    unsubscribe();
    watcher.dispose();
  }
});

test("disposed native update watcher ignores a late asynchronous response", async () => {
  const sourceSha = "a".repeat(40);
  let release;
  let reloads = 0;
  let broadcasts = 0;
  let scheduled = 0;
  const windowRef = {
    fetch() { return new Promise((resolve) => { release = resolve; }); },
    location: { href: "http://127.0.0.1:8765/", reload() { reloads += 1; } },
    setTimeout() { scheduled += 1; return scheduled; },
    clearTimeout() {},
  };
  const watcher = createNativeUpdateWatcher(windowRef, {
    onState() { broadcasts += 1; },
  });
  watcher.dispose();
  release({
    ok: true,
    async json() {
      return { sourceSha, status: "applied", applyMode: "reload" };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broadcasts, 0);
  assert.equal(reloads, 0);
  assert.equal(scheduled, 0);
});

test("native reload URL carries target SHA and bounded retry marker", () => {
  const url = buildReloadUrl(
    "http://127.0.0.1:8765/composition/native/index.html?source=old#surface",
    "abcdef0123456789abcdef0123456789abcdef01",
    3,
  );
  assert.equal(
    url,
    "http://127.0.0.1:8765/composition/native/index.html?source=abcdef0123456789abcdef0123456789abcdef01&ordax_reload=3#surface",
  );
});

test("native reload URL replaces prior retry marker instead of growing forever", () => {
  const url = buildReloadUrl(
    "http://127.0.0.1:8765/composition/native/index.html?source=old&ordax_reload=2",
    "0123456789012345678901234567890123456789",
    4,
  );
  assert.match(url, /source=0123456789012345678901234567890123456789/);
  assert.match(url, /ordax_reload=4/);
  assert.equal((url.match(/ordax_reload=/g) ?? []).length, 1);
});

test("runtime-neutral checkout advancement does not suppress the next live reload", () => {
  const docsSha = "3333333333333333333333333333333333333333";
  const targetSha = "4444444444444444444444444444444444444444";
  assert.equal(
    shouldReloadForUpdate(docsSha, {
      sourceSha: targetSha,
      status: "applied",
      applyMode: "reload",
    }),
    true,
  );
});

test("native update watcher never acknowledges a SHA different from the rendered page", async () => {
  const calls = [];
  const renderedSha = "1111111111111111111111111111111111111111";
  const checkoutSha = "2222222222222222222222222222222222222222";
  const windowRef = {
    async fetch(path, options = {}) {
      calls.push({ path, options });
      if (path === "/__ordax/native/update") {
        return {
          ok: true,
          async json() {
            return {
              sourceSha: checkoutSha,
              status: "running",
              applyMode: "none",
              healthToken: "token",
            };
          },
        };
      }
      return { ok: true };
    },
    location: {
      href: `http://127.0.0.1:8765/composition/native/index.html?source=${renderedSha}`,
      reload() {},
      replace() {},
    },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const watcher = createNativeUpdateWatcher(windowRef, { intervalMs: 1 });
  await watcher.markHealthy();
  await Promise.resolve();
  assert.equal(
    calls.filter((call) => call.path === "/__ordax/native/health").length,
    0,
  );
  watcher.dispose();
});

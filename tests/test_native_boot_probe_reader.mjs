import assert from "node:assert/strict";
import test from "node:test";

import { createNativeBootProbeReader } from "../system/adapters/native/boot-probe-reader.mjs";
import { createNativeNetworkStatus } from "../system/adapters/native/network-status.mjs";
import { createNativePowerStatus } from "../system/adapters/native/power-status.mjs";
import { createNativeSystemMetrics } from "../system/adapters/native/system-metrics.mjs";
import { createNativeRecoveryStatus } from "../system/adapters/native/recovery-status.mjs";

test("initial Native read is reused once, then all reads hit the host", async () => {
  let calls = 0;
  let at = 100;
  const read = createNativeBootProbeReader(async () => ({ number: ++calls }), {
    now: () => at,
    maxAgeMs: 3000,
  });
  assert.deepEqual(await read(), { number: 1 });
  at = 3100;
  assert.deepEqual(await read(), { number: 1 }, "fresh boundary reuses initial proof");
  assert.deepEqual(await read(), { number: 2 }, "cache cannot hide later changes");
  assert.deepEqual(await read(), { number: 3 });
});

test("expired boot probe cannot hide a changed endpoint", async () => {
  let calls = 0;
  let at = 10;
  const read = createNativeBootProbeReader(async () => ++calls, {
    now: () => at,
    maxAgeMs: 3000,
  });
  assert.equal(await read(), 1);
  at = 3011;
  assert.equal(await read(), 2);
  assert.equal(await read(), 3);
});

test("fresh abort-capable reads bypass bootstrap reuse", async () => {
  let calls = 0;
  let seenSignal = null;
  const read = createNativeBootProbeReader(async (options) => {
    calls += 1;
    seenSignal = options.signal ?? null;
    return calls;
  });
  assert.equal(await read(), 1);
  const controller = new AbortController();
  assert.equal(await read({ signal: controller.signal }), 2);
  assert.equal(seenSignal, controller.signal);
  assert.equal(await read(), 3);
});

test("failed first probe does not invent an available Native capability", async () => {
  let calls = 0;
  const read = createNativeBootProbeReader(async () => {
    calls += 1;
    if (calls === 1) throw new Error("unavailable");
    return { checked: true };
  });
  await assert.rejects(read(), /unavailable/);
  assert.deepEqual(await read(), { checked: true });
  assert.deepEqual(await read(), { checked: true });
  assert.equal(calls, 2);
});

test("bootstrap reuse parameters are bounded", () => {
  assert.throws(() => createNativeBootProbeReader(null), TypeError);
  assert.throws(() => createNativeBootProbeReader(() => {}, { maxAgeMs: 10001 }), TypeError);
  assert.throws(() => createNativeBootProbeReader(() => {}, { maxAgeMs: -1 }), TypeError);
});

test("Native status adapters validate the first host read and avoid its immediate duplicate", async () => {
  const variants = [
    {
      path: "/__ordax/native/network-status",
      create: createNativeNetworkStatus,
      data: { interfaces: [{ name: "wlan0", kind: "wifi", state: "connected", signalDbm: -65 }] },
    },
    {
      path: "/__ordax/native/power-status",
      create: createNativePowerStatus,
      data: { battery: { percent: 82, state: "discharging" }, externalPower: false },
    },
    {
      path: "/__ordax/native/metrics",
      create: createNativeSystemMetrics,
      data: {
        uptimeSeconds: 42, memoryTotalBytes: 1024, memoryAvailableBytes: 512,
        userStorageTotalBytes: 2048, userStorageFreeBytes: 1024,
      },
    },
    {
      path: "/__ordax/native/recovery-status",
      create: createNativeRecoveryStatus,
      data: {
        layout: "portable-v2", bootSlot: "current",
        runningSourceSha: "a".repeat(40), currentSha: "a".repeat(40),
        knownGoodSha: "b".repeat(40), candidateSha: null,
        transactionPresent: false, recoveryEntryStatus: "verified",
        policy: "local-read-only", automaticNetwork: false, automaticMutation: false,
      },
    },
  ];
  for (const { path, create, data } of variants) {
    const urls = [];
    const windowRef = {
      async fetch(url) {
        urls.push(url);
        assert.equal(url, path);
        return { ok: true, json: async () => data };
      },
    };
    const port = await create(windowRef);
    assert.deepEqual(urls, [path], "mandatory startup capability check");
    const first = await port.read();
    assert.ok(Object.isFrozen(first), "first reused sample remains validated");
    assert.equal(urls.length, 1, "first UI read must reuse the validated boot probe");
    await port.read();
    assert.equal(urls.length, 2, "later UI read must fetch a fresh value");
  }
});

test("Native boot endpoint errors and invalid snapshots still fail capability creation", async () => {
  const networkUnavailable = {
    async fetch() { return { ok: false, status: 503 }; },
  };
  await assert.rejects(createNativeNetworkStatus(networkUnavailable), /503/);
  const powerInvalid = {
    async fetch() {
      return { ok: true, json: async () => ({ battery: { percent: 999, state: "charging" } }) };
    },
  };
  await assert.rejects(createNativePowerStatus(powerInvalid), TypeError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAccountConnectivityRecovery } from "../system/services/account/connectivity-recovery.mjs";

const disconnected = Object.freeze({
  interfaces: [{ name: "wlan0", kind: "wifi", state: "disconnected", signalDbm: null }],
});
const connected = Object.freeze({
  interfaces: [{ name: "wlan0", kind: "wifi", state: "connected", signalDbm: -56 }],
});

test("USB session automatically refreshes after a real native link reconnect", async () => {
  let state = "unavailable";
  let instant = 1000;
  let calls = 0;
  const recovery = createAccountConnectivityRecovery({
    readIdentityState: () => state,
    refresh: async () => { calls++; state = "signed-out"; },
    now: () => instant,
  });
  assert.equal(await recovery.observe(disconnected), false);
  assert.equal(calls, 0);
  assert.equal(await recovery.observe(connected), true);
  assert.equal(calls, 1);
  instant += 31000;
  assert.equal(await recovery.observe(connected), false);
  assert.equal(calls, 1);
  recovery.dispose();
});

test("stale and unknown link observations never authorize a network retry", async () => {
  let count = 0;
  const recovery = createAccountConnectivityRecovery({
    readIdentityState: () => "unavailable",
    refresh: async () => count++,
  });
  const unknown = { interfaces: [{ name: "eth0", kind: "ethernet", state: "unknown" }] };
  assert.equal(await recovery.observe(unknown), false);
  assert.equal(await recovery.observe({ interfaces: [] }), false);
  assert.equal(count, 0);
  await assert.rejects(recovery.observe({ interfaces: [{ name: "../invalid", kind: "wifi", state: "connected" }] }), /Network interface name/);
  recovery.dispose();
});

test("offline Gateway retry is bounded while identity stays unavailable", async () => {
  let now = 100;
  let attempts = 0;
  const recovery = createAccountConnectivityRecovery({
    readIdentityState: () => "unavailable",
    refresh: async () => { attempts++; },
    now: () => now,
  });
  assert.equal(await recovery.observe(connected), true);
  assert.equal(await recovery.observe(connected), false);
  now += 29999;
  assert.equal(await recovery.observe(connected), false);
  now++;
  assert.equal(await recovery.observe(connected), true);
  assert.equal(attempts, 2);
});

test("concurrent observations never run two Account refreshes", async () => {
  let finish;
  let started = 0;
  const recovery = createAccountConnectivityRecovery({
    readIdentityState: () => "unavailable",
    refresh: async () => { started++; await new Promise(resolve => { finish = resolve; }); },
  });
  const inFlight = recovery.observe(connected);
  assert.equal(await recovery.observe(connected), false);
  assert.equal(started, 1);
  finish();
  assert.equal(await inFlight, true);
});

test("rejected gateway attempts remain fail-closed and can recover after interval", async () => {
  let now = 0;
  let fails = true;
  let completed = false;
  const recovery = createAccountConnectivityRecovery({
    readIdentityState: () => completed ? "signed-out" : "unavailable",
    refresh: async () => {
      if (fails) throw new Error("canonical HTTPS Gateway unavailable");
      completed = true;
    },
    now: () => now,
  });
  await assert.rejects(recovery.observe(connected), /Gateway unavailable/);
  assert.equal(await recovery.observe(connected), false);
  now = 30000;
  fails = false;
  assert.equal(await recovery.observe(connected), true);
  assert.equal(await recovery.observe(connected), false);
  recovery.dispose();
  assert.equal(await recovery.observe(connected), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readDesktopNetworkStatus } from "../system/adapters/desktop/network-status.mjs";
import { NETWORK_STATUS_SCHEMA, validateNetworkStatusSnapshot } from "../system/contracts/network-status.mjs";

test("Windows desktop network status uses the canonical port schema", () => {
  const result = readDesktopNetworkStatus({ readInterfaces: () => ({
    "Wi-Fi": [{ internal: false, family: "IPv4", address: "192.0.2.17" }],
    "Ethernet 2": [{ internal: true, family: "IPv4", address: "127.0.0.1" }],
  }) });
  assert.deepEqual(result, validateNetworkStatusSnapshot(result));
  assert.equal(NETWORK_STATUS_SCHEMA, "ordax.network-status/1");
  assert.deepEqual(result.interfaces, [
    { name: "Wi-Fi", kind: "other", state: "connected", signalDbm: null },
    { name: "Ethernet-2", kind: "other", state: "unknown", signalDbm: null },
  ]);
});

test("Desktop adapter does not fabricate link health or Wi-Fi signal", () => {
  const result = readDesktopNetworkStatus({ readInterfaces: () => ({
    "Disconnected adapter": [],
    "Virtual adapter": [{ internal: false, family: "IPv6", address: "2001:db8::1" }],
  }) });
  assert.deepEqual(result.interfaces, [
    { name: "Virtual-adapter", kind: "other", state: "connected", signalDbm: null },
  ]);
});

test("Desktop adapter bounds and validates names consistently with the product contract", () => {
  const result = readDesktopNetworkStatus({ readInterfaces: () => ({
    "Interface @ 1": [{ internal: false, family: "IPv4" }],
    "Interface - 1": [{ internal: false, family: "IPv4" }],
    ["x".repeat(50)]: [{ internal: true, family: "IPv4" }],
  }) });
  assert.equal(result.interfaces.length, 3);
  assert.equal(new Set(result.interfaces.map(i => i.name)).size, 3);
  assert.ok(result.interfaces.every(i => i.name.length <= 32));
  assert.throws(() => readDesktopNetworkStatus({ readInterfaces: () => null }), TypeError);
});

test("Desktop network adapter cannot promote non-IP data into connectivity", () => {
  const result = readDesktopNetworkStatus({ readInterfaces: () => ({
    Ethernet: [{ internal: false, family: "unknown" }],
  }) });
  assert.equal(result.interfaces[0].state, "unknown");
});

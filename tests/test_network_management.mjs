import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MANAGEMENT_SCHEMA,
  WifiCredentialsValidationError,
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
  validateWifiCredentials,
} from "../system/contracts/network-management.mjs";

test("network management validates bounded Wi-Fi snapshots", () => {
  const snapshot = validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: "Casa",
    savedSsid: "Casa",
    networks: [
      { ssid: "Casa", signalDbm: -42, security: "wpa-psk", connected: true, saved: true },
      { ssid: "Escritório", signalDbm: -61, security: "wpa-psk", connected: false, saved: false },
    ],
  });
  assert.equal(snapshot.networks.length, 2);
  assert.equal(snapshot.currentSsid, "Casa");
  assert.ok(Object.isFrozen(snapshot.networks));
});

test("network management credentials stay input-only", () => {
  const credentials = validateWifiCredentials({ ssid: "Casa", password: "segredo123" });
  assert.equal(credentials.password, "segredo123");
  const snapshot = validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: null,
    savedSsid: "Casa",
    networks: [],
    password: "must-not-cross-snapshot",
  });
  assert.equal("password" in snapshot, false);
});

test("network management rejects duplicates and invalid credentials", () => {
  assert.throws(() => validateWifiCredentials({ ssid: "Casa", password: "curta" }), WifiCredentialsValidationError);
  assert.throws(() => validateWifiCredentials({ ssid: "", password: "12345678" }), WifiCredentialsValidationError);
  assert.throws(() => validateNetworkManagementSnapshot({
    wifiInterface: "wlan0",
    currentSsid: null,
    savedSsid: null,
    networks: [
      { ssid: "Casa", signalDbm: -40, security: "wpa-psk" },
      { ssid: "Casa", signalDbm: -50, security: "wpa-psk" },
    ],
  }));
});

test("network management enforces real SSID and WPA passphrase byte limits", () => {
  assert.doesNotThrow(() => validateWifiCredentials({ ssid: "á".repeat(16), password: "12345678" }));
  assert.throws(() => validateWifiCredentials({ ssid: "á".repeat(17), password: "12345678" }));
  assert.throws(() => validateWifiCredentials({ ssid: "Casa", password: "x".repeat(64) }));
  assert.throws(() => validateWifiCredentials({ ssid: "Casa", password: "senha\ninvalida" }));
});

test("native network adapter reports safe WPA/DHCP failures without exposing secrets", async () => {
  const { createNativeNetworkManagement } = await import("../system/adapters/native/network-management.mjs");
  const snapshot = { wifiInterface: "wlan0", currentSsid: null, savedSsid: null, networks: [] };
  let reason = "dhcp-failed";
  const fakeWindow = {
    fetch: async (url, options) => {
      if (url === "/__ordax/native/session") {
        return { ok: true, json: async () => ({ networkToken: "012345678901234567890123456789ab" }) };
      }
      if (options.method === "GET") return { ok: true, json: async () => snapshot };
      return { ok: false, status: reason === "network-owner-unavailable" ? 503 : 409,
        json: async () => ({ reason, password: "PRIVATE_VALUE" }) };
    },
  };
  const port = await createNativeNetworkManagement(fakeWindow);
  for (const [nextReason, expected] of [["dhcp-failed", "dhcp-failed"],
    ["network-owner-unavailable", "network-owner-unavailable"],
    ["untrusted-secret", undefined]]) {
    reason = nextReason;
    await assert.rejects(port.connect({ ssid: "Casa", password: "validpassword" }), (error) => {
      assert.equal(error.networkReason, expected);
      assert.equal(JSON.stringify(error).includes("PRIVATE_VALUE"), false);
      return true;
    });
  }
});

test("network management port has explicit bounded actions", () => {
  const port = {
    schema: NETWORK_MANAGEMENT_SCHEMA,
    status() {},
    scan() {},
    connect() {},
    disconnect() {},
    forget() {},
    reconnect() {},
  };
  assert.equal(assertNetworkManagementPort(port), port);
  assert.equal("shell" in port, false);
});

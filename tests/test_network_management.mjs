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
      return { ok: false, status: reason === "dhcp-failed" || reason === "untrusted-secret" ? 409 : 503,
        json: async () => ({ reason, password: "PRIVATE_VALUE" }) };
    },
  };
  const port = await createNativeNetworkManagement(fakeWindow);
  for (const [nextReason, expected] of [["dhcp-failed", "dhcp-failed"],
    ["network-owner-unavailable", "network-owner-unavailable"],
    ["network-broker-unavailable", "network-broker-unavailable"],
    ["network-broker-timeout", "network-broker-timeout"],
    ["network-broker-io-failed", "network-broker-io-failed"],
    ["wifi-tools-unavailable", "wifi-tools-unavailable"],
    ["no-wifi-interface", "no-wifi-interface"],
    ["credential-save-failed", "credential-save-failed"],
    ["untrusted-secret", undefined]]) {
    reason = nextReason;
    await assert.rejects(port.connect({ ssid: "Casa", password: "validpassword" }), (error) => {
      assert.equal(error.networkReason, expected);
      assert.equal(JSON.stringify(error).includes("PRIVATE_VALUE"), false);
      return true;
    });
  }
});

test("Native Wi-Fi reconnects to a rotated host grant without repeating accepted writes", async () => {
  const { createNativeNetworkManagement } = await import("../system/adapters/native/network-management.mjs");
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const snapshot = { wifiInterface: "wlan0", currentSsid: null, savedSsid: null, networks: [] };
  let hostToken = a;
  let sessionReads = 0;
  let accepted = 0;
  const requests = [];
  const fakeWindow = {
    fetch: async (url, options) => {
      if (url === "/__ordax/native/session") {
        sessionReads += 1;
        return { ok: true, json: async () => ({ networkToken: hostToken }) };
      }
      requests.push({ method: options.method, token: options.headers["X-OrdaX-Network-Token"] });
      if (options.headers["X-OrdaX-Network-Token"] !== hostToken) {
        return { ok: false, status: 403 };
      }
      if (options.method === "GET") return { ok: true, json: async () => snapshot };
      accepted += 1;
      return { ok: true, json: async () => snapshot };
    },
  };
  const port = await createNativeNetworkManagement(fakeWindow);
  hostToken = b; // Native host restarted after First Run loaded its network port.
  await port.connect({ ssid: "Casa", password: "validpassword" });
  assert.equal(sessionReads, 2);
  assert.equal(accepted, 1);
  assert.deepEqual(requests.slice(-2).map((entry) => entry.token), [a, b]);

  await port.reconnect();
  assert.equal(sessionReads, 2, "refreshed grant remains shared by subsequent actions");
  assert.equal(accepted, 2);
});

test("Native Wi-Fi never retries a denied action without a rotated token", async () => {
  const { createNativeNetworkManagement } = await import("../system/adapters/native/network-management.mjs");
  const token = "a".repeat(64);
  const snapshot = { wifiInterface: "wlan0", currentSsid: null, savedSsid: null, networks: [] };
  let postRequests = 0;
  const fakeWindow = {
    fetch: async (url, options) => {
      if (url === "/__ordax/native/session") {
        return { ok: true, json: async () => ({ networkToken: token }) };
      }
      if (options.method === "GET") return { ok: true, json: async () => snapshot };
      postRequests += 1;
      return { ok: false, status: 403 };
    },
  };
  const port = await createNativeNetworkManagement(fakeWindow);
  await assert.rejects(port.connect({ ssid: "Casa", password: "validpassword" }), (error) => {
    assert.equal(error.status, 403);
    return true;
  });
  assert.equal(postRequests, 1, "403 with the same token must remain denied");
});

test("Native Wi-Fi does not replay a rejected WPA/DHCP broker action", async () => {
  const { createNativeNetworkManagement } = await import("../system/adapters/native/network-management.mjs");
  const token = "a".repeat(64);
  const snapshot = { wifiInterface: "wlan0", currentSsid: null, savedSsid: null, networks: [] };
  let postRequests = 0;
  let sessionReads = 0;
  const fakeWindow = {
    fetch: async (url, options) => {
      if (url === "/__ordax/native/session") {
        sessionReads += 1;
        return { ok: true, json: async () => ({ networkToken: token }) };
      }
      if (options.method === "GET") return { ok: true, json: async () => snapshot };
      postRequests += 1;
      return { ok: false, status: 409, json: async () => ({ reason: "authentication-failed" }) };
    },
  };
  const port = await createNativeNetworkManagement(fakeWindow);
  await assert.rejects(port.connect({ ssid: "Casa", password: "validpassword" }), (error) => {
    assert.equal(error.networkReason, "authentication-failed");
    return true;
  });
  assert.equal(postRequests, 1);
  assert.equal(sessionReads, 1);
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

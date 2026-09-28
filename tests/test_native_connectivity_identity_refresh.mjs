import test from "node:test";
import assert from "node:assert/strict";

import { NETWORK_CONNECTIVITY_ESTABLISHED_EVENT } from "../system/contracts/connectivity-signal.mjs";
import { createNativeNetworkManagement } from "../system/adapters/native/network-management.mjs";
import { createWebIdentitySession } from "../system/adapters/web/identity.mjs";

class FakeEvent {
  constructor(type) {
    this.type = type;
  }
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

function createIntegratedWindow() {
  const listeners = new Map();
  let identityOnline = false;
  let identityFetchCount = 0;
  let currentSsid = null;
  let savedSsid = null;

  const networkSnapshot = () => ({
    wifiInterface: "wlan0",
    currentSsid,
    savedSsid,
    networks: [
      {
        ssid: "Casa",
        signalDbm: -42,
        security: "wpa-psk",
        connected: currentSsid === "Casa",
        saved: savedSsid === "Casa",
      },
    ],
  });

  const windowRef = {
    Event: FakeEvent,
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener(event);
      return true;
    },
    async fetch(url, options = {}) {
      if (url === "/auth/session") {
        identityFetchCount += 1;
        if (!identityOnline) throw new Error("offline");
        return response({
          $schema: "prototype-ordax.public-identity-session/1",
          authenticated: true,
          provider: "supabase",
          status: "authenticated",
          subject: "user-123",
          email: "pessoa@example.com",
        });
      }

      if (url === "/__ordax/native/session") {
        return response({ networkToken: "network-token-1234567890" });
      }

      if (url === "/__ordax/native/network-management") {
        if ((options.method ?? "GET") === "GET") return response(networkSnapshot());
        const payload = JSON.parse(options.body ?? "{}");
        switch (payload.action) {
          case "scan":
            break;
          case "connect":
            currentSsid = payload.ssid;
            savedSsid = payload.ssid;
            identityOnline = true;
            break;
          case "disconnect":
            currentSsid = null;
            break;
          case "forget":
            currentSsid = null;
            savedSsid = null;
            break;
          case "reconnect":
            currentSsid = savedSsid;
            identityOnline = currentSsid !== null;
            break;
          default:
            throw new Error(`Unexpected network action: ${payload.action}`);
        }
        return response(networkSnapshot());
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
    identityFetchCount() {
      return identityFetchCount;
    },
  };

  return windowRef;
}

async function settleAsyncListeners() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("successful native Wi-Fi connect refreshes identity without exposing network secrets", async () => {
  const windowRef = createIntegratedWindow();
  const identity = createWebIdentitySession(windowRef);
  await identity.refresh();
  assert.equal(identity.getSnapshot().state, "unavailable");
  assert.equal(windowRef.identityFetchCount(), 1);

  const network = await createNativeNetworkManagement(windowRef);
  let eventCount = 0;
  let observedEvent = null;
  windowRef.addEventListener(NETWORK_CONNECTIVITY_ESTABLISHED_EVENT, (event) => {
    eventCount += 1;
    observedEvent = event;
  });

  await network.scan();
  await settleAsyncListeners();
  assert.equal(eventCount, 0);
  assert.equal(windowRef.identityFetchCount(), 1);

  await network.connect({ ssid: "Casa", password: "segredo123" });
  await settleAsyncListeners();

  assert.equal(eventCount, 1);
  assert.equal(windowRef.identityFetchCount(), 2);
  assert.deepEqual(identity.getSnapshot(), {
    state: "signed-in",
    subjectId: "user-123",
    displayName: "pessoa",
  });
  assert.deepEqual(Object.keys(observedEvent), ["type"]);
  assert.equal(observedEvent.type, NETWORK_CONNECTIVITY_ESTABLISHED_EVENT);
  assert.equal(JSON.stringify(observedEvent).includes("Casa"), false);
  assert.equal(JSON.stringify(observedEvent).includes("segredo123"), false);

  await network.disconnect();
  await settleAsyncListeners();
  assert.equal(eventCount, 1);
  assert.equal(windowRef.identityFetchCount(), 2);

  await network.reconnect();
  await settleAsyncListeners();
  assert.equal(eventCount, 2);
  assert.equal(windowRef.identityFetchCount(), 3);

  await network.forget();
  await settleAsyncListeners();
  assert.equal(eventCount, 2);
  assert.equal(windowRef.identityFetchCount(), 3);

  identity.dispose();
  windowRef.dispatchEvent(new FakeEvent(NETWORK_CONNECTIVITY_ESTABLISHED_EVENT));
  await settleAsyncListeners();
  assert.equal(windowRef.identityFetchCount(), 3);
});

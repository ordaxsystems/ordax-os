import assert from "node:assert/strict";
import test from "node:test";

import { readNativeSession, NATIVE_SESSION_ENDPOINT } from "../system/adapters/native/session-read.mjs";
import { createNativePowerActions } from "../system/adapters/native/power-actions.mjs";
import { createNativeNetworkManagement } from "../system/adapters/native/network-management.mjs";
import { createNativeDisplayOutputs } from "../system/adapters/native/display-outputs.mjs";
import { createNativeClientDiagnostics } from "../system/adapters/native/client-diagnostics.mjs";

const sessionPayload = () => ({
  token: "p".repeat(32), supportedActions: ["restart", "shutdown"],
  networkToken: "n".repeat(24),
  displayOutputsToken: "d".repeat(24),
  diagnosticToken: "x".repeat(24),
});

test("four Native boot adapters share one in-flight session read, not their capability checks", async () => {
  let release;
  let sessionReads = 0;
  const requests = [];
  const windowRef = {
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (url === NATIVE_SESSION_ENDPOINT) {
        sessionReads += 1;
        await new Promise((resolve) => { release = resolve; });
        return { ok: true, status: 200, json: async () => sessionPayload() };
      }
      if (url === "/__ordax/native/network-management") {
        return { ok: true, json: async () => ({
          wifiInterface: "wlan0", networks: [], currentSsid: null, savedSsid: null,
        }) };
      }
      if (url === "/__ordax/native/display-outputs") {
        return { ok: true, json: async () => ({
          schema: "ordax.display-outputs/1", available: false,
          reason: "host-unavailable", outputs: [], preview: null,
        }) };
      }
      if (url === "/__ordax/native/power") return { ok: true, status: 202 };
      if (url === "/__ordax/native/client-diagnostic") return { ok: true, status: 202 };
      throw new Error("unexpected Native Host endpoint: " + url);
    },
  };
  const boot = Promise.all([
    createNativePowerActions(windowRef),
    createNativeNetworkManagement(windowRef),
    createNativeDisplayOutputs(windowRef),
    createNativeClientDiagnostics(windowRef),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionReads, 1, "only one identical session GET is in flight");
  release();
  const [power, network, display, diagnostics] = await boot;
  assert.deepEqual(power.getSnapshot().supportedActions, ["restart", "shutdown"]);
  assert.equal((await network.status()).wifiInterface, "wlan0");
  assert.equal((await display.read()).available, false);
  assert.equal(typeof diagnostics.report, "function");
  assert.equal(sessionReads, 1, "each capability still has its own validation and transport");
  await power.execute("restart");
  assert.equal(requests.find((r) => r.url === "/__ordax/native/power").options.headers["X-OrdaX-Power-Token"], "p".repeat(32));
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
});

test("completed Native sessions do not persist: sequential reads obtain new host session", async () => {
  let calls = 0;
  const windowRef = {
    async fetch(url) {
      assert.equal(url, NATIVE_SESSION_ENDPOINT);
      return { ok: true, status: 200, json: async () => ({ generation: ++calls }) };
    },
  };
  const first = await readNativeSession(windowRef);
  const second = await readNativeSession(windowRef);
  assert.equal(calls, 2);
  assert.equal(first.payload.generation, 1);
  assert.equal(second.payload.generation, 2);
});

test("HTTP failures and malformed session JSON fail closed and do not poison retries", async () => {
  let calls = 0;
  const windowRef = {
    async fetch() {
      calls += 1;
      if (calls === 1) return { ok: false, status: 403 };
      if (calls === 2) return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad-json"); } };
      return { ok: true, status: 200, json: async () => sessionPayload() };
    },
  };
  const denied = await Promise.all([readNativeSession(windowRef), readNativeSession(windowRef)]);
  assert.equal(calls, 1);
  assert.deepEqual(denied.map((v) => v.status), [403, 403]);
  await assert.rejects(readNativeSession(windowRef), SyntaxError);
  assert.equal(calls, 2);
  const recovered = await readNativeSession(windowRef);
  assert.equal(calls, 3);
  assert.equal(recovered.payload.token, "p".repeat(32));
});

test("Native session single-flight never merges different host windows", async () => {
  let reads = 0;
  const createWindow = () => ({
    async fetch() {
      reads += 1;
      return { ok: true, status: 200, json: async () => sessionPayload() };
    },
  });
  await Promise.all([readNativeSession(createWindow()), readNativeSession(createWindow())]);
  assert.equal(reads, 2);
});

test("a missing capability token remains unavailable even if another session token is valid", async () => {
  const windowRef = {
    async fetch(url) {
      if (url === NATIVE_SESSION_ENDPOINT) {
        return { ok: true, status: 200, json: async () => ({
          token: "p".repeat(32), supportedActions: ["shutdown"],
          displayOutputsToken: "d".repeat(24),
        }) };
      }
      if (url === "/__ordax/native/display-outputs") {
        return { ok: true, json: async () => ({
          schema: "ordax.display-outputs/1", available: false,
          reason: "host-unavailable", outputs: [], preview: null,
        }) };
      }
      throw new Error("unexpected request");
    },
  };
  const [power, network, display, diagnostics] = await Promise.allSettled([
    createNativePowerActions(windowRef),
    createNativeNetworkManagement(windowRef),
    createNativeDisplayOutputs(windowRef),
    createNativeClientDiagnostics(windowRef),
  ]);
  assert.equal(power.status, "fulfilled");
  assert.equal(display.status, "fulfilled");
  assert.equal(network.status, "rejected");
  assert.match(network.reason.message, /network token is unavailable/);
  assert.equal(diagnostics.status, "rejected");
  assert.match(diagnostics.reason.message, /diagnostic token is unavailable/);
});

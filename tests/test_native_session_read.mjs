import assert from "node:assert/strict";
import test from "node:test";

import { readNativeSession, NATIVE_SESSION_ENDPOINT } from "../system/adapters/native/session-read.mjs";
import { createNativePowerActions } from "../system/adapters/native/power-actions.mjs";
import { createNativeNetworkManagement } from "../system/adapters/native/network-management.mjs";
import { createNativeDisplayOutputs } from "../system/adapters/native/display-outputs.mjs";
import { createNativeAudioOutputs } from "../system/adapters/native/audio-outputs.mjs";
import { createNativeClientDiagnostics } from "../system/adapters/native/client-diagnostics.mjs";

const sessionPayload = () => ({
  token: "p".repeat(32), supportedActions: ["restart", "shutdown"],
  networkToken: "n".repeat(24),
  displayOutputsToken: "d".repeat(24),
  audioOutputsToken: "a".repeat(24),
  diagnosticToken: "x".repeat(24),
});

test("Native boot adapters share one in-flight session read, not their capability checks", async () => {
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
      if (url === "/__ordax/native/audio-outputs") {
        return { ok: true, json: async () => ({
          schema: "ordax.audio-outputs/1", available: false,
          reason: "provider-missing", defaultOutputId: null, outputs: [],
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
    createNativeAudioOutputs(windowRef),
    createNativeClientDiagnostics(windowRef),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sessionReads, 1, "only one identical session GET is in flight");
  release();
  const [power, network, display, audio, diagnostics] = await boot;
  assert.deepEqual(power.getSnapshot().supportedActions, ["restart", "shutdown"]);
  assert.equal((await network.status()).wifiInterface, "wlan0");
  assert.equal((await display.read()).available, false);
  assert.equal((await audio.read()).available, false);
  assert.equal(typeof diagnostics.report, "function");
  assert.equal(sessionReads, 1, "each capability still has its own validation and transport");
  await power.execute("restart");
  assert.equal(requests.find((r) => r.url === "/__ordax/native/power").options.headers["X-OrdaX-Power-Token"], "p".repeat(32));
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
  const audioRequest = requests.find((r) => r.url === "/__ordax/native/audio-outputs");
  assert.equal(audioRequest.options.credentials, "same-origin");
  assert.equal(audioRequest.options.headers["X-OrdaX-Audio-Token"], "a".repeat(24));
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
      if (url === "/__ordax/native/audio-outputs") {
        return { ok: true, json: async () => ({
          schema: "ordax.audio-outputs/1", available: false,
          reason: "provider-missing", defaultOutputId: null, outputs: [],
        }) };
      }
      throw new Error("unexpected request");
    },
  };
  const [power, network, display, audio, diagnostics] = await Promise.allSettled([
    createNativePowerActions(windowRef),
    createNativeNetworkManagement(windowRef),
    createNativeDisplayOutputs(windowRef),
    createNativeAudioOutputs(windowRef),
    createNativeClientDiagnostics(windowRef),
  ]);
  assert.equal(power.status, "fulfilled");
  assert.equal(display.status, "fulfilled");
  assert.equal(audio.status, "rejected");
  assert.match(audio.reason.message, /audio output token is unavailable/);
  assert.equal(network.status, "rejected");
  assert.match(network.reason.message, /network token is unavailable/);
  assert.equal(diagnostics.status, "rejected");
  assert.match(diagnostics.reason.message, /diagnostic token is unavailable/);
});

test("Windows display port survives an initial transient 503 and retries only when Settings reads", async () => {
  let readCount = 0;
  const seen = [];
  const windowRef = {
    async fetch(url, options = {}) {
      seen.push({url, options});
      if (url === NATIVE_SESSION_ENDPOINT) {
        return {ok:true,status:200,json:async()=>({
          displayOutputsToken:"d".repeat(64),
        })};
      }
      assert.equal(url,"/__ordax/native/display-outputs");
      readCount++;
      if (readCount === 1) return {ok:false,status:503};
      return {ok:true,status:200,json:async()=>({
        schema:"ordax.display-outputs/1",
        available:true,reason:null,preview:null,
        outputs:[{id:"DISPLAY1",name:"Windows DISPLAY1",enabled:true,
          modes:[{id:"1920x1080@60",width:1920,height:1080,
            refreshHz:60,current:true,preferred:false}]}],
      })};
    },
  };
  const port=await createNativeDisplayOutputs(windowRef,{deferInitialRead:true});
  assert.equal(port.schema,"ordax.display-outputs/1");
  assert.equal(readCount,0,"bootstrap does not enumerate the physical display");
  await assert.rejects(()=>port.read(),/request failed: 503/);
  assert.equal((await port.read()).outputs[0].currentModeId,"1920x1080@60");
  assert.equal(readCount,2,"physical display data is never simulated or cached");
  assert.ok(seen.filter(item=>item.url==="/__ordax/native/display-outputs")
    .every(item=>item.options.headers["X-OrdaX-Display-Token"]==="d".repeat(64)));
});

test("Linux still probes display at bootstrap and Windows scope is explicit", async () => {
  let readCount=0;
  const windowRef={
    async fetch(url){
      if(url===NATIVE_SESSION_ENDPOINT)return {ok:true,status:200,
        json:async()=>({displayOutputsToken:"d".repeat(64)})};
      readCount++;
      return {ok:false,status:503};
    },
  };
  await assert.rejects(()=>createNativeDisplayOutputs(windowRef),/request failed: 503/);
  assert.equal(readCount,1);
  const {readFileSync}=await import("node:fs");
  const composition=readFileSync(new URL("../system/composition/native/main.mjs",import.meta.url),"utf8");
  assert.match(composition,/createNativeDisplayOutputs\(window, \{\s*deferInitialRead: windowsDesktopHost,/);
  assert.ok(!composition.includes("setInterval(() => createNativeDisplayOutputs"),
    "display bootstrap must not introduce a second polling owner");
});

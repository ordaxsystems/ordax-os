import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA } from "../system/services/intelligence/native-service.mjs";
import { createNativeHostWindow } from "./support/native-host-window.mjs";
import {
  NATIVE_INTELLIGENCE_HOST_READY_TYPE,
  NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT,
  NATIVE_INTELLIGENCE_HOST_RESULT_TYPE,
  installNativeIntelligenceHostBridge,
} from "../system/composition/native/intelligence-host-bridge.mjs";

const subjectId = "subject-1";
const spaceId = "space-1";
const nonce = "n".repeat(43);

function identityPort() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => ({ state: "signed-in", subjectId, displayName: "User" }),
    subscribe: () => () => {},
  };
}

function spacePort() {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: () => ({
      schema: SPACE_SELECTION_SCHEMA,
      state: "selected",
      subjectId,
      selectedSpace: {
        id: spaceId,
        name: "Workspace",
        kind: "work",
        state: "active",
        ownerId: subjectId,
        profilePack: null,
      },
    }),
    subscribe: () => () => {},
    select() {},
    clear() {},
  };
}

function intelligencePort({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "ready",
      inferenceAvailable: true,
      engineId: "engine-test",
      modelId: "model-test",
      authority: "none",
      toolExecution: false,
    }),
    subscribe: () => () => {},
    async respond(request) {
      calls.push(request);
      if (fail) throw new Error("provider detail must not cross host bridge");
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "Resposta",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
      };
    },
  };
}

function serviceRequest() {
  return {
    schema: NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA,
    requestId: "request-1",
    context: { subjectId, spaceId, projectId: null },
    request: {
      intent: "ask",
      prompt: "Qual e o estado?",
      context: [],
      maxTokens: 512,
    },
  };
}

function fakeWindow() {
  const listeners = new Map();
  const messages = [];
  const { windowRef } = createNativeHostWindow({
    onPostMessage(value) {
      messages.push(JSON.parse(value));
    },
  });
  return {
    ...windowRef,
    messages,
    addEventListener(type, listener) {
      if (listeners.has(type)) throw new Error(`duplicate listener ${type}`);
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    async emit(type, detail) {
      const listener = listeners.get(type);
      if (listener) await listener({ detail });
    },
    has(type) {
      return listeners.has(type);
    },
  };
}

test("Native Intelligence host bridge announces readiness only after installing the final service listener", async () => {
  const windowRef = fakeWindow();
  const intelligence = intelligencePort();
  const bridge = installNativeIntelligenceHostBridge({
    windowRef,
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });

  assert.equal(windowRef.has(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT), true);
  assert.deepEqual(windowRef.messages, [{ type: NATIVE_INTELLIGENCE_HOST_READY_TYPE }]);

  await windowRef.emit(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, {
    nonce,
    request: serviceRequest(),
  });

  assert.equal(intelligence.calls.length, 1);
  assert.equal(windowRef.messages.length, 2);
  const result = windowRef.messages[1];
  assert.equal(result.type, NATIVE_INTELLIGENCE_HOST_RESULT_TYPE);
  assert.equal(result.nonce, nonce);
  assert.equal(result.requestId, "request-1");
  assert.equal(result.ok, true);
  assert.equal(result.response.requestId, "request-1");
  assert.equal(result.response.response.authority, "none");

  bridge.dispose();
  assert.equal(windowRef.has(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT), false);
});

test("Native Intelligence host bridge reports failures as unknown without leaking internal error text", async () => {
  const windowRef = fakeWindow();
  installNativeIntelligenceHostBridge({
    windowRef,
    intelligencePort: intelligencePort({ fail: true }),
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });

  await windowRef.emit(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, {
    nonce,
    request: serviceRequest(),
  });

  const result = windowRef.messages.at(-1);
  assert.deepEqual(result, {
    type: NATIVE_INTELLIGENCE_HOST_RESULT_TYPE,
    nonce,
    requestId: "request-1",
    ok: false,
    outcome: "unknown",
    error: "unavailable",
  });
  assert.doesNotMatch(JSON.stringify(result), /provider detail/);
});

test("Native Intelligence host bridge ignores malformed host correlation instead of guessing a reply", async () => {
  const windowRef = fakeWindow();
  const intelligence = intelligencePort();
  installNativeIntelligenceHostBridge({
    windowRef,
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });
  const readyCount = windowRef.messages.length;

  await windowRef.emit(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, {
    nonce: "short",
    request: serviceRequest(),
  });

  assert.equal(windowRef.messages.length, readyCount);
  assert.equal(intelligence.calls.length, 0);
});

test("Native composition wires exactly one host bridge over selectedSpaceIntelligence and keeps transport semantics out of Python", async () => {
  const [composition, bridge, host, ipc] = await Promise.all([
    readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/intelligence-host-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/runtime/native_intelligence_ipc.py", import.meta.url), "utf8"),
  ]);

  assert.equal((composition.match(/installNativeIntelligenceHostBridge\(\{/g) ?? []).length, 1);
  const fabricMount = composition.indexOf("nativeCapabilityDiscovery = createCapabilityDiscovery({");
  const hostReady = composition.indexOf("nativeIntelligenceHostBridge = hasNativeHostBridge(window)");
  assert.ok(fabricMount >= 0 && hostReady > fabricMount,
    "Native Intelligence must not announce ready before Fabric mounting");
  assert.match(composition, /nativeIntelligenceHostBridge\?\.dispose\(\)/,
    "pagehide must release the Native Intelligence listener");
  assert.match(composition, /intelligencePort: selectedSpaceIntelligence/);
  assert.match(composition, /identitySessionPort: identitySession/);
  assert.match(composition, /spaceSelectionPort: spaceSelection/);
  assert.doesNotMatch(composition, /intelligencePort: (?:localAi|intelligenceRuntime)/);

  assert.match(bridge, /createNativeIntelligenceService/);
  assert.doesNotMatch(bridge, /fetch\(|apiKey|OPENAI|xAI|model-router|local-ai|llama|Qwen/);
  assert.match(host, /NativeIntelligenceIpcServer/);
  assert.match(host, /ordax-native-intelligence-request/);
  assert.match(host, /intelligence\.host\.ready/);
  assert.match(host, /intelligence\.host\.result/);
  assert.match(host, /LoadEvent\.STARTED/);
  assert.match(host, /suspend_intelligence_listener/);
  assert.doesNotMatch(host, /createNativeIntelligenceService|createIntelligenceRuntime|model-router|llama|Qwen/);
  assert.doesNotMatch(ipc, /AF_INET|SOCK_DGRAM|http:\/\/|https:\/\/|apiKey|OPENAI|xAI|model-router|llama|Qwen/);
  assert.match(ipc, /AF_UNIX/);
  assert.match(ipc, /os\.chmod\(self\.socket_path, 0o600\)/);
});

test("Native Intelligence bridge never posts a late success or failure after page teardown", async () => {
  for (const fail of [false, true]) {
    const windowRef = fakeWindow();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const intelligence = intelligencePort();
    intelligence.respond = async () => {
      await gate;
      if (fail) throw new Error("stale model output must not cross teardown");
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "stale private response",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
      };
    };
    const bridge = installNativeIntelligenceHostBridge({
      windowRef,
      intelligencePort: intelligence,
      identitySessionPort: identityPort(),
      spaceSelectionPort: spacePort(),
    });
    const inflight = windowRef.emit(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, {
      nonce,
      request: serviceRequest(),
    });
    bridge.dispose();
    bridge.dispose();
    assert.equal(windowRef.has(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT), false);
    release();
    await inflight;
    assert.deepEqual(windowRef.messages, [{ type: NATIVE_INTELLIGENCE_HOST_READY_TYPE }],
      "a detached Native Surface must receive neither an old result nor a stale failure");
  }
});

test("Native host drops A-B-A account and Space inference and releases live port subscriptions", async () => {
  for (const source of ["account", "space"]) {
    const identitySubscribers = new Set();
    const spaceSubscribers = new Set();
    let identityState = { state: "signed-in", subjectId, displayName: "User" };
    let spaceState = spacePort().getSnapshot();
    const identity = {
      ...identityPort(),
      getSnapshot: () => identityState,
      subscribe(listener) {
        identitySubscribers.add(listener);
        return () => identitySubscribers.delete(listener);
      },
    };
    const spaces = {
      ...spacePort(),
      getSnapshot: () => spaceState,
      subscribe(listener) {
        spaceSubscribers.add(listener);
        return () => spaceSubscribers.delete(listener);
      },
    };
    const windowRef = fakeWindow();
    let started;
    const began = new Promise(resolve => { started = resolve; });
    let release;
    const gated = new Promise(resolve => { release = resolve; });
    const intelligence = {
      ...intelligencePort(),
      async respond() {
        started();
        await gated;
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "An answer from the old context",
          engineId: "engine-test",
          modelId: "model-test",
          authority: "none",
        };
      },
    };
    const bridge = installNativeIntelligenceHostBridge({
      windowRef,
      intelligencePort: intelligence,
      identitySessionPort: identity,
      spaceSelectionPort: spaces,
    });
    assert.equal(identitySubscribers.size, 1);
    assert.equal(spaceSubscribers.size, 1);
    const inFlight = windowRef.emit(NATIVE_INTELLIGENCE_HOST_REQUEST_EVENT, {
      nonce,
      request: serviceRequest(),
    });
    await began;
    if (source === "account") {
      identityState = { state: "signed-in", subjectId: "other-user", displayName: "Other" };
      for (const listener of identitySubscribers) listener(identityState);
      identityState = { state: "signed-in", subjectId, displayName: "User" };
      for (const listener of identitySubscribers) listener(identityState);
    } else {
      spaceState = {
        ...spaceState,
        selectedSpace: { ...spaceState.selectedSpace, id: "space-2" },
      };
      for (const listener of spaceSubscribers) listener(spaceState);
      spaceState = spacePort().getSnapshot();
      for (const listener of spaceSubscribers) listener(spaceState);
    }
    release();
    await inFlight;
    assert.deepEqual(windowRef.messages[1], {
      type: NATIVE_INTELLIGENCE_HOST_RESULT_TYPE,
      nonce,
      requestId: "request-1",
      ok: false,
      outcome: "unknown",
      error: "unavailable",
    }, "a restored visible context must not publish the old answer");
    bridge.dispose();
    assert.equal(identitySubscribers.size, 0);
    assert.equal(spaceSubscribers.size, 0);
  }
});

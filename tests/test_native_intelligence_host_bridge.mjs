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
  return {
    messages,
    webkit: {
      messageHandlers: {
        ordaxBrowser: {
          postMessage(value) {
            messages.push(JSON.parse(value));
          },
        },
      },
    },
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
  assert.doesNotMatch(host, /createNativeIntelligenceService|createIntelligenceRuntime|model-router|llama|Qwen/);
  assert.doesNotMatch(ipc, /AF_INET|SOCK_DGRAM|http:\/\/|https:\/\/|apiKey|OPENAI|xAI|model-router|llama|Qwen/);
  assert.match(ipc, /AF_UNIX/);
  assert.match(ipc, /os\.chmod\(self\.socket_path, 0o600\)/);
});

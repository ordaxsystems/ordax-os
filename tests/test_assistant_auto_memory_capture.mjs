import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { MEMORY_CAPTURE_RUNTIME_SCHEMA } from "../system/services/memory/capture.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../system/contracts/preference-runtime.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  createAssistantAutoCaptureRuntime,
} from "../system/services/memory/assistant-auto-capture.mjs";

function intelligence(answer) {
  const requests = [];
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests,
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() { return () => {}; },
    async respond(request) {
      requests.push(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: answer,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

function captureRuntime() {
  const calls = [];
  return {
    schema: MEMORY_CAPTURE_RUNTIME_SCHEMA,
    calls,
    async capture(draft, authorization) {
      calls.push({ draft, authorization });
      return { durable: true, item: { id: "m-" + calls.length } };
    },
  };
}

function preferences(enabled = true) {
  return {
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return { "memory.auto-capture": enabled ? "on" : "off" };
    },
    subscribe() { return () => {}; },
    set() {},
    reset() {},
  };
}

function identity(state = "signed-out", subjectId = null) {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return state === "signed-in"
        ? { state, subjectId, displayName: "Test User" }
        : { state, subjectId: null, displayName: null };
    },
    subscribe() { return () => {}; },
  };
}

function selection(state = "unavailable", subjectId = null, spaceId = null) {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      if (state === "selected") {
        return {
          schema: SPACE_SELECTION_SCHEMA,
          state,
          subjectId,
          selectedSpace: {
            id: spaceId,
            ownerId: subjectId,
            name: "Space",
            kind: "professional",
            state: "active",
            profilePack: null,
          },
        };
      }
      return {
        schema: SPACE_SELECTION_SCHEMA,
        state,
        subjectId: state === "unavailable" ? null : subjectId,
        selectedSpace: null,
      };
    },
    subscribe() { return () => {}; },
    select() {},
    clear() {},
  };
}

test("automatic Assistant Memory skips extraction when user disabled capture", async () => {
  const ai = intelligence('{"memories":[{"kind":"fact","content":"x"}]}');
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(false),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.captureTurn({ userText: "olá", assistantText: "oi" });
  assert.equal(result.status, "disabled");
  assert.equal(ai.requests.length, 0);
  assert.equal(capture.calls.length, 0);
});

test("signed-out automatic capture uses device ownership and forces private sensitivity", async () => {
  const ai = intelligence('{"memories":[{"kind":"preference","content":"Prefere respostas curtas."}]}');
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity("signed-out"),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.captureTurn({
    userText: "Prefiro respostas curtas.",
    assistantText: "Certo.",
  });
  assert.equal(result.status, "captured");
  assert.equal(result.captured, 1);
  assert.deepEqual(capture.calls[0].authorization, {
    schema: "ordax.memory-capture-auth/1",
    authority: "composition",
    ownerKind: "device",
    ownerId: null,
    scope: "device",
    spaceId: null,
  });
  assert.equal(capture.calls[0].draft.sensitivity, "private");
  assert.equal(capture.calls[0].draft.provenance, "ordax-assistant:auto-capture");
});

test("signed-in capture uses account unless an exact selected Space is active", async () => {
  const answer = '{"memories":[{"kind":"fact","content":"Trabalha com direito empresarial."}]}';

  const accountCapture = captureRuntime();
  const accountRuntime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(answer),
    captureRuntime: accountCapture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity("signed-in", "user-1"),
    spaceSelectionPort: selection("unselected", "user-1"),
  });
  await accountRuntime.captureTurn({ userText: "u", assistantText: "a" });
  assert.equal(accountCapture.calls[0].authorization.scope, "account");
  assert.equal(accountCapture.calls[0].authorization.ownerId, "user-1");

  const spaceCapture = captureRuntime();
  const spaceRuntime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(answer),
    captureRuntime: spaceCapture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity("signed-in", "user-1"),
    spaceSelectionPort: selection("selected", "user-1", "space-a"),
  });
  await spaceRuntime.captureTurn({ userText: "u", assistantText: "a" });
  assert.equal(spaceCapture.calls[0].authorization.scope, "space");
  assert.equal(spaceCapture.calls[0].authorization.spaceId, "space-a");
});

test("model output cannot choose owner scope ids sensitivity or extra fields", async () => {
  const bad = [
    '{"memories":[{"kind":"fact","content":"x","ownerId":"other"}]}',
    '{"memories":[{"kind":"fact","content":"x","scope":"space"}]}',
    '{"memories":[{"kind":"fact","content":"x","sensitivity":"normal"}]}',
    '{"memories":[{"kind":"fact","content":"x","id":"forced"}]}',
  ];
  for (const answer of bad) {
    const capture = captureRuntime();
    const runtime = createAssistantAutoCaptureRuntime({
      intelligencePort: intelligence(answer),
      captureRuntime: capture,
      preferenceRuntime: preferences(true),
      identitySessionPort: identity(),
      spaceSelectionPort: selection(),
    });
    const result = await runtime.captureTurn({ userText: "u", assistantText: "a" });
    assert.equal(result.status, "no-candidates");
    assert.equal(capture.calls.length, 0);
  }
});

test("invalid JSON and credential-like candidates fail closed", async () => {
  for (const answer of [
    "not json",
    "~~~json\n{\"memories\":[]}\n~~~",
    '{"memories":[{"kind":"fact","content":"Minha senha é 1234"}]}',
    '{"memories":[{"kind":"fact","content":"API key abc"}]}',
  ]) {
    const capture = captureRuntime();
    const runtime = createAssistantAutoCaptureRuntime({
      intelligencePort: intelligence(answer),
      captureRuntime: capture,
      preferenceRuntime: preferences(true),
      identitySessionPort: identity(),
      spaceSelectionPort: selection(),
    });
    const result = await runtime.captureTurn({ userText: "u", assistantText: "a" });
    assert.equal(result.status, "no-candidates");
    assert.equal(capture.calls.length, 0);
  }
});

test("extractor is bounded to four candidates and exact schema", async () => {
  const five = JSON.stringify({
    memories: Array.from({ length: 5 }, (_, i) => ({ kind: "fact", content: "f-" + i })),
  });
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(five),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });
  const result = await runtime.captureTurn({ userText: "u", assistantText: "a" });
  assert.equal(result.status, "no-candidates");
  assert.equal(capture.calls.length, 0);
});


test("Native composition creates Assistant Memory capture only after Surface preferences exist", () => {
  const native = readFileSync(
    new URL("../system/composition/native/main.mjs", import.meta.url),
    "utf8",
  );
  const surfaceIndex = native.indexOf("const surface = mountSurface(");
  const captureIndex = native.indexOf("const assistantMemoryCapture =");
  const assistantIndex = native.indexOf('componentId: "assistant"');
  assert.ok(surfaceIndex >= 0);
  assert.ok(captureIndex > surfaceIndex);
  assert.ok(assistantIndex > captureIndex);
  assert.match(
    native.slice(captureIndex, assistantIndex),
    /surface\.preferences/,
  );
});

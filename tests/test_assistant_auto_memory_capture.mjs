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

  const result = await runtime.bindTurn().capture({ userText: "olá", assistantText: "oi" });
  assert.equal(result.status, "disabled");
  assert.equal(ai.requests.length, 0);
  assert.equal(capture.calls.length, 0);
});

test("signed-out automatic capture uses device ownership and forces private sensitivity", async () => {
  const ai = intelligence('{"memories":[{"kind":"preference","content":"Prefiro respostas curtas.","evidence":"Prefiro respostas curtas."}]}');
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity("signed-out"),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.bindTurn().capture({
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
  const answer = '{"memories":[{"kind":"fact","content":"u","evidence":"u"}]}';

  const accountCapture = captureRuntime();
  const accountRuntime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(answer),
    captureRuntime: accountCapture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity("signed-in", "user-1"),
    spaceSelectionPort: selection("unselected", "user-1"),
  });
  await accountRuntime.bindTurn().capture({ userText: "u", assistantText: "a" });
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
  await spaceRuntime.bindTurn().capture({ userText: "u", assistantText: "a" });
  assert.equal(spaceCapture.calls[0].authorization.scope, "space");
  assert.equal(spaceCapture.calls[0].authorization.spaceId, "space-a");
});

test("model output cannot choose owner scope ids sensitivity or extra fields", async () => {
  const bad = [
    '{"memories":[{"kind":"fact","content":"u","evidence":"u","ownerId":"other"}]}',
    '{"memories":[{"kind":"fact","content":"u","evidence":"u","scope":"space"}]}',
    '{"memories":[{"kind":"fact","content":"u","evidence":"u","sensitivity":"normal"}]}',
    '{"memories":[{"kind":"fact","content":"u","evidence":"u","id":"forced"}]}',
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
    const result = await runtime.bindTurn().capture({ userText: "u", assistantText: "a" });
    assert.equal(result.status, "no-candidates");
    assert.equal(capture.calls.length, 0);
  }
});

test("invalid JSON and credential-like candidates fail closed", async () => {
  for (const answer of [
    "not json",
    "~~~json\n{\"memories\":[]}\n~~~",
    '{"memories":[{"kind":"fact","content":"Minha senha é 1234","evidence":"u"}]}',
    '{"memories":[{"kind":"fact","content":"API key abc","evidence":"u"}]}',
  ]) {
    const capture = captureRuntime();
    const runtime = createAssistantAutoCaptureRuntime({
      intelligencePort: intelligence(answer),
      captureRuntime: capture,
      preferenceRuntime: preferences(true),
      identitySessionPort: identity(),
      spaceSelectionPort: selection(),
    });
    const result = await runtime.bindTurn().capture({ userText: "u", assistantText: "a" });
    assert.equal(result.status, "no-candidates");
    assert.equal(capture.calls.length, 0);
  }
});

test("automatic Memory rejects model paraphrase even when evidence is a real user quote", async () => {
  const ai = intelligence('{"memories":[{"kind":"preference","content":"Usuário prefere respostas breves.","evidence":"Prefiro respostas curtas."}]}');
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.bindTurn().capture({
    userText: "Prefiro respostas curtas.",
    assistantText: "Certo.",
  });
  assert.equal(result.status, "no-candidates");
  assert.equal(capture.calls.length, 0);
});

test("automatic Memory persists the exact user evidence rather than model-authored wording", async () => {
  const quote = "Meu idioma preferido é português.";
  const ai = intelligence(JSON.stringify({
    memories: [{ kind: "preference", content: quote, evidence: quote }],
  }));
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.bindTurn().capture({
    userText: quote,
    assistantText: "Entendido.",
  });
  assert.equal(result.status, "captured");
  assert.equal(capture.calls[0].draft.content, quote);
});

test("extractor is bounded to four candidates and exact schema", async () => {
  const five = JSON.stringify({
    memories: Array.from({ length: 5 }, (_, i) => ({ kind: "fact", content: "f-" + i, evidence: "u" })),
  });
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(five),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });
  const result = await runtime.bindTurn().capture({ userText: "u", assistantText: "a" });
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


test("automatic Memory extraction never sends Assistant-generated text to the extractor", async () => {
  const ai = intelligence('{"memories":[]}');
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: captureRuntime(),
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });
  await runtime.bindTurn().capture({
    userText: "Meu idioma preferido é português.",
    assistantText: "Afirmativa inventada que não pode virar fonte de Memory.",
  });
  assert.equal(ai.requests.length, 1);
  assert.equal(ai.requests[0].context.length, 1);
  assert.equal(ai.requests[0].context[0].id, "assistant-user-turn");
  assert.match(ai.requests[0].context[0].text, /idioma preferido/);
  assert.doesNotMatch(
    JSON.stringify(ai.requests[0]),
    /Afirmativa inventada/,
  );
});


test("automatic Memory candidate must be grounded in exact user evidence", async () => {
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(
      '{"memories":[{"kind":"fact","content":"Prefere respostas curtas.","evidence":"Prefiro respostas longas."}]}'
    ),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.bindTurn().capture({
    userText: "Prefiro respostas curtas.",
  });

  assert.equal(result.status, "no-candidates");
  assert.equal(capture.calls.length, 0);
});

test("automatic Memory source evidence validates capture but is never persisted", async () => {
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence(
      '{"memories":[{"kind":"preference","content":"Prefiro respostas curtas.","evidence":"Prefiro respostas curtas."}]}'
    ),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });

  const result = await runtime.bindTurn().capture({
    userText: "Prefiro respostas curtas.",
  });

  assert.equal(result.status, "captured");
  assert.equal(capture.calls.length, 1);
  assert.deepEqual(capture.calls[0].draft, {
    content: "Prefiro respostas curtas.",
    kind: "preference",
    sensitivity: "private",
    provenance: "ordax-assistant:auto-capture",
  });
});

test("automatic Memory discards candidates when the selected Space changed before extraction", async () => {
  let selectedSpaceId = "space-a";
  const identityPort = identity("signed-in", "user-1");
  const spacePort = {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return {
        schema: SPACE_SELECTION_SCHEMA,
        state: "selected",
        subjectId: "user-1",
        selectedSpace: {
          id: selectedSpaceId,
          ownerId: "user-1",
          name: "Space",
          kind: "professional",
          state: "active",
          profilePack: null,
        },
      };
    },
    subscribe() { return () => {}; },
    select() {},
    clear() {},
  };
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence('{"memories":[{"kind":"fact","content":"Fato do Space A.","evidence":"Fato do Space A."}]}'),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identityPort,
    spaceSelectionPort: spacePort,
  });

  const bound = runtime.bindTurn();
  selectedSpaceId = "space-b";
  const result = await bound.capture({ userText: "Fato do Space A." });

  assert.equal(result.status, "scope-changed");
  assert.equal(capture.calls.length, 0);
});


test("automatic Memory aborts pending extraction when identity changes before persistence", async () => {
  let subjectId = "user-a";
  let resolveExtraction;
  const scopeIdentity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-in", subjectId, displayName: "Test User" };
    },
    subscribe() { return () => {}; },
  };
  const scopeSelection = {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return {
        schema: SPACE_SELECTION_SCHEMA,
        state: "unselected",
        subjectId,
        selectedSpace: null,
      };
    },
    subscribe() { return () => {}; },
    select() {},
    clear() {},
  };
  const ai = intelligence('{"memories":[]}');
  ai.respond = async (request) => {
    ai.requests.push(request);
    return new Promise((resolve) => {
      resolveExtraction = () => resolve({
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: '{"memories":[{"kind":"fact","content":"Minha empresa é A.","evidence":"Minha empresa é A."}]}',
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    });
  };
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: ai,
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: scopeIdentity,
    spaceSelectionPort: scopeSelection,
  });
  const bound = runtime.bindTurn();
  const pending = bound.capture({ userText: "Minha empresa é A." });
  subjectId = "user-b";
  resolveExtraction();
  const result = await pending;
  assert.equal(result.status, "scope-changed");
  assert.equal(capture.calls.length, 0);
});

test("automatic Memory discards extraction when conversation generation is revoked", async () => {
  const capture = captureRuntime();
  const runtime = createAssistantAutoCaptureRuntime({
    intelligencePort: intelligence('{"memories":[{"kind":"fact","content":"Fato A.","evidence":"Fato A."}]}'),
    captureRuntime: capture,
    preferenceRuntime: preferences(true),
    identitySessionPort: identity(),
    spaceSelectionPort: selection(),
  });
  const result = await runtime.bindTurn().capture({
    userText: "Fato A.",
    isContextCurrent: () => false,
  });
  assert.equal(result.status, "scope-changed");
  assert.equal(capture.calls.length, 0);
});

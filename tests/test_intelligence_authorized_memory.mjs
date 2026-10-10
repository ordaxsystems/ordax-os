import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_AI_PORT_SCHEMA } from "../system/contracts/local-ai.mjs";
import { createIntelligenceRuntime } from "../system/services/intelligence/runtime.mjs";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import {
  AUTHORIZED_MEMORY_INTELLIGENCE_SCHEMA,
  createAuthorizedMemoryIntelligence,
  createIdentityBoundMemoryIntelligence,
  createSelectedSpaceMemoryIntelligence,
} from "../system/services/intelligence/authorized-memory.mjs";
import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
} from "../system/contracts/identity-session.mjs";
import {
  SPACE_SELECTION_SCHEMA,
  validateSpaceSelectionSnapshot,
} from "../system/contracts/space-selection.mjs";

const deviceAuthorization = Object.freeze({
  authority: "composition",
  ownerKind: "device",
  ownerId: null,
  scopes: ["device"],
  spaceId: null,
  projectId: null,
  includeRestricted: false,
});

function memoryItem({ id = "mem-1", content = "Preferência local" } = {}) {
  return {
    id,
    ownerKind: "device",
    ownerId: null,
    scope: "device",
    kind: "fact",
    sensitivity: "private",
    content,
    provenance: "test-memory",
    sourceTimestamp: "2026-09-24T12:00:00Z",
    spaceId: null,
    projectId: null,
  };
}

function memoryPort(items = [memoryItem()]) {
  const searches = [];
  return {
    schema: MEMORY_PORT_SCHEMA,
    searches,
    search(request) {
      searches.push(request);
      return items.slice(0, request.limit);
    },
    remember() { return true; },
    forget() { return false; },
    async flush() { return true; },
  };
}

function identityPort(seed) {
  let snapshot = validateIdentitySessionSnapshot(seed);
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    listenerCount() { return listeners.size; },
    set(next) {
      snapshot = validateIdentitySessionSnapshot(next);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function selectionPort(seed) {
  let snapshot = validateSpaceSelectionSnapshot(seed);
  const listeners = new Set();
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    listenerCount() { return listeners.size; },
    select() { throw new Error("not used by test port"); },
    clear() { throw new Error("not used by test port"); },
    set(next) {
      snapshot = validateSpaceSelectionSnapshot(next);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function intelligencePort() {
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
        text: "ok",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("authorized-memory bridge requires explicit composition authorization", async () => {
  const memory = memoryPort();
  const intelligence = intelligencePort();
  const bridge = createAuthorizedMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
  });

  assert.equal(bridge.schema, AUTHORIZED_MEMORY_INTELLIGENCE_SCHEMA);
  await assert.rejects(
    () => bridge.respond({ prompt: "responda" }),
    /bounded authorization set/,
  );
  assert.equal(memory.searches.length, 0);
  assert.equal(intelligence.requests.length, 0);
});

test("authorized-memory bridge injects only explicitly authorized local memory", async () => {
  const memory = memoryPort([memoryItem({ content: "Prefere respostas curtas" })]);
  const intelligence = intelligencePort();
  const bridge = createAuthorizedMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
  });

  await bridge.respond(
    { intent: "ask", prompt: "Como devo responder?" },
    { authorizations: [deviceAuthorization], memoryLimit: 2 },
  );

  assert.equal(memory.searches.length, 1);
  assert.equal(memory.searches[0].ownerKind, "device");
  assert.equal(memory.searches[0].ownerId, null);
  assert.equal(memory.searches[0].query, "Como devo responder?");
  assert.deepEqual(memory.searches[0].scopes, ["device"]);
  assert.equal(intelligence.requests.length, 1);
  assert.equal(intelligence.requests[0].context.length, 1);
  assert.equal(intelligence.requests[0].context[0].text, "Prefere respostas curtas");
  assert.equal(intelligence.requests[0].context[0].provenance, "memory:device:test-memory");
});

test("consumer-selected context has priority over memory item budget", async () => {
  const memory = memoryPort([
    memoryItem({ id: "mem-a", content: "A" }),
    memoryItem({ id: "mem-b", content: "B" }),
  ]);
  const intelligence = intelligencePort();
  const bridge = createAuthorizedMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
  });
  const context = Array.from({ length: 15 }, (_, index) => ({
    id: `doc-${index}`,
    scope: "document",
    text: `documento ${index}`,
    provenance: "explicit-consumer-context",
  }));

  await bridge.respond(
    { prompt: "resuma", context },
    { authorizations: [deviceAuthorization], memoryLimit: 8 },
  );

  assert.equal(memory.searches.length, 1);
  assert.equal(memory.searches[0].limit, 1);
  assert.equal(intelligence.requests[0].context.length, 16);
  assert.deepEqual(
    intelligence.requests[0].context.slice(0, 15).map((entry) => entry.id),
    context.map((entry) => entry.id),
  );
  assert.equal(intelligence.requests[0].context[15].id, "mem-a");
});

test("full consumer context skips memory access instead of evicting explicit context", async () => {
  const memory = memoryPort();
  const intelligence = intelligencePort();
  const bridge = createAuthorizedMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
  });
  const context = Array.from({ length: 16 }, (_, index) => ({
    id: `doc-${index}`,
    scope: "document",
    text: `documento ${index}`,
    provenance: "explicit-consumer-context",
  }));

  await bridge.respond(
    { prompt: "resuma", context },
    { authorizations: [deviceAuthorization] },
  );

  assert.equal(memory.searches.length, 0);
  assert.deepEqual(intelligence.requests[0].context, context);
});

test("memory retrieval query is bounded before reaching the memory port", async () => {
  const memory = memoryPort();
  const intelligence = intelligencePort();
  const bridge = createAuthorizedMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
  });
  const prompt = "p".repeat(2000);

  await bridge.respond(
    { prompt },
    { authorizations: [deviceAuthorization] },
  );
  assert.equal(memory.searches[0].query.length, 1024);

  await assert.rejects(
    () => bridge.respond(
      { prompt: "ok" },
      {
        authorizations: [deviceAuthorization],
        memoryQuery: "q".repeat(1025),
      },
    ),
    /query is outside its allowed bounds/,
  );
  assert.equal(memory.searches.length, 1);
});


test("selected Space memory bridge authorizes only current account-owned Space memory", async () => {
  const searches = [];
  const memory = {
    schema: MEMORY_PORT_SCHEMA,
    search(request) {
      searches.push(request);
      return [{
        id: "space-memory",
        ownerKind: "account",
        ownerId: "user-1",
        scope: "space",
        kind: "fact",
        sensitivity: "private",
        content: "Contexto persistente deste Space.",
        provenance: "selected-space-test",
        sourceTimestamp: "2026-09-29T10:00:00Z",
        spaceId: "space-a",
        projectId: null,
      }];
    },
    remember() { throw new Error("not used"); },
    forget() { throw new Error("not used"); },
    async flush() { return true; },
  };
  const intelligence = intelligencePort();
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-a",
      ownerId: "user-1",
      name: "A",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  const bridge = createSelectedSpaceMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
    spaceSelectionPort: selection,
  });

  assert.equal(bridge.schema, INTELLIGENCE_PORT_SCHEMA);
  await bridge.respond({ prompt: "o que você sabe deste espaço?" });

  assert.equal(searches.length, 1);
  assert.deepEqual(searches[0].scopes, ["space"]);
  assert.equal(searches[0].ownerKind, "account");
  assert.equal(searches[0].ownerId, "user-1");
  assert.equal(searches[0].spaceId, "space-a");
  assert.equal(searches[0].projectId, null);
  assert.equal(searches[0].includeRestricted, false);
  assert.equal(intelligence.requests.length, 1);
  assert.equal(intelligence.requests[0].context[0].id, "space-memory");
});

test("selected Space memory bridge performs no memory read without a selected Space", async () => {
  const memory = memoryPort();
  const intelligence = intelligencePort();
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  const bridge = createSelectedSpaceMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
    spaceSelectionPort: selection,
  });

  await bridge.respond({ prompt: "teste sem Space" });
  assert.equal(memory.searches.length, 0);
  assert.equal(intelligence.requests.length, 1);

  selection.set({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  await bridge.respond({ prompt: "teste indisponível" });
  assert.equal(memory.searches.length, 0);
  assert.equal(intelligence.requests.length, 2);
});

test("selected Space memory bridge follows selection changes without stale authorization", async () => {
  const searches = [];
  const memory = {
    schema: MEMORY_PORT_SCHEMA,
    search(request) {
      searches.push(request);
      return [];
    },
    remember() { return true; },
    forget() { return false; },
    async flush() { return true; },
  };
  const intelligence = intelligencePort();
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-a",
      ownerId: "user-1",
      name: "A",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  const bridge = createSelectedSpaceMemoryIntelligence({
    intelligencePort: intelligence,
    memoryPort: memory,
    spaceSelectionPort: selection,
  });

  await bridge.respond({ prompt: "a" });
  selection.set({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-b",
      ownerId: "user-1",
      name: "B",
      kind: "work",
      state: "active",
      profilePack: null,
    },
  });
  await bridge.respond({ prompt: "b" });

  assert.deepEqual(
    searches.map((entry) => [entry.ownerId, entry.spaceId]),
    [["user-1", "space-a"], ["user-1", "space-b"]],
  );
});


test("identity-bound memory bridge combines device account and selected Space explicitly", async () => {
  const searches = [];
  const memory = {
    schema: MEMORY_PORT_SCHEMA,
    search(request) {
      searches.push(request);
      return [];
    },
    remember() { return true; },
    forget() { return false; },
    async flush() { return true; },
  };
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User 1",
  });
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-a",
      ownerId: "user-1",
      name: "A",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  const bridge = createIdentityBoundMemoryIntelligence({
    intelligencePort: intelligencePort(),
    memoryPort: memory,
    identitySessionPort: identity,
    spaceSelectionPort: selection,
  });

  await bridge.respond({ prompt: "contexto" });

  assert.deepEqual(
    searches.map((entry) => ({
      ownerKind: entry.ownerKind,
      ownerId: entry.ownerId,
      scopes: entry.scopes,
      spaceId: entry.spaceId,
      includeRestricted: entry.includeRestricted,
    })),
    [
      { ownerKind: "device", ownerId: null, scopes: ["device"], spaceId: null, includeRestricted: false },
      { ownerKind: "account", ownerId: "user-1", scopes: ["account"], spaceId: null, includeRestricted: false },
      { ownerKind: "account", ownerId: "user-1", scopes: ["space"], spaceId: "space-a", includeRestricted: false },
    ],
  );
});

test("identity-bound memory bridge keeps device memory available while signed out", async () => {
  const memory = memoryPort([]);
  const identity = identityPort({ state: "signed-out" });
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  const bridge = createIdentityBoundMemoryIntelligence({
    intelligencePort: intelligencePort(),
    memoryPort: memory,
    identitySessionPort: identity,
    spaceSelectionPort: selection,
  });

  await bridge.respond({ prompt: "offline" });

  assert.equal(memory.searches.length, 1);
  assert.equal(memory.searches[0].ownerKind, "device");
  assert.equal(memory.searches[0].ownerId, null);
  assert.deepEqual(memory.searches[0].scopes, ["device"]);
});

test("identity-bound memory bridge rejects selected Space from another identity", async () => {
  const memory = memoryPort([]);
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User 1",
  });
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-2",
    selectedSpace: {
      id: "space-b",
      ownerId: "user-2",
      name: "B",
      kind: "work",
      state: "active",
      profilePack: null,
    },
  });
  const bridge = createIdentityBoundMemoryIntelligence({
    intelligencePort: intelligencePort(),
    memoryPort: memory,
    identitySessionPort: identity,
    spaceSelectionPort: selection,
  });

  await assert.rejects(
    () => bridge.respond({ prompt: "não vaze" }),
    /current authenticated identity/,
  );
  assert.equal(memory.searches.length, 0);
});

test("identity-bound memory bridge reevaluates account owner after sign-out", async () => {
  const memory = memoryPort([]);
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User 1",
  });
  const selection = selectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  const bridge = createIdentityBoundMemoryIntelligence({
    intelligencePort: intelligencePort(),
    memoryPort: memory,
    identitySessionPort: identity,
    spaceSelectionPort: selection,
  });

  await bridge.respond({ prompt: "signed in" });
  identity.set({ state: "signed-out" });
  selection.set({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  await bridge.respond({ prompt: "signed out" });

  assert.deepEqual(
    memory.searches.map((entry) => [entry.ownerKind, entry.ownerId, entry.scopes[0]]),
    [
      ["device", null, "device"],
      ["account", "user-1", "account"],
      ["device", null, "device"],
    ],
  );
});

function selectedSnapshot(id = "space-a", subjectId = "user-1") {
  return {
    schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId,
    selectedSpace: { id, ownerId: subjectId, name: id, kind: "work", state: "active", profilePack: null },
  };
}

function continuityFixture(kind = "identity") {
  const identity = identityPort({ state: "signed-in", subjectId: "user-1", displayName: "User 1" });
  const selection = selectionPort(selectedSnapshot());
  const memory = memoryPort([]);
  const intelligence = intelligencePort();
  const immediate = intelligence.respond.bind(intelligence);
  const pending = [];
  intelligence.respond = (request) => {
    const result = immediate(request);
    return new Promise((resolve, reject) => pending.push({
      resolve: () => resolve(result), reject,
    }));
  };
  const bridge = kind === "identity"
    ? createIdentityBoundMemoryIntelligence({ intelligencePort: intelligence, memoryPort: memory, identitySessionPort: identity, spaceSelectionPort: selection })
    : createSelectedSpaceMemoryIntelligence({ intelligencePort: intelligence, memoryPort: memory, spaceSelectionPort: selection });
  return { identity, selection, memory, intelligence, pending, bridge };
}

test("in-flight account response is rejected after an owner change without retry or leaked observers", async () => {
  const f = continuityFixture();
  const response = f.bridge.respond({ prompt: "account A" });
  assert.equal(f.intelligence.requests.length, 1);
  f.identity.set({ state: "signed-in", subjectId: "user-2", displayName: "User 2" });
  f.selection.set(selectedSnapshot("space-b", "user-2"));
  f.pending[0].resolve();
  await assert.rejects(response, /memory context changed/);
  assert.equal(f.intelligence.requests.length, 1);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("sign-out and sign-in to the original account cannot revive an old pending response", async () => {
  const f = continuityFixture();
  const response = f.bridge.respond({ prompt: "original owner" });
  f.identity.set({ state: "signed-out" });
  f.identity.set({ state: "signed-in", subjectId: "user-1", displayName: "User 1" });
  f.pending[0].resolve();
  await assert.rejects(response, /memory context changed/);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

for (const kind of ["identity", "space"]) {
  test(`${kind} wrapper latches a Space change even after selection returns to the original Space`, async () => {
    const f = continuityFixture(kind);
    const response = f.bridge.respond({ prompt: "space A" });
    f.selection.set(selectedSnapshot("space-b"));
    f.selection.set(selectedSnapshot());
    f.pending[0].resolve();
    await assert.rejects(response, /memory context changed/);
    assert.equal(f.selection.listenerCount(), 0);
  });
}

test("invalid current authority snapshots reject pending results even without a notification", async () => {
  const f = continuityFixture();
  const response = f.bridge.respond({ prompt: "scope" });
  f.identity.getSnapshot = () => ({ state: "signed-in", subjectId: null });
  f.pending[0].resolve();
  await assert.rejects(response, /memory context changed/);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("a context change during subscription blocks retrieval and inference", async () => {
  const f = continuityFixture();
  const original = f.selection.subscribe.bind(f.selection);
  f.selection.subscribe = (listener) => {
    const cleanup = original(listener);
    f.selection.set(selectedSnapshot("space-b"));
    return cleanup;
  };
  await assert.rejects(f.bridge.respond({ prompt: "do not infer" }), /memory context changed/);
  assert.equal(f.memory.searches.length, 0);
  assert.equal(f.intelligence.requests.length, 0);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("a context change during Memory retrieval cannot send old-owner data to inference", async () => {
  const f = continuityFixture();
  f.memory.search = () => { f.selection.set(selectedSnapshot("space-b")); return []; };
  await assert.rejects(f.bridge.respond({ prompt: "do not infer old scope" }), /memory context changed/);
  assert.equal(f.intelligence.requests.length, 0);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("display metadata changes preserve stable owner/Space responses and release observers", async () => {
  const f = continuityFixture();
  const response = f.bridge.respond({ prompt: "stable context" });
  f.identity.set({ state: "signed-in", subjectId: "user-1", displayName: "Renamed" });
  f.selection.set({ ...selectedSnapshot(), selectedSpace: { ...selectedSnapshot().selectedSpace, name: "Renamed Space" } });
  f.pending[0].resolve();
  const result = await response;
  assert.equal(result.text, "ok");
  assert.equal(result.authority, "none");
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("model failure releases all context observers without replay", async () => {
  const f = continuityFixture();
  const response = f.bridge.respond({ prompt: "fail once" });
  f.pending[0].reject(new Error("fixture inference failure"));
  await assert.rejects(response, /fixture inference failure/);
  assert.equal(f.intelligence.requests.length, 1);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("overlapping requests retain independent context guards and cleanup", async () => {
  const f = continuityFixture();
  const first = f.bridge.respond({ prompt: "old request" });
  f.selection.set(selectedSnapshot("space-b"));
  const second = f.bridge.respond({ prompt: "new request" });
  assert.equal(f.selection.listenerCount(), 2);
  f.pending[0].resolve();
  await assert.rejects(first, /memory context changed/);
  assert.equal(f.selection.listenerCount(), 1);
  f.pending[1].resolve();
  assert.equal((await second).text, "ok");
  assert.equal(f.selection.listenerCount(), 0);
  assert.equal(f.identity.listenerCount(), 0);
});

test("subscription failure cleans prior observers before any Memory or inference call", async () => {
  const f = continuityFixture();
  f.selection.subscribe = () => { throw new Error("fixture unavailable selection observer"); };
  await assert.rejects(f.bridge.respond({ prompt: "do not read" }), /selection observer/);
  assert.equal(f.memory.searches.length, 0);
  assert.equal(f.intelligence.requests.length, 0);
  assert.equal(f.identity.listenerCount(), 0);
});

test("cleanup failure drains other observers and rejects rather than publishing the response", async () => {
  const f = continuityFixture();
  const original = f.selection.subscribe.bind(f.selection);
  f.selection.subscribe = (listener) => {
    const unsubscribe = original(listener);
    return () => { unsubscribe(); throw new Error("fixture cleanup failed"); };
  };
  const response = f.bridge.respond({ prompt: "no retained observer" });
  f.pending[0].resolve();
  await assert.rejects(response, /context observer cleanup failed/);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("a context change during observer cleanup cannot publish an old completion", async () => {
  const f = continuityFixture();
  const original = f.selection.subscribe.bind(f.selection);
  f.selection.subscribe = (listener) => {
    const unsubscribe = original(listener);
    return () => { unsubscribe(); f.selection.set(selectedSnapshot("space-b")); };
  };
  const response = f.bridge.respond({ prompt: "old scope" });
  f.pending[0].resolve();
  await assert.rejects(response, /memory context changed/);
  assert.equal(f.identity.listenerCount(), 0);
  assert.equal(f.selection.listenerCount(), 0);
});

test("existing Memory -> Intelligence -> model router -> Local AI pipeline rejects old-account completion", async () => {
  const f = continuityFixture();
  let complete;
  const generated = [];
  const inference = {
    schema: LOCAL_AI_PORT_SCHEMA,
    getSnapshot: () => ({ state: "ready", engineId: "fixture-engine", modelId: "fixture-model", offline: true, migratable: true }),
    subscribe: () => () => {},
    generate(request) {
      generated.push(request);
      return new Promise(resolve => { complete = () => resolve({ text: "private original account response", engineId: "fixture-engine", modelId: "fixture-model" }); });
    },
  };
  const intelligence = createIntelligenceRuntime({ inferencePort: inference });
  const memory = { ...memoryPort(), search(request) {
    return [{ ...memoryItem({ id: `${request.scopes[0]}-memory`, content: `source:${request.ownerId ?? "device"}:${request.scopes[0]}` }), ownerKind: request.ownerKind, ownerId: request.ownerId, scope: request.scopes[0], spaceId: request.spaceId }];
  } };
  const bridge = createIdentityBoundMemoryIntelligence({ intelligencePort: intelligence, memoryPort: memory, identitySessionPort: f.identity, spaceSelectionPort: f.selection });
  try {
    const response = bridge.respond({ prompt: "consult original account" });
    assert.equal(generated.length, 1);
    assert.match(generated[0].prompt, /source:user-1:account/);
    assert.match(generated[0].prompt, /source:user-1:space/);
    assert.match(generated[0].systemPrompt, /no implicit authority/);
    f.identity.set({ state: "signed-in", subjectId: "user-2", displayName: "User 2" });
    complete();
    await assert.rejects(response, /memory context changed/);
    assert.equal(generated.length, 1);
    assert.equal(f.identity.listenerCount(), 0);
    assert.equal(f.selection.listenerCount(), 0);
  } finally { intelligence.dispose(); }
});

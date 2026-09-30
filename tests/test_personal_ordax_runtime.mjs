import test from "node:test";
import assert from "node:assert/strict";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  PERSONAL_ORDAX_STORE_SCHEMA,
  PERSONAL_ORDAX_STORE_STATE_SCHEMA,
  createEmptyPersonalOrdaxStoreState,
} from "../system/contracts/personal-ordax-store.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

function observablePort(schema, initial, methods = {}) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    ...methods,
  };
}

function identitySignedOut() {
  return observablePort(IDENTITY_SESSION_SCHEMA, {
    state: "signed-out",
    subjectId: null,
    displayName: null,
  });
}

function identitySignedIn(subjectId = "user-1") {
  return observablePort(IDENTITY_SESSION_SCHEMA, {
    state: "signed-in",
    subjectId,
    displayName: "User",
  });
}

function spaces(subjectId = "user-1", selectedSpaceId = "space-1") {
  return observablePort(SPACE_SELECTION_SCHEMA, {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace: {
      id: selectedSpaceId,
      name: "Pizzaria",
      kind: "professional",
      ownerId: subjectId,
      profilePack: "pizzaria-br",
      state: "active",
    },
  }, {
    select() {},
    clear() {},
  });
}

function projects(entries = [{
  id: "project-1",
  name: "Cardápio",
  path: "/Documentos/Cardapio",
  createdAt: 1,
  lastOpenedAt: 1,
  lastFilePath: null,
}]) {
  return observablePort(PROJECT_CATALOG_SCHEMA, {
    persistence: "device",
    projects: entries,
  }, {
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
  });
}

function intelligence({ deferred = false } = {}) {
  const listeners = new Set();
  let resolveResponse = null;
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests: [],
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "test-model",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async respond(request) {
      port.requests.push(request);
      if (deferred) {
        return new Promise((resolve) => {
          resolveResponse = () => resolve({
            schema: INTELLIGENCE_RESPONSE_SCHEMA,
            text: "Plano pronto.",
            engineId: "llama.cpp",
            modelId: "test-model",
            authority: "none",
          });
        });
      }
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "Plano pronto.",
        engineId: "llama.cpp",
        modelId: "test-model",
        authority: "none",
      };
    },
    resolve() {
      resolveResponse?.();
    },
  };
  return port;
}

function memoryStore() {
  let state = createEmptyPersonalOrdaxStoreState();
  return {
    schema: PERSONAL_ORDAX_STORE_SCHEMA,
    scope: "device",
    load: () => state,
    save(next) {
      state = next;
      return true;
    },
    read: () => state,
  };
}

test("device-local work stays explicitly device-owned and never inherits selected context", () => {
  let tick = 1_000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedOut(),
    now: () => tick++,
  });
  const work = runtime.create("Organize meus próximos passos.");
  assert.equal(work.ownerKind, "device");
  assert.equal(work.ownerId, null);
  assert.equal(work.spaceId, null);
  assert.equal(work.projectId, null);
  assert.deepEqual(work.contextRefs, []);
  assert.equal(runtime.getSnapshot().activities[0].type, "queued");
  runtime.dispose();
});

test("account work binds explicit Space and project without treating them as authority", () => {
  let tick = 2_000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedIn(),
    spaceSelectionPort: spaces(),
    projectCatalogPort: projects(),
    now: () => tick++,
  });
  const work = runtime.create("Continue o projeto da pizzaria.", {
    spaceId: "space-1",
    projectId: "project-1",
  });
  assert.equal(work.ownerKind, "account");
  assert.equal(work.ownerId, "user-1");
  assert.equal(work.spaceId, "space-1");
  assert.equal(work.projectId, "project-1");
  assert.deepEqual(work.contextRefs, ["space:space-1", "project:project-1"]);
  runtime.dispose();
});

test("invalid explicit Space/project scope fails before work is created", () => {
  let tick = 3_000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedIn(),
    spaceSelectionPort: spaces("user-1", "space-1"),
    projectCatalogPort: projects(),
    now: () => tick++,
  });
  assert.throws(
    () => runtime.create("wrong space", { spaceId: "space-2" }),
    /space-changed/,
  );
  assert.throws(
    () => runtime.create("wrong project", { projectId: "project-99" }),
    /project-unavailable/,
  );
  assert.equal(runtime.getSnapshot().workItems.length, 0);
  runtime.dispose();
});

test("foreground run uses consultative Intelligence and records visible lifecycle", async () => {
  let tick = 4_000;
  const ai = intelligence();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedOut(),
    intelligencePort: ai,
    now: () => tick++,
  });
  const work = runtime.create("Prepare um plano.");
  const result = await runtime.run(work.id);
  assert.equal(result.text, "Plano pronto.");
  assert.equal(ai.requests.length, 1);
  assert.equal(ai.requests[0].prompt, "Prepare um plano.");
  assert.deepEqual(ai.requests[0].context, []);
  assert.equal(runtime.getSnapshot().workItems[0].state, "completed");
  assert.deepEqual(
    runtime.getSnapshot().activities.map((event) => event.type),
    ["queued", "started", "completed"],
  );
  runtime.dispose();
});

test("identity change pauses account work and stale inference cannot complete it", async () => {
  let tick = 5_000;
  const identity = identitySignedIn("user-1");
  const ai = intelligence({ deferred: true });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity,
    intelligencePort: ai,
    now: () => tick++,
  });
  const work = runtime.create("Continue.");
  const pending = runtime.run(work.id);
  assert.equal(runtime.getSnapshot().workItems[0].state, "running");

  identity.setSnapshot({
    state: "signed-in",
    subjectId: "user-2",
    displayName: "Other",
  });
  assert.equal(runtime.getSnapshot().workItems[0].state, "paused");
  ai.resolve();
  await assert.rejects(pending, /context changed/);
  assert.equal(runtime.getSnapshot().workItems[0].state, "paused");
  assert.deepEqual(
    runtime.getSnapshot().activities.map((event) => event.type),
    ["queued", "started", "paused"],
  );
  runtime.dispose();
});

test("Space switch and project removal pause only work explicitly bound to them", () => {
  let tick = 6_000;
  const identity = identitySignedIn();
  const selection = spaces();
  const catalog = projects();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity,
    spaceSelectionPort: selection,
    projectCatalogPort: catalog,
    now: () => tick++,
  });
  const bound = runtime.create("Bound.", { spaceId: "space-1", projectId: "project-1" });
  const unbound = runtime.create("Unbound.");

  selection.setSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems.find((item) => item.id === bound.id).state, "paused");
  assert.equal(snapshot.workItems.find((item) => item.id === unbound.id).state, "queued");

  catalog.setSnapshot({ persistence: "device", projects: [] });
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.workItems.find((item) => item.id === unbound.id).state, "queued");
  runtime.dispose();
});

test("paused work resumes only after the original context is restored", () => {
  let tick = 7_000;
  const identity = identitySignedIn();
  const selection = spaces();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity,
    spaceSelectionPort: selection,
    now: () => tick++,
  });
  const work = runtime.create("Bound.", { spaceId: "space-1" });
  selection.setSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  assert.throws(() => runtime.resume(work.id), /still invalid/);
  selection.setSnapshot(spaces().getSnapshot());
  const resumed = runtime.resume(work.id);
  assert.equal(resumed.state, "queued");
  assert.equal(runtime.getSnapshot().activities.at(-1).type, "resumed");
  runtime.dispose();
});

test("durable store keeps work and ordered activity without a second memory system", async () => {
  let tick = 8_000;
  const store = memoryStore();
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedOut(),
    intelligencePort: intelligence(),
    store,
    now: () => tick++,
  });
  const work = runtime.create("Persist lifecycle.");
  await runtime.run(work.id);
  const saved = store.read();
  assert.equal(saved.schema, PERSONAL_ORDAX_STORE_STATE_SCHEMA);
  assert.equal(saved.workItems.length, 1);
  assert.equal(saved.activities.length, 3);
  assert.deepEqual(saved.activities.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(runtime.getSnapshot().persistence, "device");
  runtime.dispose();
});

test("terminal work can be removed with its activity while active work cannot", async () => {
  let tick = 9_000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySignedOut(),
    intelligencePort: intelligence(),
    now: () => tick++,
  });
  const active = runtime.create("Active.");
  assert.throws(() => runtime.remove(active.id), /must be cancelled/);
  runtime.cancel(active.id);
  runtime.remove(active.id);
  assert.equal(runtime.getSnapshot().workItems.length, 0);
  assert.equal(runtime.getSnapshot().activities.length, 0);

  const completed = runtime.create("Completed.");
  await runtime.run(completed.id);
  runtime.remove(completed.id);
  assert.equal(runtime.getSnapshot().workItems.length, 0);
  assert.equal(runtime.getSnapshot().activities.length, 0);
  runtime.dispose();
});

test("persisted runtime ids and activity time cannot regress", () => {
  const identity = identitySignedOut();
  const store = memoryStore();
  store.save({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal: 1,
    workItems: [{
      id: "personal-work-4",
      ownerKind: "device",
      ownerId: null,
      goal: "Old work",
      state: "completed",
      spaceId: null,
      projectId: null,
      pendingApprovalId: null,
      backgroundExecution: false,
      contextRefs: [],
      createdAt: "2026-09-30T20:00:00Z",
      updatedAt: "2026-09-30T20:00:01Z",
    }],
    activities: [],
  });
  assert.throws(
    () => createPersonalOrdaxRuntime({ identitySessionPort: identity, store }),
    /next ordinal must exceed/,
  );

  const invalidTimeStore = memoryStore();
  invalidTimeStore.save({
    schema: PERSONAL_ORDAX_STORE_STATE_SCHEMA,
    nextOrdinal: 2,
    workItems: [{
      id: "personal-work-1",
      ownerKind: "device",
      ownerId: null,
      goal: "Timed work",
      state: "completed",
      spaceId: null,
      projectId: null,
      pendingApprovalId: null,
      backgroundExecution: false,
      contextRefs: [],
      createdAt: "2026-09-30T20:00:01Z",
      updatedAt: "2026-09-30T20:00:02Z",
    }],
    activities: [{
      workItemId: "personal-work-1",
      sequence: 1,
      type: "completed",
      summary: "Impossible event",
      approvalId: null,
      actionId: null,
      artifactRefs: [],
      occurredAt: "2026-09-30T20:00:00Z",
    }],
  });
  assert.throws(
    () => createPersonalOrdaxRuntime({ identitySessionPort: identity, store: invalidTimeStore }),
    /cannot precede work creation/,
  );
});

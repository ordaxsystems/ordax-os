import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
} from "../system/contracts/identity-session.mjs";
import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
  validateSpacesSnapshot,
} from "../system/contracts/spaces.mjs";
import {
  SPACE_SELECTION_RECORD_SCHEMA,
  SPACE_SELECTION_SCHEMA,
  SPACE_SELECTION_STORE_SCHEMA,
  assertSpaceSelectionPort,
  validateSpaceSelectionRecord,
} from "../system/contracts/space-selection.mjs";
import { createSpaceSelectionRuntime } from "../system/services/spaces/selection.mjs";
import { createNativeSpaceSelectionStore } from "../system/adapters/native/space-selection.mjs";

function identityPort(seed) {
  let snapshot = validateIdentitySessionSnapshot(seed);
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = validateIdentitySessionSnapshot(next);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function spacesPort(seed) {
  let snapshot = validateSpacesSnapshot(seed);
  const listeners = new Set();
  return {
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async refresh() { return snapshot; },
    reset() {
      snapshot = validateSpacesSnapshot({
        schema: SPACES_SNAPSHOT_SCHEMA,
        state: "unavailable",
        spaces: [],
      });
      for (const listener of [...listeners]) listener(snapshot);
      return snapshot;
    },
    set(next) {
      snapshot = validateSpacesSnapshot(next);
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function memoryStore(seed = null) {
  let record = validateSpaceSelectionRecord(seed);
  return {
    schema: SPACE_SELECTION_STORE_SCHEMA,
    load: () => record,
    save(next) {
      record = validateSpaceSelectionRecord(next);
      return true;
    },
    clear() {
      record = null;
      return true;
    },
    peek: () => record,
  };
}

function readySpaces(spaces) {
  return {
    schema: SPACES_SNAPSHOT_SCHEMA,
    state: "ready",
    spaces,
  };
}

const developer = {
  id: "space-developer",
  ownerId: "user-1",
  name: "Developer",
  kind: "professional",
  state: "active",
  profilePack: "developer",
};

test("Space selection requires authenticated current catalog membership", () => {
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User",
  });
  const spaces = spacesPort(readySpaces([developer]));
  const store = memoryStore();
  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });
  assert.equal(assertSpaceSelectionPort(runtime), runtime);
  assert.equal(runtime.getSnapshot().state, "unselected");

  const selected = runtime.select("space-developer");
  assert.equal(selected.state, "selected");
  assert.equal(selected.subjectId, "user-1");
  assert.equal(selected.selectedSpace.id, "space-developer");
  assert.deepEqual(store.peek(), {
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });

  assert.throws(
    () => runtime.select("space-invented"),
    /not available to the current account/,
  );
  assert.equal(runtime.getSnapshot().selectedSpace.id, "space-developer");
});

test("Space selection never crosses account identities", () => {
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-2",
    displayName: "Other",
  });
  const spaces = spacesPort(readySpaces([{ ...developer, ownerId: "user-2" }]));
  const store = memoryStore({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });

  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });
  assert.equal(runtime.getSnapshot().state, "unselected");
  assert.equal(runtime.getSnapshot().subjectId, "user-2");
  assert.equal(store.peek(), null);
});

test("direct account switch invalidates stale Spaces until the catalog refreshes", () => {
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User One",
  });
  const spaces = spacesPort(readySpaces([developer]));
  const store = memoryStore();
  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });

  runtime.select("space-developer");
  assert.equal(runtime.getSnapshot().state, "selected");

  identity.set({
    state: "signed-in",
    subjectId: "user-2",
    displayName: "User Two",
  });
  assert.equal(runtime.getSnapshot().state, "unavailable");
  assert.equal(store.peek(), null);
  assert.throws(
    () => runtime.select("space-developer"),
    /selection is unavailable/,
  );

  spaces.set(readySpaces([{ ...developer, ownerId: "user-2" }]));
  assert.equal(runtime.getSnapshot().state, "unselected");
  assert.equal(runtime.getSnapshot().subjectId, "user-2");
  assert.equal(runtime.select("space-developer").state, "selected");
});

test("signed-out identity clears persisted selection while unavailable identity hides it", () => {
  const identity = identityPort({ state: "unavailable" });
  const spaces = spacesPort(readySpaces([developer]));
  const store = memoryStore({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });
  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });

  assert.deepEqual(runtime.getSnapshot(), {
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  assert.notEqual(store.peek(), null);

  identity.set({ state: "signed-out" });
  assert.equal(runtime.getSnapshot().state, "unavailable");
  assert.equal(store.peek(), null);
});

test("archived or removed Space invalidates local selection", () => {
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User",
  });
  const spaces = spacesPort(readySpaces([developer]));
  const store = memoryStore({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });
  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });
  assert.equal(runtime.getSnapshot().state, "selected");

  spaces.set(readySpaces([{ ...developer, state: "archived" }]));
  assert.equal(runtime.getSnapshot().state, "unselected");
  assert.equal(store.peek(), null);
});

test("catalog outage hides selected Space without destroying same-account recovery", () => {
  const identity = identityPort({
    state: "signed-in",
    subjectId: "user-1",
    displayName: "User",
  });
  const spaces = spacesPort(readySpaces([developer]));
  const store = memoryStore({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });
  const runtime = createSpaceSelectionRuntime({ identitySession: identity, spaces, store });
  assert.equal(runtime.getSnapshot().state, "selected");

  spaces.reset();
  assert.equal(runtime.getSnapshot().state, "unavailable");
  assert.notEqual(store.peek(), null);

  spaces.set(readySpaces([developer]));
  assert.equal(runtime.getSnapshot().state, "selected");
});

test("Native Space selection store rejects corrupt persisted state", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  const store = createNativeSpaceSelectionStore({ localStorage: storage });
  assert.equal(store.load(), null);

  store.save({
    schema: SPACE_SELECTION_RECORD_SCHEMA,
    subjectId: "user-1",
    selectedSpaceId: "space-developer",
  });
  assert.equal(store.load().selectedSpaceId, "space-developer");

  values.set("ordax.native.space-selection.v1", '{"schema":"wrong"}');
  assert.equal(store.load(), null);
  assert.equal(values.has("ordax.native.space-selection.v1"), false);
});

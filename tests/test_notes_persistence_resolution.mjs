import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTES_SNAPSHOT_SCHEMA,
  validateNotesSnapshot,
} from "../system/contracts/notes-store.mjs";
import {
  createBoundAppDataPort,
  createInMemoryAppDataStore,
} from "../system/services/app-data/runtime.mjs";
import {
  resolveNotesPersistence,
} from "../system/apps/notes/runtime.mjs";

function snapshot() {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "project-1",
    selectedNoteId: "note-1",
    projects: [{
      id: "project-1",
      name: "Projeto",
      createdAt: 1,
      updatedAt: 1,
    }],
    notes: [{
      id: "note-1",
      projectId: "project-1",
      title: "Legado",
      body: "conteudo",
      favorite: false,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      tasks: [],
      references: [],
    }],
  });
}

function notesPort() {
  return createBoundAppDataPort({
    store: createInMemoryAppDataStore({
      quotaBytes: 64 * 1024 * 1024,
      maxKeys: 2048,
    }),
    appId: "notes",
    publisherId: "ordax-official",
  });
}

test("persistence resolution seeds App Data from legacy store only when empty", async () => {
  const appData = notesPort();
  const legacy = snapshot();
  let calls = 0;

  const store = await resolveNotesPersistence({
    appData,
    createStore() {
      calls += 1;
      return { load: () => legacy };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(store.load(), legacy);

  calls = 0;
  const reopened = await resolveNotesPersistence({
    appData,
    createStore() {
      calls += 1;
      throw new Error("legacy must not be consulted after App Data cutover");
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(reopened.load(), legacy);
});

test("persistence resolution retains legacy fallback only when App Data is unavailable", async () => {
  const legacyStore = { marker: "legacy" };
  let calls = 0;

  const resolved = await resolveNotesPersistence({
    createStore() {
      calls += 1;
      return legacyStore;
    },
  });

  assert.equal(calls, 1);
  assert.equal(resolved, legacyStore);
});

test("persistence resolution rejects an invalid legacy factory", async () => {
  await assert.rejects(
    () => resolveNotesPersistence({ createStore: {} }),
    /must be a function or null/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import {
  NOTES_SNAPSHOT_SCHEMA,
  validateNotesSnapshot,
} from "../system/contracts/notes-store.mjs";
import {
  createBoundAppDataPort,
  createInMemoryAppDataStore,
} from "../system/services/app-data/runtime.mjs";
import {
  NOTES_APP_DATA_HEAD_KEY,
} from "../system/apps/notes/services/app-data-layout.mjs";
import {
  NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
} from "../system/apps/notes/services/app-data-transition-journal.mjs";
import {
  createNotesAppDataStore,
} from "../system/apps/notes/services/app-data-store.mjs";

function port(store = createInMemoryAppDataStore({
  quotaBytes: 64 * 1024 * 1024,
  maxKeys: 2048,
})) {
  return createBoundAppDataPort({
    store,
    appId: "notes",
    publisherId: "ordax-official",
  });
}

function note(id, body, updatedAt = 1) {
  return {
    id,
    projectId: "project-1",
    title: `Nota ${id}`,
    body,
    favorite: false,
    deletedAt: null,
    createdAt: 1,
    updatedAt,
    tasks: [],
    references: [],
  };
}

function snapshot(notes, selectedNoteId = notes[0]?.id ?? null) {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "project-1",
    selectedNoteId,
    projects: [{
      id: "project-1",
      name: "Projeto",
      createdAt: 1,
      updatedAt: 1,
    }],
    notes,
  });
}

function wrappedPort(base, hooks = {}) {
  return Object.freeze({
    schema: APP_DATA_SCHEMA,
    identity: base.identity,
    get(key) {
      return base.get(key);
    },
    list() {
      return base.list();
    },
    put(command) {
      hooks.onPut?.(command);
      if (hooks.failPut?.(command)) {
        throw new Error("injected App Data put failure");
      }
      return base.put(command);
    },
    delete(command) {
      hooks.onDelete?.(command);
      if (hooks.failDelete?.(command)) {
        throw new Error("injected App Data delete failure");
      }
      return base.delete(command);
    },
  });
}

test("Notes App Data v2 round-trips a logical document larger than one value", async () => {
  const base = port();
  const largeText = "x".repeat(50_000);
  const document = snapshot(
    Array.from({ length: 24 }, (_, index) => note(`note-${index + 1}`, largeText, index + 1)),
  );
  assert.ok(
    new TextEncoder().encode(JSON.stringify(document)).byteLength > 1024 * 1024,
    "fixture must exceed the App Data single-value ceiling",
  );

  const store = await createNotesAppDataStore(base);
  store.save(document);
  await store.flush();

  const listing = await base.list();
  assert.ok(listing.keys.includes(NOTES_APP_DATA_HEAD_KEY));
  assert.ok(!listing.keys.includes(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY));

  const reopened = await createNotesAppDataStore(base);
  assert.deepEqual(reopened.load(), document);
});

test("single-note edit uses the inactive bounded slot and leaves no transition journal", async () => {
  const base = port();
  const initial = snapshot([
    note("note-1", "um"),
    note("note-2", "dois"),
    note("note-3", "tres"),
  ]);
  const store = await createNotesAppDataStore(base);
  store.save(initial);
  await store.flush();

  const before = await base.list();
  const edited = validateNotesSnapshot({
    ...initial,
    notes: [
      initial.notes[0],
      { ...initial.notes[1], title: "Alterada", updatedAt: 2 },
      initial.notes[2],
    ],
  });
  store.save(edited);
  await store.flush();

  const after = await base.list();
  assert.equal(after.keys.includes(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY), false);
  const editedKeys = after.keys.filter((key) => /^n\.note-2\.[01]\.\d+$/.test(key));
  assert.deepEqual(editedKeys, ["n.note-2.1.0"]);
  assert.equal(after.keys.some((key) => /^n\.note-2\.0\.\d+$/.test(key)), false);
  assert.equal(after.keys.length, before.keys.length);

  const reopened = await createNotesAppDataStore(base);
  assert.equal(reopened.load().notes[1].title, "Alterada");
});

test("crash before head flip rolls staged records back on reopen", async () => {
  const base = port();
  const initial = snapshot([note("note-1", "original")]);
  const first = await createNotesAppDataStore(base);
  first.save(initial);
  await first.flush();

  let failHead = true;
  const injected = wrappedPort(base, {
    failPut(command) {
      return failHead && command.key === NOTES_APP_DATA_HEAD_KEY;
    },
  });
  const writer = await createNotesAppDataStore(injected);
  const edited = snapshot([{ ...note("note-1", "editada", 2), title: "Mudou" }]);
  writer.save(edited);
  await assert.rejects(() => writer.flush(), /injected App Data put failure/);

  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, true);
  failHead = false;

  const reopened = await createNotesAppDataStore(injected);
  assert.equal(reopened.load().notes[0].body, "original");
  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, false);
});

test("crash after head flip completes committed cleanup on reopen", async () => {
  const base = port();
  const initial = snapshot([
    note("note-1", "um"),
    note("note-2", "dois"),
  ]);
  const first = await createNotesAppDataStore(base);
  first.save(initial);
  await first.flush();

  let failCleanup = true;
  const injected = wrappedPort(base, {
    failDelete(command) {
      return failCleanup && /^n\.note-2\.[01]\.\d+$/.test(command.key);
    },
  });
  const writer = await createNotesAppDataStore(injected);
  const reduced = snapshot([initial.notes[0]], "note-1");
  writer.save(reduced);
  await assert.rejects(() => writer.flush(), /injected App Data delete failure/);

  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, true);
  failCleanup = false;

  const reopened = await createNotesAppDataStore(injected);
  assert.deepEqual(reopened.load(), reduced);
  assert.equal((await base.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY)).found, false);
  const listing = await base.list();
  assert.equal(listing.keys.some((key) => /^n\.note-2\.[01]\.\d+$/.test(key)), false);
});

test("Notes App Data store rejects a port bound to another app", async () => {
  const raw = createInMemoryAppDataStore();
  const assistant = createBoundAppDataPort({
    store: raw,
    appId: "assistant",
    publisherId: "ordax-official",
  });
  await assert.rejects(
    () => createNotesAppDataStore(assistant),
    /must be bound to the notes app/,
  );
});

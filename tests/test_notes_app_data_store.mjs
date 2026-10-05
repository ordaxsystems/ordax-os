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
  NOTES_APP_DATA_MANIFEST_SCHEMA,
  createNotesAppDataStore,
} from "../system/apps/notes/platform/app-data-store.mjs";

function port(store = createInMemoryAppDataStore({
  quotaBytes: 16 * 1024 * 1024,
  maxKeys: 1024,
})) {
  return createBoundAppDataPort({
    store,
    appId: "notes",
    publisherId: "ordax-official",
  });
}

function note(id, text, updatedAt = 1) {
  return {
    id,
    projectId: "meu-espaco",
    title: `Nota ${id}`,
    body: text,
    favorite: false,
    deletedAt: null,
    createdAt: 1,
    updatedAt,
    tasks: [],
    references: [],
  };
}

function snapshot(notes) {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "meu-espaco",
    selectedNoteId: notes[0]?.id ?? null,
    projects: [{
      id: "meu-espaco",
      name: "Meu espaço",
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
      return base.delete(command);
    },
  });
}

test("Notes App Data store round-trips a multi-record snapshot larger than one App Data value", async () => {
  const base = port();
  const largeText = "x".repeat(50_000);
  const document = snapshot(
    Array.from({ length: 24 }, (_, index) => note(`note-${index + 1}`, largeText, index + 1)),
  );
  assert.ok(
    new TextEncoder().encode(JSON.stringify(document)).byteLength > 1024 * 1024,
    "fixture must exceed the App Data single-value ceiling",
  );

  const first = await createNotesAppDataStore(base);
  assert.equal(first.load(), null);
  assert.equal(first.save(document), true);
  await first.flush();

  const listing = await base.list();
  assert.ok(listing.keys.includes("notes.manifest"));
  assert.ok(listing.keys.filter((key) => key.startsWith("notes.note.")).length >= 24);

  const manifest = await base.get("notes.manifest");
  const manifestValue = JSON.parse(new TextDecoder().decode(manifest.value));
  assert.equal(manifestValue.$schema, NOTES_APP_DATA_MANIFEST_SCHEMA);

  const reopened = await createNotesAppDataStore(base);
  assert.deepEqual(reopened.load(), document);
});

test("Notes App Data manifest remains the commit point when a save fails after writing a changed note", async () => {
  const base = port();
  let failManifest = false;
  const injected = wrappedPort(base, {
    failPut(command) {
      return failManifest && command.key === "notes.manifest";
    },
  });

  const original = snapshot([note("note-1", "original")]);
  const store = await createNotesAppDataStore(injected);
  assert.equal(store.save(original), true);
  await store.flush();

  failManifest = true;
  const edited = snapshot([{
    ...note("note-1", "editada", 2),
    title: "Mudou",
  }]);
  assert.equal(store.save(edited), true);
  await assert.rejects(() => store.flush(), /injected App Data put failure/);

  const reopened = await createNotesAppDataStore(base);
  assert.equal(reopened.load().notes[0].title, original.notes[0].title);
  assert.equal(reopened.load().notes[0].body, "original");
});

test("editing one note writes one new note record and the manifest, not every note", async () => {
  const base = port();
  const puts = [];
  const deletes = [];
  const observed = wrappedPort(base, {
    onPut(command) {
      puts.push(command.key);
    },
    onDelete(command) {
      deletes.push(command.key);
    },
  });

  const initial = snapshot([
    note("note-1", "um"),
    note("note-2", "dois"),
    note("note-3", "três"),
  ]);
  const store = await createNotesAppDataStore(observed);
  store.save(initial);
  await store.flush();

  puts.length = 0;
  deletes.length = 0;

  const edited = validateNotesSnapshot({
    ...initial,
    notes: [
      initial.notes[0],
      {
        ...initial.notes[1],
        title: "Nota alterada",
        updatedAt: 2,
      },
      initial.notes[2],
    ],
  });
  store.save(edited);
  await store.flush();

  assert.equal(puts.filter((key) => key.startsWith("notes.note.")).length, 1);
  assert.equal(puts.filter((key) => key === "notes.manifest").length, 1);
  assert.equal(deletes.filter((key) => key.startsWith("notes.note.")).length, 1);

  const reopened = await createNotesAppDataStore(base);
  assert.equal(reopened.load().notes[0].body, "um");
  assert.equal(reopened.load().notes[1].title, "Nota alterada");
  assert.equal(reopened.load().notes[2].body, "três");
});

test("Notes App Data store rejects a port bound to another app", async () => {
  const store = createInMemoryAppDataStore();
  const assistant = createBoundAppDataPort({
    store,
    appId: "assistant",
    publisherId: "ordax-official",
  });
  await assert.rejects(
    () => createNotesAppDataStore(assistant),
    /must be bound to the notes app/,
  );
});

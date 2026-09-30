import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  validateNotesSnapshot,
} from "../system/contracts/notes-store.mjs";
import { createNativeNotesStore } from "../system/adapters/native/notes.mjs";
import { createWebNotesStore } from "../system/adapters/web/notes.mjs";
import { createNotesRuntime } from "../system/apps/notes/domain/runtime.mjs";

function minimalSnapshot() {
  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: "meu-espaco",
    selectedNoteId: null,
    projects: [{
      id: "meu-espaco",
      name: "Meu espaço",
      createdAt: 1,
      updatedAt: 1,
    }],
    notes: [],
  });
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("Native Notes flush fails closed when fsync-backed POST never becomes durable", async () => {
  let posts = 0;
  const store = await createNativeNotesStore({
    async fetch(_url, options) {
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { payload: null };
          },
        };
      }
      posts += 1;
      return { ok: false, status: 507 };
    },
  });

  assert.equal(store.save(minimalSnapshot()), true);
  await assert.rejects(
    () => store.flush(),
    /Native notes persistence failed: 507/,
  );
  assert.equal(posts, 2, "flush retries only the newest desired snapshot once");
});

test("Notes runtime downgrades persistence after asynchronous durable failure and recovers", async () => {
  let memory = minimalSnapshot();
  const flushPlan = [true, new Error("disk unavailable"), true];
  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(snapshot) {
      memory = validateNotesSnapshot(snapshot);
      return true;
    },
    async flush() {
      const outcome = flushPlan.shift();
      if (outcome instanceof Error) throw outcome;
      return true;
    },
  };

  let clock = 1_000;
  const runtime = createNotesRuntime({ store, now: () => clock++ });
  assert.equal(runtime.getSnapshot().persistence.pending, true);
  await settle();
  assert.equal(runtime.getSnapshot().persistence.pending, false);
  assert.equal(runtime.getSnapshot().persistence.ok, true);

  const created = runtime.createNote();
  const noteId = created.document.selectedNoteId;
  assert.ok(noteId);
  assert.equal(created.persistence.pending, true);
  await settle();

  let state = runtime.getSnapshot();
  assert.equal(state.persistence.pending, false);
  assert.equal(state.persistence.ok, false);
  assert.equal(state.document.selectedNoteId, noteId, "session state survives durable failure");

  runtime.updateNote(noteId, { title: "Persistir depois" });
  assert.equal(runtime.getSnapshot().persistence.pending, true);
  await settle();

  state = runtime.getSnapshot();
  assert.equal(state.persistence.pending, false);
  assert.equal(state.persistence.ok, true);
  assert.equal(
    state.document.notes.find((note) => note.id === noteId).title,
    "Persistir depois",
  );
  runtime.destroy();
});

test("Web Notes preserves malformed durable bytes instead of overwriting them with an empty snapshot", async () => {
  const rawCorruptPayload = '{"$schema":"ordax.notes-snapshot/2"';
  let stored = rawCorruptPayload;
  let writes = 0;
  const storage = {
    getItem(key) {
      assert.equal(key, "ordax.notes.v1");
      return stored;
    },
    setItem(key, value) {
      assert.equal(key, "ordax.notes.v1");
      writes += 1;
      stored = value;
    },
  };

  const store = createWebNotesStore({ localStorage: storage });
  const runtime = createNotesRuntime({ store, now: () => 2_000 });

  assert.equal(runtime.getSnapshot().persistence.scope, "device");
  assert.equal(runtime.getSnapshot().persistence.ok, false);
  assert.equal(writes, 0, "initialization must not overwrite unreadable durable state");
  assert.equal(stored, rawCorruptPayload);

  const created = runtime.createNote();
  const noteId = created.document.selectedNoteId;
  runtime.updateNote(noteId, { title: "Sessão preservada" });
  await settle();

  const state = runtime.getSnapshot();
  assert.equal(state.persistence.ok, false);
  assert.equal(state.document.notes.find((note) => note.id === noteId).title, "Sessão preservada");
  assert.equal(writes, 0, "edits remain session-only until corrupt durable state is explicitly recovered");
  assert.equal(stored, rawCorruptPayload);
  runtime.destroy();
});

test("Native Notes coalesces newer revisions without writing stale data back over them", async () => {
  const postBodies = [];
  let releaseFirstPost;
  let firstPost = true;
  const store = await createNativeNotesStore({
    async fetch(_url, options) {
      if (options.method === "GET") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { payload: null };
          },
        };
      }
      postBodies.push(JSON.parse(JSON.parse(options.body).payload));
      if (firstPost) {
        firstPost = false;
        await new Promise((resolve) => {
          releaseFirstPost = resolve;
        });
      }
      return { ok: true, status: 204 };
    },
  });

  const first = minimalSnapshot();
  store.save(first);
  await settle();

  const second = validateNotesSnapshot({
    ...first,
    selectedNoteId: "note:newer",
    notes: [{
      id: "note:newer",
      projectId: "meu-espaco",
      title: "Mais nova",
      body: "",
      favorite: false,
      deletedAt: null,
      createdAt: 2,
      updatedAt: 2,
      tasks: [],
      references: [],
    }],
  });
  store.save(second);
  releaseFirstPost();
  await store.flush();

  assert.equal(postBodies.length, 2);
  assert.equal(postBodies[0].selectedNoteId, null);
  assert.equal(postBodies[1].selectedNoteId, "note:newer");
  assert.equal(store.load().selectedNoteId, "note:newer");
});

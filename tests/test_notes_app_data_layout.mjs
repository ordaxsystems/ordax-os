import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NOTES_APP_DATA_KEYS,
  NOTES_APP_DATA_HEAD_KEY,
  createInitialNotesAppDataLayout,
  decodeNotesAppDataId,
  encodeNotesAppDataId,
  planNotesAppDataTransition,
  reconstructNotesSnapshotFromAppData,
} from "../system/apps/notes/services/app-data-layout.mjs";

function snapshot({ title = "One", body = "alpha", second = false, selectedNoteId = "n:1" } = {}) {
  const notes = [{
    id: "n:1",
    projectId: "p:1",
    title,
    body,
    richBody: { blocks: [{ type: "paragraph", text: body, marks: [] }] },
    favorite: false,
    deletedAt: null,
    createdAt: 1,
    updatedAt: title === "One" ? 1 : 2,
    tasks: [],
    references: [],
  }];
  if (second) {
    notes.push({
      id: "n:2",
      projectId: "p:1",
      title: "Two",
      body: "beta",
      richBody: { blocks: [{ type: "paragraph", text: "beta", marks: [] }] },
      favorite: false,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      tasks: [],
      references: [],
    });
  }
  return {
    $schema: "ordax.notes-snapshot/2",
    selectedProjectId: "p:1",
    selectedNoteId,
    projects: [{ id: "p:1", name: "Main", createdAt: 1, updatedAt: 1 }],
    notes,
  };
}

function materialize(layout) {
  return new Map(layout.stagedWrites.map(({ key, value }) => [key, value]));
}

test("id codec is reversible and bounded for current Notes grammar", () => {
  const id = `${"a".repeat(90)}:x_y-z`;
  const encoded = encodeNotesAppDataId(id);
  assert.equal(decodeNotesAppDataId(encoded), id);
  assert.ok(encoded.includes("Z"));
  assert.throws(() => decodeNotesAppDataId("contains:colon"));
});

test("initial layout writes slot zero records and reconstructs exact snapshot", () => {
  const initial = createInitialNotesAppDataLayout(snapshot({ second: true }));
  assert.equal(initial.headWrite.key, NOTES_APP_DATA_HEAD_KEY);
  assert.deepEqual(initial.head.projects, [{ id: "p:1", slot: 0 }]);
  assert.deepEqual(initial.head.notes, [{ id: "n:1", slot: 0 }, { id: "n:2", slot: 0 }]);
  const rebuilt = reconstructNotesSnapshotFromAppData(initial.head, materialize(initial));
  assert.deepEqual(rebuilt, initial.snapshot);
});

test("single-note edit stages only inactive note slot and head is commit point", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const values = materialize(initial);
  const next = snapshot({ title: "Changed", body: "alpha changed" });
  const plan = planNotesAppDataTransition(initial.head, initial.snapshot, next);
  assert.equal(plan.stagedWrites.length, 1);
  assert.match(plan.stagedWrites[0].key, /^n\..+\.1$/);
  values.set(plan.stagedWrites[0].key, plan.stagedWrites[0].value);
  assert.deepEqual(reconstructNotesSnapshotFromAppData(initial.head, values), initial.snapshot);
  assert.deepEqual(reconstructNotesSnapshotFromAppData(plan.head, values), plan.snapshot);
});

test("multi-entity staging remains invisible until one head flip", () => {
  const initial = createInitialNotesAppDataLayout(snapshot({ second: true }));
  const values = materialize(initial);
  const next = snapshot({ title: "Changed", body: "changed", second: false, selectedNoteId: "n:1" });
  const plan = planNotesAppDataTransition(initial.head, initial.snapshot, next);
  for (const write of plan.stagedWrites) values.set(write.key, write.value);
  assert.deepEqual(reconstructNotesSnapshotFromAppData(initial.head, values), initial.snapshot);
  assert.deepEqual(reconstructNotesSnapshotFromAppData(plan.head, values), plan.snapshot);
});

test("repeated edits toggle between two bounded slots", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const values = materialize(initial);
  const first = planNotesAppDataTransition(
    initial.head,
    initial.snapshot,
    snapshot({ title: "Second", body: "b" }),
  );
  for (const write of first.stagedWrites) values.set(write.key, write.value);
  const second = planNotesAppDataTransition(
    first.head,
    first.snapshot,
    snapshot({ title: "Third", body: "c" }),
  );
  assert.equal(second.stagedWrites.length, 1);
  assert.match(second.stagedWrites[0].key, /^n\..+\.0$/);
  for (const write of second.stagedWrites) values.set(write.key, write.value);
  assert.deepEqual(reconstructNotesSnapshotFromAppData(second.head, values), second.snapshot);
  const noteKeys = [...values.keys()].filter((key) => key.startsWith("n."));
  assert.equal(new Set(noteKeys).size, 2);
});

test("selection-only change mutates head without rewriting entity records", () => {
  const initial = createInitialNotesAppDataLayout(snapshot({ second: true }));
  const next = snapshot({ second: true, selectedNoteId: "n:2" });
  const plan = planNotesAppDataTransition(initial.head, initial.snapshot, next);
  assert.equal(plan.stagedWrites.length, 0);
  assert.equal(plan.headChanged, true);
});

test("no-op transition has no staged writes and unchanged head", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const plan = planNotesAppDataTransition(initial.head, initial.snapshot, initial.snapshot);
  assert.equal(plan.stagedWrites.length, 0);
  assert.equal(plan.headChanged, false);
});

test("missing active slot fails closed", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const values = materialize(initial);
  values.delete([...values.keys()].find((key) => key.startsWith("n.")));
  assert.throws(() => reconstructNotesSnapshotFromAppData(initial.head, values));
});

test("bounded two-slot layout stays below App Data partition key ceiling", () => {
  assert.equal(MAX_NOTES_APP_DATA_KEYS, 1153);
  assert.ok(MAX_NOTES_APP_DATA_KEYS < 4096);
});

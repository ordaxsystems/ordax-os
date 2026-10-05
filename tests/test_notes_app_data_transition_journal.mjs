import assert from "node:assert/strict";
import test from "node:test";

import { MAX_APP_DATA_PARTITION_KEYS } from "../system/contracts/app-data.mjs";
import {
  MAX_NOTES_APP_DATA_KEYS,
  createInitialNotesAppDataLayout,
  notesNoteAppDataKey,
} from "../system/apps/notes/services/app-data-layout.mjs";
import {
  MAX_NOTES_APP_DATA_TRANSACTION_KEYS,
  NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
  decodeNotesAppDataTransitionJournal,
  planCrashSafeNotesAppDataTransition,
  recoverNotesAppDataTransition,
  notesAppDataTransitionWriteOrder,
} from "../system/apps/notes/services/app-data-transition-journal.mjs";

function note(id, title, body) {
  return {
    id,
    projectId: "p:1",
    title,
    body,
    richBody: { blocks: [{ type: "paragraph", text: body, marks: [] }] },
    favorite: false,
    deletedAt: null,
    createdAt: 1,
    updatedAt: title === "One" || title === "Two" ? 1 : 2,
    tasks: [],
    references: [],
  };
}

function snapshot({ firstTitle = "One", firstBody = "alpha", second = true } = {}) {
  return {
    $schema: "ordax.notes-snapshot/2",
    selectedProjectId: "p:1",
    selectedNoteId: "n:1",
    projects: [{ id: "p:1", name: "Main", createdAt: 1, updatedAt: 1 }],
    notes: [
      note("n:1", firstTitle, firstBody),
      ...(second ? [note("n:2", "Two", "beta")] : []),
    ],
  };
}

test("transition journal survives crash and distinguishes rollback from committed cleanup", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const next = snapshot({ firstTitle: "Changed", firstBody: "changed", second: false });
  const plan = planCrashSafeNotesAppDataTransition(initial.head, initial.snapshot, next);

  assert.equal(plan.journalRequired, true);
  assert.equal(plan.journalWrite.key, NOTES_APP_DATA_TRANSITION_JOURNAL_KEY);
  assert.deepEqual(notesAppDataTransitionWriteOrder(plan), [
    "journal", "staging", "head", "recovery-cleanup", "journal-delete",
  ]);

  const journal = decodeNotesAppDataTransitionJournal(plan.journalWrite.value);
  assert.deepEqual(journal.stagedKeys, [notesNoteAppDataKey("n:1", 1, 0)]);
  assert.deepEqual(journal.cleanupKeys, [
    notesNoteAppDataKey("n:1", 0, 0),
    notesNoteAppDataKey("n:2", 0, 0),
  ].sort());

  const beforeHeadFlip = recoverNotesAppDataTransition(journal, initial.head);
  assert.equal(beforeHeadFlip.status, "rollback-staging");
  assert.deepEqual(beforeHeadFlip.deleteKeys, journal.stagedKeys);
  assert.equal(beforeHeadFlip.journalDeleteKey, NOTES_APP_DATA_TRANSITION_JOURNAL_KEY);
  assert.ok(!beforeHeadFlip.deleteKeys.includes(notesNoteAppDataKey("n:1", 0, 0)));

  const afterHeadFlip = recoverNotesAppDataTransition(journal, plan.head);
  assert.equal(afterHeadFlip.status, "commit-cleanup");
  assert.deepEqual(afterHeadFlip.deleteKeys, journal.cleanupKeys);
  assert.equal(afterHeadFlip.journalDeleteKey, NOTES_APP_DATA_TRANSITION_JOURNAL_KEY);
  assert.ok(!afterHeadFlip.deleteKeys.includes(notesNoteAppDataKey("n:1", 1, 0)));
});

test("journal rejects incomplete cleanup of changed source slot", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const plan = planCrashSafeNotesAppDataTransition(
    initial.head,
    initial.snapshot,
    snapshot({ firstTitle: "Changed", firstBody: "changed", second: false }),
  );
  const journal = decodeNotesAppDataTransitionJournal(plan.journalWrite.value);
  const incomplete = {
    ...journal,
    cleanupKeys: journal.cleanupKeys.filter((key) => key !== notesNoteAppDataKey("n:1", 0, 0)),
  };
  assert.throws(
    () => recoverNotesAppDataTransition(incomplete, initial.head),
    /exactly cover the head key delta/,
  );
});

test("unexpected head fails closed and never authorizes journal deletion", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const plan = planCrashSafeNotesAppDataTransition(
    initial.head,
    initial.snapshot,
    snapshot({ firstTitle: "Changed", firstBody: "changed", second: false }),
  );
  const foreign = createInitialNotesAppDataLayout(snapshot({ second: false }));
  const recovered = recoverNotesAppDataTransition(plan.journalWrite.value, foreign.head);
  assert.equal(recovered.status, "conflict");
  assert.deepEqual(recovered.deleteKeys, []);
  assert.equal(recovered.journalDeleteKey, null);
});

test("selection-only transition needs only the atomic head write", () => {
  const initial = createInitialNotesAppDataLayout(snapshot());
  const next = structuredClone(initial.snapshot);
  next.selectedNoteId = "n:2";
  const plan = planCrashSafeNotesAppDataTransition(initial.head, initial.snapshot, next);
  assert.equal(plan.journalRequired, false);
  assert.equal(plan.journalWrite, null);
  assert.deepEqual(notesAppDataTransitionWriteOrder(plan), ["head"]);
});

test("transaction operation bound and physical key peak stay below ceilings", () => {
  assert.equal(MAX_NOTES_APP_DATA_TRANSACTION_KEYS, 2498);
  assert.ok(MAX_NOTES_APP_DATA_TRANSACTION_KEYS < MAX_APP_DATA_PARTITION_KEYS);
  assert.ok(MAX_NOTES_APP_DATA_KEYS < 2048);
});

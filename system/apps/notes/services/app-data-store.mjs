import {
  assertAppDataPort,
} from "../../../contracts/app-data.mjs";
import {
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../../contracts/notes-store.mjs";
import {
  NOTES_APP_DATA_HEAD_KEY,
  createInitialNotesAppDataLayout,
  decodeNotesAppDataHead,
  notesNoteAppDataKey,
  notesProjectAppDataKey,
  reconstructNotesSnapshotFromAppData,
} from "./app-data-layout.mjs";
import {
  NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
  planCrashSafeNotesAppDataTransition,
  recoverNotesAppDataTransition,
} from "./app-data-transition-journal.mjs";

const ENTITY_KEY_RE = /^(?:p|n)\./;

function assertSameRevision(result, expectedRevision, label) {
  if (!result || result.revision !== expectedRevision) {
    throw new Error(`Notes App Data changed while ${label}`);
  }
  return result;
}

async function deleteKeys(appData, keys, revision) {
  let currentRevision = revision;
  for (const key of keys) {
    const result = await appData.delete({
      key,
      expectedRevision: currentRevision,
    });
    currentRevision = result.revision;
  }
  return currentRevision;
}

async function putWrites(appData, writes, revision) {
  let currentRevision = revision;
  for (const write of writes) {
    const result = await appData.put({
      key: write.key,
      value: write.value,
      expectedRevision: currentRevision,
    });
    currentRevision = result.revision;
  }
  return currentRevision;
}

async function loadCanonicalState(appData) {
  const listing = await appData.list();
  let revision = listing.revision;

  const headResult = assertSameRevision(
    await appData.get(NOTES_APP_DATA_HEAD_KEY),
    revision,
    "reading the Notes head",
  );
  const journalResult = assertSameRevision(
    await appData.get(NOTES_APP_DATA_TRANSITION_JOURNAL_KEY),
    revision,
    "reading the Notes transition journal",
  );

  if (!headResult.found) {
    if (journalResult.found) {
      throw new Error("Notes App Data has a transition journal without an authoritative head");
    }
    return Object.freeze({
      revision,
      head: null,
      snapshot: null,
      keys: listing.keys,
      recovered: false,
    });
  }

  let head = decodeNotesAppDataHead(headResult.value);
  let recovered = false;

  if (journalResult.found) {
    const recovery = recoverNotesAppDataTransition(journalResult.value, head);
    if (recovery.status === "conflict") {
      throw new Error("Notes App Data transition journal conflicts with the authoritative head");
    }
    revision = await deleteKeys(appData, recovery.deleteKeys, revision);
    if (recovery.journalDeleteKey !== null) {
      const deleted = await appData.delete({
        key: recovery.journalDeleteKey,
        expectedRevision: revision,
      });
      revision = deleted.revision;
    }
    recovered = true;

    const refreshedHead = assertSameRevision(
      await appData.get(NOTES_APP_DATA_HEAD_KEY),
      revision,
      "reloading the Notes head after recovery",
    );
    if (!refreshedHead.found) {
      throw new Error("Notes App Data head disappeared during recovery");
    }
    head = decodeNotesAppDataHead(refreshedHead.value);
  }

  const values = new Map();
  for (const { id, slot } of head.projects) {
    const key = notesProjectAppDataKey(id, slot);
    const result = assertSameRevision(
      await appData.get(key),
      revision,
      `reading project record ${key}`,
    );
    if (!result.found) {
      throw new Error(`Notes App Data active project record is missing: ${key}`);
    }
    values.set(key, result.value);
  }
  for (const { id, slot } of head.notes) {
    const key = notesNoteAppDataKey(id, slot);
    const result = assertSameRevision(
      await appData.get(key),
      revision,
      `reading note record ${key}`,
    );
    if (!result.found) {
      throw new Error(`Notes App Data active note record is missing: ${key}`);
    }
    values.set(key, result.value);
  }

  return Object.freeze({
    revision,
    head,
    snapshot: reconstructNotesSnapshotFromAppData(head, values),
    keys: listing.keys,
    recovered,
  });
}

async function cleanupUncommittedInitialRecords(appData, state) {
  if (state.head !== null) return state.revision;
  const orphanKeys = state.keys.filter((key) => ENTITY_KEY_RE.test(key));
  return deleteKeys(appData, orphanKeys, state.revision);
}

async function commitInitialSnapshot(appData, rawSnapshot, state) {
  const layout = createInitialNotesAppDataLayout(rawSnapshot);
  let revision = await cleanupUncommittedInitialRecords(appData, state);
  revision = await putWrites(appData, layout.stagedWrites, revision);
  const headCommit = await appData.put({
    key: layout.headWrite.key,
    value: layout.headWrite.value,
    expectedRevision: revision,
  });
  return Object.freeze({
    revision: headCommit.revision,
    head: layout.head,
    snapshot: layout.snapshot,
  });
}

async function commitTransition(appData, rawSnapshot, state) {
  if (state.head === null || state.snapshot === null) {
    throw new TypeError("Notes App Data transition requires an existing canonical snapshot");
  }

  const plan = planCrashSafeNotesAppDataTransition(
    state.head,
    state.snapshot,
    rawSnapshot,
  );
  if (!plan.headChanged) {
    return Object.freeze({
      revision: state.revision,
      head: state.head,
      snapshot: plan.snapshot,
    });
  }

  let revision = state.revision;
  if (!plan.journalRequired) {
    const headCommit = await appData.put({
      key: plan.headWrite.key,
      value: plan.headWrite.value,
      expectedRevision: revision,
    });
    return Object.freeze({
      revision: headCommit.revision,
      head: plan.head,
      snapshot: plan.snapshot,
    });
  }

  const journalCommit = await appData.put({
    key: plan.journalWrite.key,
    value: plan.journalWrite.value,
    expectedRevision: revision,
  });
  revision = journalCommit.revision;

  revision = await putWrites(appData, plan.stagedWrites, revision);

  const headCommit = await appData.put({
    key: plan.headWrite.key,
    value: plan.headWrite.value,
    expectedRevision: revision,
  });
  revision = headCommit.revision;

  revision = await deleteKeys(appData, plan.cleanupKeys, revision);

  const journalDelete = await appData.delete({
    key: NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
    expectedRevision: revision,
  });
  revision = journalDelete.revision;

  return Object.freeze({
    revision,
    head: plan.head,
    snapshot: plan.snapshot,
  });
}

export async function createNotesAppDataStore(appDataValue, {
  seedSnapshot = null,
} = {}) {
  const appData = assertAppDataPort(appDataValue);
  if (appData.identity.appId !== "notes") {
    throw new TypeError("Notes App Data port must be bound to the notes app");
  }

  let canonical = await loadCanonicalState(appData);

  if (canonical.head === null && seedSnapshot !== null) {
    const rawSeed = typeof seedSnapshot === "function"
      ? await seedSnapshot()
      : seedSnapshot;
    if (rawSeed !== null && rawSeed !== undefined) {
      const seed = validateNotesSnapshot(rawSeed);
      await commitInitialSnapshot(appData, seed, canonical);
      canonical = await loadCanonicalState(appData);
    }
  }

  let memory = canonical.snapshot;
  let desiredRevision = 0;
  let durableRevision = 0;
  let persistQueue = null;
  let lastPersistError = null;

  async function persistSnapshot(snapshot) {
    const current = await loadCanonicalState(appData);
    if (current.head === null) {
      await commitInitialSnapshot(appData, snapshot, current);
    } else {
      await commitTransition(appData, snapshot, current);
    }
  }

  async function drainDesiredSnapshot() {
    while (durableRevision < desiredRevision) {
      const targetRevision = desiredRevision;
      const targetSnapshot = memory;
      try {
        await persistSnapshot(targetSnapshot);
        durableRevision = Math.max(durableRevision, targetRevision);
        if (targetRevision === desiredRevision) {
          lastPersistError = null;
        }
      } catch (error) {
        lastPersistError = error instanceof Error
          ? error
          : new Error("Notes App Data persistence failed");
        return false;
      }
    }
    return true;
  }

  function scheduleDrain() {
    if (persistQueue !== null) return persistQueue;
    persistQueue = Promise.resolve()
      .then(drainDesiredSnapshot)
      .finally(() => {
        persistQueue = null;
      });
    return persistQueue;
  }

  const store = {
    schema: NOTES_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(snapshotValue) {
      memory = validateNotesSnapshot(snapshotValue);
      desiredRevision += 1;
      scheduleDrain();
      return true;
    },
    async flush() {
      const targetRevision = desiredRevision;
      if (durableRevision >= targetRevision) return true;
      await scheduleDrain();
      if (durableRevision < targetRevision) {
        throw lastPersistError ?? new Error("Notes App Data persistence failed");
      }
      return true;
    },
  };

  assertNotesStore(store);
  return Object.freeze(store);
}

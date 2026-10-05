import {
  MAX_APP_DATA_VALUE_BYTES,
  assertAppDataPort,
} from "../../../contracts/app-data.mjs";
import {
  NOTES_SNAPSHOT_SCHEMA,
  NOTES_STORE_SCHEMA,
  assertNotesStore,
  validateNotesSnapshot,
} from "../../../contracts/notes-store.mjs";

export const NOTES_APP_DATA_MANIFEST_SCHEMA = "ordax.notes-app-data-manifest/1";

const MANIFEST_KEY = "notes.manifest";
const NOTE_KEY_PREFIX = "notes.note.";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length
    || actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function noteKey(slot, version) {
  return `${NOTE_KEY_PREFIX}${slot.toString(36)}.${version.toString(36)}`;
}

function jsonBytes(value) {
  return encoder.encode(JSON.stringify(value));
}

function parseJsonBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} bytes are invalid`);
  }
  try {
    return JSON.parse(decoder.decode(value));
  } catch (error) {
    throw new TypeError(`${label} is invalid JSON`, { cause: error });
  }
}

function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function validateManifest(value) {
  const manifest = objectValue(value, "Notes App Data manifest");
  exactKeys(
    manifest,
    [
      "$schema",
      "nextSlot",
      "notes",
      "projects",
      "selectedNoteId",
      "selectedProjectId",
      "snapshotSchema",
    ],
    "Notes App Data manifest",
  );
  if (manifest.$schema !== NOTES_APP_DATA_MANIFEST_SCHEMA) {
    throw new TypeError("Notes App Data manifest schema is incompatible");
  }
  if (manifest.snapshotSchema !== NOTES_SNAPSHOT_SCHEMA) {
    throw new TypeError("Notes App Data snapshot schema is incompatible");
  }
  const nextSlot = positiveSafeInteger(manifest.nextSlot, "Notes App Data nextSlot");
  if (!Array.isArray(manifest.projects) || !Array.isArray(manifest.notes)) {
    throw new TypeError("Notes App Data manifest collections are invalid");
  }

  const seenIds = new Set();
  const seenKeys = new Set();
  let highestSlot = 0;
  const notes = manifest.notes.map((raw) => {
    const ref = objectValue(raw, "Notes App Data note reference");
    exactKeys(ref, ["id", "key", "slot", "version"], "Notes App Data note reference");
    if (typeof ref.id !== "string" || !ref.id) {
      throw new TypeError("Notes App Data note id is invalid");
    }
    const slot = positiveSafeInteger(ref.slot, "Notes App Data note slot");
    const version = positiveSafeInteger(ref.version, "Notes App Data note version");
    const key = noteKey(slot, version);
    if (ref.key !== key) {
      throw new TypeError("Notes App Data note key is incompatible");
    }
    if (seenIds.has(ref.id) || seenKeys.has(key)) {
      throw new TypeError("Notes App Data note references are duplicated");
    }
    seenIds.add(ref.id);
    seenKeys.add(key);
    highestSlot = Math.max(highestSlot, slot);
    return Object.freeze({ id: ref.id, key, slot, version });
  });
  if (nextSlot <= highestSlot) {
    throw new TypeError("Notes App Data nextSlot does not advance past allocated slots");
  }

  return Object.freeze({
    $schema: NOTES_APP_DATA_MANIFEST_SCHEMA,
    snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: manifest.selectedProjectId,
    selectedNoteId: manifest.selectedNoteId,
    projects: manifest.projects,
    notes: Object.freeze(notes),
    nextSlot,
  });
}

function persistedNote(note) {
  const serialized = JSON.stringify(note);
  const bytes = encoder.encode(serialized);
  if (bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("A note exceeds the App Data per-value hard bound");
  }
  return Object.freeze({ serialized, bytes });
}

function snapshotFitsPerValueBounds(snapshot) {
  try {
    for (const note of snapshot.notes) persistedNote(note);
    const approximateManifest = jsonBytes({
      $schema: NOTES_APP_DATA_MANIFEST_SCHEMA,
      snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
      selectedProjectId: snapshot.selectedProjectId,
      selectedNoteId: snapshot.selectedNoteId,
      projects: snapshot.projects,
      notes: snapshot.notes.map((note, index) => ({
        id: note.id,
        key: noteKey(index + 1, 1),
        slot: index + 1,
        version: 1,
      })),
      nextSlot: snapshot.notes.length + 1,
    });
    return approximateManifest.byteLength <= MAX_APP_DATA_VALUE_BYTES;
  } catch {
    return false;
  }
}

export async function createNotesAppDataStore(appDataValue) {
  const appData = assertAppDataPort(appDataValue);
  if (appData.identity.appId !== "notes") {
    throw new TypeError("Notes App Data port must be bound to the notes app");
  }

  const initialList = await appData.list();
  let partitionRevision = initialList.revision;
  let activeManifest = null;
  let activeManifestBytes = null;
  let memory = null;
  let nextSlot = 1;
  let records = new Map();
  const orphanKeys = new Set(
    initialList.keys.filter((key) => key.startsWith(NOTE_KEY_PREFIX)),
  );

  const manifestResult = await appData.get(MANIFEST_KEY);
  if (manifestResult.revision !== partitionRevision) {
    throw new Error("Notes App Data changed during initialization");
  }

  if (manifestResult.found) {
    activeManifestBytes = new Uint8Array(manifestResult.value);
    activeManifest = validateManifest(parseJsonBytes(activeManifestBytes, "Notes App Data manifest"));
    nextSlot = activeManifest.nextSlot;

    const loadedNotes = [];
    const loadedRecords = new Map();
    for (const ref of activeManifest.notes) {
      const result = await appData.get(ref.key);
      if (result.revision !== partitionRevision) {
        throw new Error("Notes App Data changed while loading note records");
      }
      if (!result.found) {
        throw new Error(`Notes App Data record is missing: ${ref.key}`);
      }
      const note = parseJsonBytes(result.value, "Notes App Data note");
      if (note?.id !== ref.id) {
        throw new TypeError("Notes App Data note identity does not match its manifest reference");
      }
      loadedNotes.push(note);
      loadedRecords.set(ref.id, Object.freeze({
        ref,
        serialized: decoder.decode(result.value),
      }));
      orphanKeys.delete(ref.key);
    }

    memory = validateNotesSnapshot({
      $schema: NOTES_SNAPSHOT_SCHEMA,
      selectedProjectId: activeManifest.selectedProjectId,
      selectedNoteId: activeManifest.selectedNoteId,
      projects: activeManifest.projects,
      notes: loadedNotes,
    });
    records = loadedRecords;
  }

  let desiredRevision = 0;
  let durableRevision = 0;
  let persistQueue = null;
  let lastPersistError = null;

  async function cleanupOrphans() {
    for (const key of [...orphanKeys]) {
      try {
        const result = await appData.delete({
          key,
          expectedRevision: partitionRevision,
        });
        partitionRevision = result.revision;
        orphanKeys.delete(key);
      } catch {
        // Cleanup is non-authoritative. The active manifest remains the commit
        // point, so an orphan can safely be retried after a later successful save.
        return false;
      }
    }
    return true;
  }

  async function assertManifestStillCurrent() {
    const current = await appData.get(MANIFEST_KEY);
    partitionRevision = current.revision;
    if (activeManifestBytes === null) {
      if (current.found) {
        throw new Error("Notes App Data manifest changed concurrently");
      }
      return;
    }
    if (!current.found || !bytesEqual(current.value, activeManifestBytes)) {
      throw new Error("Notes App Data manifest changed concurrently");
    }
  }

  async function commitSnapshot(snapshot) {
    await assertManifestStillCurrent();
    await cleanupOrphans();

    const previousRecords = records;
    const nextRecords = new Map();
    const changedWrites = [];
    let allocatedNextSlot = nextSlot;

    for (const note of snapshot.notes) {
      const persisted = persistedNote(note);
      const previous = previousRecords.get(note.id) ?? null;
      if (previous && previous.serialized === persisted.serialized) {
        nextRecords.set(note.id, previous);
        continue;
      }

      const slot = previous?.ref.slot ?? allocatedNextSlot++;
      const version = previous ? previous.ref.version + 1 : 1;
      if (!Number.isSafeInteger(version)) {
        throw new RangeError("Notes App Data note version is exhausted");
      }
      const ref = Object.freeze({
        id: note.id,
        key: noteKey(slot, version),
        slot,
        version,
      });
      changedWrites.push(Object.freeze({ ref, persisted }));
      nextRecords.set(note.id, Object.freeze({
        ref,
        serialized: persisted.serialized,
      }));
    }

    for (const write of changedWrites) {
      const result = await appData.put({
        key: write.ref.key,
        value: write.persisted.bytes,
        expectedRevision: partitionRevision,
      });
      partitionRevision = result.revision;
      orphanKeys.add(write.ref.key);
    }

    const manifest = validateManifest({
      $schema: NOTES_APP_DATA_MANIFEST_SCHEMA,
      snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
      selectedProjectId: snapshot.selectedProjectId,
      selectedNoteId: snapshot.selectedNoteId,
      projects: snapshot.projects,
      notes: snapshot.notes.map((note) => nextRecords.get(note.id).ref),
      nextSlot: allocatedNextSlot,
    });
    const manifestBytes = jsonBytes(manifest);
    if (manifestBytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
      throw new RangeError("Notes App Data manifest exceeds the per-value hard bound");
    }

    const manifestCommit = await appData.put({
      key: MANIFEST_KEY,
      value: manifestBytes,
      expectedRevision: partitionRevision,
    });
    partitionRevision = manifestCommit.revision;

    const previousKeys = new Set([...previousRecords.values()].map((record) => record.ref.key));
    const nextKeys = new Set([...nextRecords.values()].map((record) => record.ref.key));
    for (const key of previousKeys) {
      if (!nextKeys.has(key)) orphanKeys.add(key);
    }
    for (const key of nextKeys) orphanKeys.delete(key);

    activeManifest = manifest;
    activeManifestBytes = manifestBytes;
    records = nextRecords;
    nextSlot = allocatedNextSlot;
    await cleanupOrphans();
  }

  async function drainDesiredSnapshot() {
    while (durableRevision < desiredRevision) {
      const targetRevision = desiredRevision;
      const snapshot = memory;
      try {
        await commitSnapshot(snapshot);
        durableRevision = Math.max(durableRevision, targetRevision);
        if (targetRevision === desiredRevision) lastPersistError = null;
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
      const validated = validateNotesSnapshot(snapshotValue);
      memory = validated;
      if (!snapshotFitsPerValueBounds(validated)) {
        lastPersistError = new RangeError("Notes content exceeds App Data record bounds");
        return false;
      }
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

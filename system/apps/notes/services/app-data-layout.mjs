import {
  MAX_APP_DATA_KEY_CHARS,
  MAX_APP_DATA_PARTITION_BYTES,
  MAX_APP_DATA_PARTITION_KEYS,
  MAX_APP_DATA_VALUE_BYTES,
  validateAppDataBytes,
  validateAppDataKey,
} from "../../../contracts/app-data.mjs";
import {
  MAX_NOTE_PROJECTS,
  MAX_NOTES,
  NOTES_SNAPSHOT_SCHEMA,
  validateNotesSnapshot,
} from "../../../contracts/notes-store.mjs";

export const NOTES_APP_DATA_LAYOUT_SCHEMA = "ordax.notes-app-data-layout/2";
export const NOTES_APP_DATA_HEAD_SCHEMA = "ordax.notes-app-data-head/2";
export const NOTES_APP_DATA_PROJECT_SCHEMA = "ordax.notes-app-data-project/1";
export const NOTES_APP_DATA_NOTE_SCHEMA = "ordax.notes-app-data-note/1";
export const NOTES_APP_DATA_HEAD_KEY = "head";

// App Data is finite storage. This is a Notes-owned persistence-capacity bound,
// not a reduction of the Notes content model. It keeps old + new snapshots plus
// metadata safely below the 64 MiB App Data partition hard ceiling while a
// crash-safe head transition is in flight.
export const MAX_NOTES_APP_DATA_SNAPSHOT_BYTES = 24 * 1024 * 1024;
export const NOTES_APP_DATA_NOTE_CHUNK_BYTES = 512 * 1024;
export const MAX_NOTES_APP_DATA_NOTE_CHUNKS = Math.ceil(
  MAX_NOTES_APP_DATA_SNAPSHOT_BYTES / NOTES_APP_DATA_NOTE_CHUNK_BYTES,
);
export const MAX_NOTES_APP_DATA_TRANSITION_BYTES =
  (2 * MAX_NOTES_APP_DATA_SNAPSHOT_BYTES) + (4 * MAX_APP_DATA_VALUE_BYTES);

// Each note consumes at least one chunk. The snapshot byte budget can add at
// most MAX_NOTES_APP_DATA_NOTE_CHUNKS extra chunks beyond that baseline.
export const MAX_NOTES_APP_DATA_KEYS =
  2
  + (MAX_NOTE_PROJECTS * 2)
  + (2 * (MAX_NOTES + MAX_NOTES_APP_DATA_NOTE_CHUNKS));

if (NOTES_APP_DATA_NOTE_CHUNK_BYTES > MAX_APP_DATA_VALUE_BYTES) {
  throw new Error("Notes App Data chunk exceeds App Data per-value ceiling");
}
if (MAX_NOTES_APP_DATA_TRANSITION_BYTES >= MAX_APP_DATA_PARTITION_BYTES) {
  throw new Error("Notes App Data transition byte budget exceeds App Data partition ceiling");
}
if (MAX_NOTES_APP_DATA_KEYS >= MAX_APP_DATA_PARTITION_KEYS) {
  throw new Error("Notes App Data key budget exceeds App Data partition ceiling");
}

// The current Notes id grammar is deliberately narrower than App Data's key
// alphabet. Uppercase Z is therefore available as an injective escape for ':'.
const NOTES_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const ENCODED_NOTES_ID_RE = /^[a-z0-9][a-z0-9._Z-]{0,95}$/;
const COLON_ESCAPE = "Z";
const SLOT_VALUES = new Set([0, 1]);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
  return value;
}

function validNotesId(value, label = "Notes id") {
  if (typeof value !== "string" || !NOTES_ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function encodeNotesAppDataId(value) {
  const id = validNotesId(value);
  const encoded = id.replaceAll(":", COLON_ESCAPE);
  if (!ENCODED_NOTES_ID_RE.test(encoded)) {
    throw new TypeError("Encoded Notes id is invalid");
  }
  return encoded;
}

export function decodeNotesAppDataId(value) {
  if (typeof value !== "string" || !ENCODED_NOTES_ID_RE.test(value)) {
    throw new TypeError("Encoded Notes id is invalid");
  }
  return validNotesId(value.replaceAll(COLON_ESCAPE, ":"));
}

function projectKey(id, slot) {
  if (!SLOT_VALUES.has(slot)) throw new TypeError("Notes App Data slot is invalid");
  const key = `p.${encodeNotesAppDataId(id)}.${slot}`;
  if (key.length > MAX_APP_DATA_KEY_CHARS) {
    throw new RangeError("Notes App Data project key exceeds App Data bound");
  }
  return validateAppDataKey(key);
}

export function notesProjectAppDataKey(id, slot) {
  return projectKey(id, slot);
}

export function notesNoteAppDataKey(id, slot, chunkIndex = 0) {
  if (!SLOT_VALUES.has(slot)) throw new TypeError("Notes App Data slot is invalid");
  if (
    !Number.isInteger(chunkIndex)
    || chunkIndex < 0
    || chunkIndex >= MAX_NOTES_APP_DATA_NOTE_CHUNKS
  ) {
    throw new RangeError("Notes App Data note chunk index is invalid");
  }
  const key = `n.${encodeNotesAppDataId(id)}.${slot}.${chunkIndex}`;
  if (key.length > MAX_APP_DATA_KEY_CHARS) {
    throw new RangeError("Notes App Data note chunk key exceeds App Data bound");
  }
  return validateAppDataKey(key);
}

export function notesNoteAppDataKeys(id, slot, chunks) {
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_NOTES_APP_DATA_NOTE_CHUNKS) {
    throw new RangeError("Notes App Data note chunk count is invalid");
  }
  return Object.freeze(Array.from(
    { length: chunks },
    (_, index) => notesNoteAppDataKey(id, slot, index),
  ));
}

function rawCanonicalBytes(value) {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

function canonicalBytes(value) {
  const bytes = rawCanonicalBytes(value);
  if (bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("Notes App Data metadata record exceeds App Data value bound");
  }
  return validateAppDataBytes(bytes);
}

function decodeJsonBytes(value, label) {
  const bytes = validateAppDataBytes(value);
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new TypeError(`${label} is not valid UTF-8 JSON`, { cause: error });
  }
}

function decodeRawJsonBytes(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_NOTES_APP_DATA_SNAPSHOT_BYTES) {
    throw new RangeError(`${label} exceeds Notes App Data storage capacity`);
  }
  try {
    return JSON.parse(decoder.decode(value));
  } catch (error) {
    throw new TypeError(`${label} is not valid UTF-8 JSON`, { cause: error });
  }
}

function assertSnapshotStorageBudget(snapshot) {
  const bytes = rawCanonicalBytes(snapshot);
  if (bytes.byteLength > MAX_NOTES_APP_DATA_SNAPSHOT_BYTES) {
    throw new RangeError("Notes snapshot exceeds App Data storage capacity");
  }
  return snapshot;
}

function normalizeProjectHeadEntry(value, label) {
  exactKeys(value, ["id", "slot"], label);
  const id = validNotesId(value.id, `${label} id`);
  if (!SLOT_VALUES.has(value.slot)) throw new TypeError(`${label} slot is invalid`);
  return Object.freeze({ id, slot: value.slot });
}

function normalizeNoteHeadEntry(value, label) {
  exactKeys(value, ["id", "slot", "chunks"], label);
  const id = validNotesId(value.id, `${label} id`);
  if (!SLOT_VALUES.has(value.slot)) throw new TypeError(`${label} slot is invalid`);
  if (!Number.isInteger(value.chunks) || value.chunks < 1 || value.chunks > MAX_NOTES_APP_DATA_NOTE_CHUNKS) {
    throw new RangeError(`${label} chunk count is invalid`);
  }
  return Object.freeze({ id, slot: value.slot, chunks: value.chunks });
}

export function validateNotesAppDataHead(value) {
  const head = exactKeys(
    value,
    ["$schema", "layoutSchema", "snapshotSchema", "selectedProjectId", "selectedNoteId", "projects", "notes"],
    "Notes App Data head",
  );
  if (head.$schema !== NOTES_APP_DATA_HEAD_SCHEMA || head.layoutSchema !== NOTES_APP_DATA_LAYOUT_SCHEMA) {
    throw new TypeError("Notes App Data head schema is incompatible");
  }
  if (head.snapshotSchema !== NOTES_SNAPSHOT_SCHEMA) {
    throw new TypeError("Notes App Data snapshot schema is incompatible");
  }
  if (!Array.isArray(head.projects) || !Array.isArray(head.notes)) {
    throw new TypeError("Notes App Data head entity lists are invalid");
  }
  if (head.projects.length < 1 || head.projects.length > MAX_NOTE_PROJECTS || head.notes.length > MAX_NOTES) {
    throw new RangeError("Notes App Data head entity count is invalid");
  }
  const projects = head.projects.map((entry) => normalizeProjectHeadEntry(entry, "Notes project head entry"));
  const notes = head.notes.map((entry) => normalizeNoteHeadEntry(entry, "Notes note head entry"));
  const projectIds = new Set(projects.map(({ id }) => id));
  const noteIds = new Set(notes.map(({ id }) => id));
  if (projectIds.size !== projects.length || noteIds.size !== notes.length) {
    throw new TypeError("Notes App Data head ids must be unique");
  }
  const selectedProjectId = validNotesId(head.selectedProjectId, "Selected project id");
  if (!projectIds.has(selectedProjectId)) throw new TypeError("Selected project is absent from Notes App Data head");
  const selectedNoteId = head.selectedNoteId === null
    ? null
    : validNotesId(head.selectedNoteId, "Selected note id");
  if (selectedNoteId !== null && !noteIds.has(selectedNoteId)) {
    throw new TypeError("Selected note is absent from Notes App Data head");
  }
  return Object.freeze({
    $schema: NOTES_APP_DATA_HEAD_SCHEMA,
    layoutSchema: NOTES_APP_DATA_LAYOUT_SCHEMA,
    snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId,
    selectedNoteId,
    projects: Object.freeze(projects),
    notes: Object.freeze(notes),
  });
}

export function encodeNotesAppDataHead(value) {
  return canonicalBytes(validateNotesAppDataHead(value));
}

export function decodeNotesAppDataHead(value) {
  return validateNotesAppDataHead(decodeJsonBytes(value, "Notes App Data head"));
}

function projectRecord(project) {
  return Object.freeze({ $schema: NOTES_APP_DATA_PROJECT_SCHEMA, project });
}

function noteRecord(note) {
  return Object.freeze({ $schema: NOTES_APP_DATA_NOTE_SCHEMA, note });
}

function encodeProject(project) {
  return canonicalBytes(projectRecord(project));
}

function encodeNoteChunks(note) {
  const bytes = rawCanonicalBytes(noteRecord(note));
  if (bytes.byteLength > MAX_NOTES_APP_DATA_SNAPSHOT_BYTES) {
    throw new RangeError("Notes note exceeds App Data storage capacity");
  }
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += NOTES_APP_DATA_NOTE_CHUNK_BYTES) {
    chunks.push(validateAppDataBytes(bytes.slice(offset, offset + NOTES_APP_DATA_NOTE_CHUNK_BYTES)));
  }
  if (chunks.length < 1 || chunks.length > MAX_NOTES_APP_DATA_NOTE_CHUNKS) {
    throw new RangeError("Notes note chunk count exceeds App Data storage capacity");
  }
  return Object.freeze(chunks);
}

function decodeProject(value, expectedId) {
  const record = exactKeys(decodeJsonBytes(value, "Notes project record"), ["$schema", "project"], "Notes project record");
  if (record.$schema !== NOTES_APP_DATA_PROJECT_SCHEMA || record.project?.id !== expectedId) {
    throw new TypeError("Notes project record binding is invalid");
  }
  return record.project;
}

function concatChunks(values, label) {
  let total = 0;
  const chunks = values.map((value) => {
    const chunk = validateAppDataBytes(value);
    total += chunk.byteLength;
    if (total > MAX_NOTES_APP_DATA_SNAPSHOT_BYTES) {
      throw new RangeError(`${label} exceeds Notes App Data storage capacity`);
    }
    return chunk;
  });
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeNote(values, expectedId) {
  const record = exactKeys(
    decodeRawJsonBytes(concatChunks(values, "Notes note record"), "Notes note record"),
    ["$schema", "note"],
    "Notes note record",
  );
  if (record.$schema !== NOTES_APP_DATA_NOTE_SCHEMA || record.note?.id !== expectedId) {
    throw new TypeError("Notes note record binding is invalid");
  }
  return record.note;
}

function headFromSnapshot(snapshot, projectSlots, noteSlots, noteChunkCounts) {
  return validateNotesAppDataHead({
    $schema: NOTES_APP_DATA_HEAD_SCHEMA,
    layoutSchema: NOTES_APP_DATA_LAYOUT_SCHEMA,
    snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: snapshot.selectedProjectId,
    selectedNoteId: snapshot.selectedNoteId,
    projects: snapshot.projects.map(({ id }) => ({ id, slot: projectSlots.get(id) })),
    notes: snapshot.notes.map(({ id }) => ({
      id,
      slot: noteSlots.get(id),
      chunks: noteChunkCounts.get(id),
    })),
  });
}

function entityMap(values) {
  return new Map(values.map((value) => [value.id, value]));
}

function sameEntity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function noteWrites(note, slot, chunks = encodeNoteChunks(note)) {
  return chunks.map((value, index) => Object.freeze({
    key: notesNoteAppDataKey(note.id, slot, index),
    value,
  }));
}

export function createInitialNotesAppDataLayout(rawSnapshot) {
  const snapshot = assertSnapshotStorageBudget(validateNotesSnapshot(rawSnapshot));
  const projectSlots = new Map(snapshot.projects.map(({ id }) => [id, 0]));
  const noteSlots = new Map(snapshot.notes.map(({ id }) => [id, 0]));
  const encodedNotes = new Map(snapshot.notes.map((note) => [note.id, encodeNoteChunks(note)]));
  const noteChunkCounts = new Map([...encodedNotes].map(([id, chunks]) => [id, chunks.length]));
  const head = headFromSnapshot(snapshot, projectSlots, noteSlots, noteChunkCounts);
  const stagedWrites = [
    ...snapshot.projects.map((project) => Object.freeze({
      key: notesProjectAppDataKey(project.id, 0),
      value: encodeProject(project),
    })),
    ...snapshot.notes.flatMap((note) => noteWrites(note, 0, encodedNotes.get(note.id))),
  ];
  return Object.freeze({
    snapshot,
    head,
    stagedWrites: Object.freeze(stagedWrites),
    headWrite: Object.freeze({ key: NOTES_APP_DATA_HEAD_KEY, value: encodeNotesAppDataHead(head) }),
  });
}

function assertHeadMatchesSnapshot(head, snapshot) {
  if (
    head.selectedProjectId !== snapshot.selectedProjectId
    || head.selectedNoteId !== snapshot.selectedNoteId
    || head.projects.length !== snapshot.projects.length
    || head.notes.length !== snapshot.notes.length
    || head.projects.some((entry, index) => entry.id !== snapshot.projects[index].id)
    || head.notes.some((entry, index) => entry.id !== snapshot.notes[index].id)
  ) {
    throw new TypeError("Notes App Data head does not match current Notes snapshot");
  }
}

export function planNotesAppDataTransition(rawCurrentHead, rawCurrentSnapshot, rawNextSnapshot) {
  const currentHead = validateNotesAppDataHead(rawCurrentHead);
  const current = assertSnapshotStorageBudget(validateNotesSnapshot(rawCurrentSnapshot));
  const next = assertSnapshotStorageBudget(validateNotesSnapshot(rawNextSnapshot));
  assertHeadMatchesSnapshot(currentHead, current);

  const currentProjects = entityMap(current.projects);
  const currentNotes = entityMap(current.notes);
  const currentProjectSlots = new Map(currentHead.projects.map(({ id, slot }) => [id, slot]));
  const currentNoteEntries = new Map(currentHead.notes.map((entry) => [entry.id, entry]));
  const nextProjectSlots = new Map();
  const nextNoteSlots = new Map();
  const nextNoteChunkCounts = new Map();
  const stagedWrites = [];

  for (const project of next.projects) {
    const previous = currentProjects.get(project.id);
    if (previous && sameEntity(previous, project)) {
      nextProjectSlots.set(project.id, currentProjectSlots.get(project.id));
      continue;
    }
    const slot = previous ? 1 - currentProjectSlots.get(project.id) : 0;
    nextProjectSlots.set(project.id, slot);
    stagedWrites.push(Object.freeze({ key: notesProjectAppDataKey(project.id, slot), value: encodeProject(project) }));
  }

  for (const note of next.notes) {
    const previous = currentNotes.get(note.id);
    if (previous && sameEntity(previous, note)) {
      const currentEntry = currentNoteEntries.get(note.id);
      nextNoteSlots.set(note.id, currentEntry.slot);
      nextNoteChunkCounts.set(note.id, currentEntry.chunks);
      continue;
    }
    const currentEntry = previous ? currentNoteEntries.get(note.id) : null;
    const slot = currentEntry ? 1 - currentEntry.slot : 0;
    const chunks = encodeNoteChunks(note);
    nextNoteSlots.set(note.id, slot);
    nextNoteChunkCounts.set(note.id, chunks.length);
    stagedWrites.push(...noteWrites(note, slot, chunks));
  }

  const head = headFromSnapshot(next, nextProjectSlots, nextNoteSlots, nextNoteChunkCounts);
  const currentHeadBytes = encodeNotesAppDataHead(currentHead);
  const nextHeadBytes = encodeNotesAppDataHead(head);
  const headChanged = !sameBytes(currentHeadBytes, nextHeadBytes);

  return Object.freeze({
    snapshot: next,
    head,
    stagedWrites: Object.freeze(stagedWrites),
    headChanged,
    headWrite: Object.freeze({ key: NOTES_APP_DATA_HEAD_KEY, value: nextHeadBytes }),
  });
}

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function reconstructNotesSnapshotFromAppData(rawHead, values) {
  const head = validateNotesAppDataHead(rawHead);
  if (!(values instanceof Map)) throw new TypeError("Notes App Data values must be a Map");

  const projects = head.projects.map(({ id, slot }) => {
    const value = values.get(notesProjectAppDataKey(id, slot));
    if (value === undefined) throw new TypeError("Notes App Data active project record is missing");
    return decodeProject(value, id);
  });
  const notes = head.notes.map(({ id, slot, chunks }) => {
    const valuesForNote = notesNoteAppDataKeys(id, slot, chunks).map((key) => {
      const value = values.get(key);
      if (value === undefined) throw new TypeError("Notes App Data active note chunk is missing");
      return value;
    });
    return decodeNote(valuesForNote, id);
  });

  return assertSnapshotStorageBudget(validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: head.selectedProjectId,
    selectedNoteId: head.selectedNoteId,
    projects,
    notes,
  }));
}

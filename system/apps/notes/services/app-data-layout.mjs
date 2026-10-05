import {
  MAX_APP_DATA_KEY_CHARS,
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

export const NOTES_APP_DATA_LAYOUT_SCHEMA = "ordax.notes-app-data-layout/1";
export const NOTES_APP_DATA_HEAD_SCHEMA = "ordax.notes-app-data-head/1";
export const NOTES_APP_DATA_PROJECT_SCHEMA = "ordax.notes-app-data-project/1";
export const NOTES_APP_DATA_NOTE_SCHEMA = "ordax.notes-app-data-note/1";
export const NOTES_APP_DATA_HEAD_KEY = "head";

// The current Notes id grammar is deliberately narrower than App Data's key
// alphabet. Uppercase Z is therefore available as an injective escape for ':'.
const NOTES_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const ENCODED_NOTES_ID_RE = /^[a-z0-9][a-z0-9._Z-]{0,95}$/;
const COLON_ESCAPE = "Z";
const SLOT_VALUES = new Set([0, 1]);

export const MAX_NOTES_APP_DATA_KEYS = 1 + (MAX_NOTE_PROJECTS * 2) + (MAX_NOTES * 2);

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

function entityKey(kind, id, slot) {
  if (kind !== "p" && kind !== "n") throw new TypeError("Notes App Data entity kind is invalid");
  if (!SLOT_VALUES.has(slot)) throw new TypeError("Notes App Data slot is invalid");
  const key = `${kind}.${encodeNotesAppDataId(id)}.${slot}`;
  if (key.length > MAX_APP_DATA_KEY_CHARS) {
    throw new RangeError("Notes App Data entity key exceeds App Data bound");
  }
  return validateAppDataKey(key);
}

export function notesProjectAppDataKey(id, slot) {
  return entityKey("p", id, slot);
}

export function notesNoteAppDataKey(id, slot) {
  return entityKey("n", id, slot);
}

function canonicalBytes(value) {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  if (bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("Notes App Data record exceeds App Data value bound");
  }
  return validateAppDataBytes(bytes);
}

function decodeJsonBytes(value, label) {
  const bytes = validateAppDataBytes(value);
  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError(`${label} is not valid UTF-8 JSON`, { cause: error });
  }
  return decoded;
}

function normalizeHeadEntry(value, label) {
  exactKeys(value, ["id", "slot"], label);
  const id = validNotesId(value.id, `${label} id`);
  if (!SLOT_VALUES.has(value.slot)) throw new TypeError(`${label} slot is invalid`);
  return Object.freeze({ id, slot: value.slot });
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
  const projects = head.projects.map((entry) => normalizeHeadEntry(entry, "Notes project head entry"));
  const notes = head.notes.map((entry) => normalizeHeadEntry(entry, "Notes note head entry"));
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

function encodeNote(note) {
  return canonicalBytes(noteRecord(note));
}

function decodeProject(value, expectedId) {
  const record = exactKeys(decodeJsonBytes(value, "Notes project record"), ["$schema", "project"], "Notes project record");
  if (record.$schema !== NOTES_APP_DATA_PROJECT_SCHEMA || record.project?.id !== expectedId) {
    throw new TypeError("Notes project record binding is invalid");
  }
  return record.project;
}

function decodeNote(value, expectedId) {
  const record = exactKeys(decodeJsonBytes(value, "Notes note record"), ["$schema", "note"], "Notes note record");
  if (record.$schema !== NOTES_APP_DATA_NOTE_SCHEMA || record.note?.id !== expectedId) {
    throw new TypeError("Notes note record binding is invalid");
  }
  return record.note;
}

function headFromSnapshot(snapshot, projectSlots, noteSlots) {
  return validateNotesAppDataHead({
    $schema: NOTES_APP_DATA_HEAD_SCHEMA,
    layoutSchema: NOTES_APP_DATA_LAYOUT_SCHEMA,
    snapshotSchema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: snapshot.selectedProjectId,
    selectedNoteId: snapshot.selectedNoteId,
    projects: snapshot.projects.map(({ id }) => ({ id, slot: projectSlots.get(id) })),
    notes: snapshot.notes.map(({ id }) => ({ id, slot: noteSlots.get(id) })),
  });
}

function entityMap(values) {
  return new Map(values.map((value) => [value.id, value]));
}

function sameEntity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createInitialNotesAppDataLayout(rawSnapshot) {
  const snapshot = validateNotesSnapshot(rawSnapshot);
  const projectSlots = new Map(snapshot.projects.map(({ id }) => [id, 0]));
  const noteSlots = new Map(snapshot.notes.map(({ id }) => [id, 0]));
  const head = headFromSnapshot(snapshot, projectSlots, noteSlots);
  const stagedWrites = [
    ...snapshot.projects.map((project) => Object.freeze({
      key: notesProjectAppDataKey(project.id, 0),
      value: encodeProject(project),
    })),
    ...snapshot.notes.map((note) => Object.freeze({
      key: notesNoteAppDataKey(note.id, 0),
      value: encodeNote(note),
    })),
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
  const current = validateNotesSnapshot(rawCurrentSnapshot);
  const next = validateNotesSnapshot(rawNextSnapshot);
  assertHeadMatchesSnapshot(currentHead, current);

  const currentProjects = entityMap(current.projects);
  const currentNotes = entityMap(current.notes);
  const currentProjectSlots = new Map(currentHead.projects.map(({ id, slot }) => [id, slot]));
  const currentNoteSlots = new Map(currentHead.notes.map(({ id, slot }) => [id, slot]));
  const nextProjectSlots = new Map();
  const nextNoteSlots = new Map();
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
      nextNoteSlots.set(note.id, currentNoteSlots.get(note.id));
      continue;
    }
    const slot = previous ? 1 - currentNoteSlots.get(note.id) : 0;
    nextNoteSlots.set(note.id, slot);
    stagedWrites.push(Object.freeze({ key: notesNoteAppDataKey(note.id, slot), value: encodeNote(note) }));
  }

  const head = headFromSnapshot(next, nextProjectSlots, nextNoteSlots);
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
  const notes = head.notes.map(({ id, slot }) => {
    const value = values.get(notesNoteAppDataKey(id, slot));
    if (value === undefined) throw new TypeError("Notes App Data active note record is missing");
    return decodeNote(value, id);
  });

  return validateNotesSnapshot({
    $schema: NOTES_SNAPSHOT_SCHEMA,
    selectedProjectId: head.selectedProjectId,
    selectedNoteId: head.selectedNoteId,
    projects,
    notes,
  });
}

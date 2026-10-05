import {
  MAX_APP_DATA_PARTITION_KEYS,
  MAX_APP_DATA_VALUE_BYTES,
  validateAppDataBytes,
  validateAppDataKey,
} from "../../../contracts/app-data.mjs";
import { validateNotesSnapshot } from "../../../contracts/notes-store.mjs";
import {
  MAX_NOTES_APP_DATA_KEYS,
  MAX_NOTES_APP_DATA_NOTE_CHUNKS,
  NOTES_APP_DATA_HEAD_KEY,
  decodeNotesAppDataId,
  encodeNotesAppDataHead,
  notesNoteAppDataKeys,
  notesProjectAppDataKey,
  planNotesAppDataTransition,
  validateNotesAppDataHead,
} from "./app-data-layout.mjs";

export const NOTES_APP_DATA_TRANSITION_JOURNAL_SCHEMA = "ordax.notes-app-data-transition-journal/2";
export const NOTES_APP_DATA_TRANSITION_JOURNAL_KEY = "transition-journal";

const MAX_TRANSITION_KEYS = MAX_NOTES_APP_DATA_KEYS - 2;
export const MAX_NOTES_APP_DATA_TRANSACTION_KEYS = 2 + (2 * MAX_TRANSITION_KEYS);

if (MAX_NOTES_APP_DATA_TRANSACTION_KEYS >= MAX_APP_DATA_PARTITION_KEYS) {
  throw new Error("Notes App Data transaction operation bound exceeds App Data partition ceiling");
}

const PROJECT_KEY_RE = /^p\.([a-z0-9][a-z0-9._Z-]{0,95})\.([01])$/;
const NOTE_CHUNK_KEY_RE = /^n\.([a-z0-9][a-z0-9._Z-]{0,95})\.([01])\.([0-9]{1,2})$/;

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

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameHead(left, right) {
  return sameBytes(encodeNotesAppDataHead(left), encodeNotesAppDataHead(right));
}

function activeKeys(head) {
  return new Set([
    ...head.projects.map(({ id, slot }) => notesProjectAppDataKey(id, slot)),
    ...head.notes.flatMap(({ id, slot, chunks }) => notesNoteAppDataKeys(id, slot, chunks)),
  ]);
}

function parseEntityKey(value, label) {
  const key = validateAppDataKey(value);
  const projectMatch = PROJECT_KEY_RE.exec(key);
  if (projectMatch) {
    return Object.freeze({
      key,
      kind: "p",
      id: decodeNotesAppDataId(projectMatch[1]),
      slot: Number(projectMatch[2]),
      chunk: null,
    });
  }
  const noteMatch = NOTE_CHUNK_KEY_RE.exec(key);
  if (noteMatch) {
    const chunk = Number(noteMatch[3]);
    if (!Number.isInteger(chunk) || chunk < 0 || chunk >= MAX_NOTES_APP_DATA_NOTE_CHUNKS) {
      throw new TypeError(`${label} note chunk index is invalid`);
    }
    return Object.freeze({
      key,
      kind: "n",
      id: decodeNotesAppDataId(noteMatch[1]),
      slot: Number(noteMatch[2]),
      chunk,
    });
  }
  throw new TypeError(`${label} is not a Notes entity key`);
}

function normalizeKeyList(value, label) {
  if (!Array.isArray(value) || value.length > MAX_TRANSITION_KEYS) {
    throw new RangeError(`${label} is invalid or unbounded`);
  }
  const keys = value.map((key) => validateAppDataKey(key));
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} contains duplicate keys`);
  return Object.freeze([...keys].sort());
}

function canonicalBytes(value) {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  if (bytes.byteLength > MAX_APP_DATA_VALUE_BYTES) {
    throw new RangeError("Notes App Data transition journal exceeds App Data value bound");
  }
  return validateAppDataBytes(bytes);
}

function decodeJsonBytes(value) {
  const bytes = validateAppDataBytes(value);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError("Notes App Data transition journal is not valid UTF-8 JSON", { cause: error });
  }
}

function sameSortedKeys(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function validateNotesAppDataTransitionJournal(value) {
  const journal = exactKeys(
    value,
    ["$schema", "sourceHead", "targetHead", "stagedKeys", "cleanupKeys"],
    "Notes App Data transition journal",
  );
  if (journal.$schema !== NOTES_APP_DATA_TRANSITION_JOURNAL_SCHEMA) {
    throw new TypeError("Notes App Data transition journal schema is incompatible");
  }

  const sourceHead = validateNotesAppDataHead(journal.sourceHead);
  const targetHead = validateNotesAppDataHead(journal.targetHead);
  if (sameHead(sourceHead, targetHead)) {
    throw new TypeError("Notes App Data transition journal must describe a real head transition");
  }

  const stagedKeys = normalizeKeyList(journal.stagedKeys, "Notes staged key list");
  const cleanupKeys = normalizeKeyList(journal.cleanupKeys, "Notes cleanup key list");
  const sourceActive = activeKeys(sourceHead);
  const targetActive = activeKeys(targetHead);

  for (const key of stagedKeys) {
    parseEntityKey(key, "Notes staged key");
    if (!targetActive.has(key) || sourceActive.has(key)) {
      throw new TypeError("Notes staged key binding is unsafe");
    }
  }

  for (const key of cleanupKeys) {
    parseEntityKey(key, "Notes cleanup key");
    if (!sourceActive.has(key) || targetActive.has(key)) {
      throw new TypeError("Notes cleanup key binding is unsafe");
    }
  }

  if (stagedKeys.some((key) => cleanupKeys.includes(key))) {
    throw new TypeError("Notes transition journal cannot stage and clean the same key");
  }

  const expectedStaged = [...targetActive].filter((key) => !sourceActive.has(key)).sort();
  const expectedCleanup = [...sourceActive].filter((key) => !targetActive.has(key)).sort();
  if (!sameSortedKeys(stagedKeys, expectedStaged) || !sameSortedKeys(cleanupKeys, expectedCleanup)) {
    throw new TypeError("Notes transition journal must exactly cover the head key delta");
  }

  return Object.freeze({
    $schema: NOTES_APP_DATA_TRANSITION_JOURNAL_SCHEMA,
    sourceHead,
    targetHead,
    stagedKeys,
    cleanupKeys,
  });
}

export function encodeNotesAppDataTransitionJournal(value) {
  return canonicalBytes(validateNotesAppDataTransitionJournal(value));
}

export function decodeNotesAppDataTransitionJournal(value) {
  return validateNotesAppDataTransitionJournal(decodeJsonBytes(value));
}

export function planCrashSafeNotesAppDataTransition(rawCurrentHead, rawCurrentSnapshot, rawNextSnapshot) {
  const sourceHead = validateNotesAppDataHead(rawCurrentHead);
  const current = validateNotesSnapshot(rawCurrentSnapshot);
  const basePlan = planNotesAppDataTransition(sourceHead, current, rawNextSnapshot);

  const sourceActive = activeKeys(sourceHead);
  const targetActive = activeKeys(basePlan.head);
  const stagedKeys = basePlan.stagedWrites.map(({ key }) => key).sort();
  const cleanupKeys = [...sourceActive].filter((key) => !targetActive.has(key)).sort();

  const expectedStaged = [...targetActive].filter((key) => !sourceActive.has(key)).sort();
  if (!sameSortedKeys(stagedKeys, expectedStaged)) {
    throw new TypeError("Notes staged writes do not exactly cover the target head delta");
  }

  const journalRequired = basePlan.headChanged && (stagedKeys.length > 0 || cleanupKeys.length > 0);
  const journal = journalRequired
    ? validateNotesAppDataTransitionJournal({
      $schema: NOTES_APP_DATA_TRANSITION_JOURNAL_SCHEMA,
      sourceHead,
      targetHead: basePlan.head,
      stagedKeys,
      cleanupKeys,
    })
    : null;

  return Object.freeze({
    ...basePlan,
    journalRequired,
    journalWrite: journal === null
      ? null
      : Object.freeze({
        key: NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
        value: encodeNotesAppDataTransitionJournal(journal),
      }),
    cleanupKeys: Object.freeze(cleanupKeys),
  });
}

export function recoverNotesAppDataTransition(rawJournal, rawCurrentHead) {
  const journal = rawJournal instanceof Uint8Array
    ? decodeNotesAppDataTransitionJournal(rawJournal)
    : validateNotesAppDataTransitionJournal(rawJournal);
  const currentHead = validateNotesAppDataHead(rawCurrentHead);

  if (sameHead(currentHead, journal.sourceHead)) {
    return Object.freeze({
      status: "rollback-staging",
      deleteKeys: journal.stagedKeys,
      journalDeleteKey: NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
    });
  }
  if (sameHead(currentHead, journal.targetHead)) {
    return Object.freeze({
      status: "commit-cleanup",
      deleteKeys: journal.cleanupKeys,
      journalDeleteKey: NOTES_APP_DATA_TRANSITION_JOURNAL_KEY,
    });
  }
  return Object.freeze({
    status: "conflict",
    deleteKeys: Object.freeze([]),
    journalDeleteKey: null,
  });
}

export function notesAppDataTransitionWriteOrder(plan) {
  if (!plan || typeof plan !== "object") throw new TypeError("Notes App Data transition plan is required");
  if (!plan.journalRequired) {
    return Object.freeze(plan.headChanged ? ["head"] : []);
  }
  return Object.freeze(["journal", "staging", "head", "recovery-cleanup", "journal-delete"]);
}

export function assertNotesAppDataTransitionMetadataKeys() {
  if (NOTES_APP_DATA_HEAD_KEY === NOTES_APP_DATA_TRANSITION_JOURNAL_KEY) {
    throw new Error("Notes App Data head and transition journal keys must be distinct");
  }
  return true;
}

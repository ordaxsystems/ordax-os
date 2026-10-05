import {
  MAX_APP_DATA_PARTITION_KEYS,
  MAX_APP_DATA_VALUE_BYTES,
  validateAppDataBytes,
  validateAppDataKey,
} from "../../../contracts/app-data.mjs";
import {
  MAX_NOTE_PROJECTS,
  MAX_NOTES,
  validateNotesSnapshot,
} from "../../../contracts/notes-store.mjs";
import {
  NOTES_APP_DATA_HEAD_KEY,
  decodeNotesAppDataId,
  encodeNotesAppDataHead,
  notesNoteAppDataKey,
  notesProjectAppDataKey,
  planNotesAppDataTransition,
  validateNotesAppDataHead,
} from "./app-data-layout.mjs";

export const NOTES_APP_DATA_TRANSITION_JOURNAL_SCHEMA = "ordax.notes-app-data-transition-journal/1";
export const NOTES_APP_DATA_TRANSITION_JOURNAL_KEY = "transition-journal";

const MAX_ENTITY_COUNT = MAX_NOTE_PROJECTS + MAX_NOTES;
const MAX_TRANSITION_KEYS = 2 * MAX_ENTITY_COUNT;
export const MAX_NOTES_APP_DATA_TRANSACTION_KEYS = 2 + (3 * MAX_ENTITY_COUNT);

if (MAX_NOTES_APP_DATA_TRANSACTION_KEYS >= MAX_APP_DATA_PARTITION_KEYS) {
  throw new Error("Notes App Data transaction key bound exceeds App Data partition ceiling");
}

const ENTITY_KEY_RE = /^(p|n)\.([a-z0-9][a-z0-9._Z-]{0,95})\.([01])$/;

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
    ...head.notes.map(({ id, slot }) => notesNoteAppDataKey(id, slot)),
  ]);
}

function activeIds(head) {
  return {
    projects: new Set(head.projects.map(({ id }) => id)),
    notes: new Set(head.notes.map(({ id }) => id)),
  };
}

function parseEntityKey(value, label) {
  const key = validateAppDataKey(value);
  const match = ENTITY_KEY_RE.exec(key);
  if (!match) throw new TypeError(`${label} is not a Notes entity key`);
  return Object.freeze({
    key,
    kind: match[1],
    id: decodeNotesAppDataId(match[2]),
    slot: Number(match[3]),
  });
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
  const targetIds = activeIds(targetHead);

  for (const key of stagedKeys) {
    parseEntityKey(key, "Notes staged key");
    if (!targetActive.has(key) || sourceActive.has(key)) {
      throw new TypeError("Notes staged key binding is unsafe");
    }
  }

  for (const key of cleanupKeys) {
    const parsed = parseEntityKey(key, "Notes cleanup key");
    const stillPresent = parsed.kind === "p"
      ? targetIds.projects.has(parsed.id)
      : targetIds.notes.has(parsed.id);
    if (stillPresent || targetActive.has(key)) {
      throw new TypeError("Notes cleanup key targets a live entity");
    }
  }

  if (stagedKeys.some((key) => cleanupKeys.includes(key))) {
    throw new TypeError("Notes transition journal cannot stage and clean the same key");
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

function removedEntityCleanupKeys(currentValues, nextValues, keyFor) {
  const nextIds = new Set(nextValues.map(({ id }) => id));
  const keys = [];
  for (const { id } of currentValues) {
    if (nextIds.has(id)) continue;
    keys.push(keyFor(id, 0), keyFor(id, 1));
  }
  return keys;
}

export function planCrashSafeNotesAppDataTransition(rawCurrentHead, rawCurrentSnapshot, rawNextSnapshot) {
  const sourceHead = validateNotesAppDataHead(rawCurrentHead);
  const current = validateNotesSnapshot(rawCurrentSnapshot);
  const basePlan = planNotesAppDataTransition(sourceHead, current, rawNextSnapshot);
  const next = basePlan.snapshot;

  const stagedKeys = basePlan.stagedWrites.map(({ key }) => key);
  const cleanupKeys = [
    ...removedEntityCleanupKeys(current.projects, next.projects, notesProjectAppDataKey),
    ...removedEntityCleanupKeys(current.notes, next.notes, notesNoteAppDataKey),
  ].sort();

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

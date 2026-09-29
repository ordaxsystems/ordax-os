import {
  assertMemoryPort,
  validateMemoryForgetRequest,
  validateMemoryItem,
  validateMemoryOwner,
} from "../../contracts/memory.mjs";
import { assertSyncStateStorePort } from "../../contracts/sync-state-store.mjs";
import { assertSyncTransportPort } from "../../contracts/sync-transport.mjs";

export const MEMORY_SYNC_RUNTIME_SCHEMA = "ordax.memory-sync-runtime/1";
export const MEMORY_SYNC_DATA_CLASS = "memory";
export const MEMORY_SYNC_OBJECT_SCHEMA = "ordax.sync-object/1";
export const MEMORY_SYNC_MUTATION_SCHEMA = "ordax.sync-mutation/1";
export const MEMORY_SYNC_PAYLOAD_SCHEMA = "ordax.memory-sync-payload/1";
export const MEMORY_SYNC_STATE_SCHEMA = "ordax.memory-sync-state/1";
export const MEMORY_SYNC_OBJECT_SCHEMA_VERSION = 1;
export const MEMORY_SYNC_RESOLVER_VERSION = 1;
export const MEMORY_SYNC_OBJECT_PREFIX = "memory/";

const MAX_SYNC_OBJECT_ID_CHARS = 240;
const MAX_REMOTE_BATCH = 500;
const MAX_COORDINATION_ENTRIES = 500;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PORTABLE_SCOPES = new Set(["account", "space", "project"]);
const PORTABLE_SENSITIVITY = new Set(["normal", "private"]);
const CONFLICT_REASONS = new Set([
  "same-revision-divergence",
  "concurrent-remote-update",
  "server-conflict",
  "local-change-during-flight",
]);
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const encoder = new TextEncoder();

const NEVER_SYNC_TEXT_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
  /\bauthorization\s*:\s*bearer\s+[^\s]+/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
  /\b(?:access|refresh)[_-]?token\s*[:=]\s*["']?[^\s"']{8,}/i,
  /\bpassword\s*[:=]\s*["']?[^\s"']{8,}/i,
]);

function boundedSubjectId(value) {
  const owner = validateMemoryOwner({ ownerKind: "account", ownerId: value }, "Memory sync subject");
  return owner.ownerId;
}

function requireRevision(value, label = "Memory sync server revision", { allowZero = true } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  }
  return value;
}

function requireIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_RE.test(value)) {
    throw new TypeError("Memory sync idempotency key must be 8-128 safe characters");
  }
  return value;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function base64UrlUtf8(value) {
  const bytes = encoder.encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += BASE64URL[(triple >>> 18) & 63];
    output += BASE64URL[(triple >>> 12) & 63];
    if (hasB) output += BASE64URL[(triple >>> 6) & 63];
    if (hasC) output += BASE64URL[triple & 63];
  }
  return output;
}

function objectIdForMemoryId(id) {
  const value = `${MEMORY_SYNC_OBJECT_PREFIX}${base64UrlUtf8(id)}`;
  return value.length <= MAX_SYNC_OBJECT_ID_CHARS ? value : null;
}

function validateMemorySyncObjectId(value) {
  if (
    typeof value !== "string"
    || !value.startsWith(MEMORY_SYNC_OBJECT_PREFIX)
    || value.length <= MEMORY_SYNC_OBJECT_PREFIX.length
    || value.length > MAX_SYNC_OBJECT_ID_CHARS
  ) {
    throw new TypeError("Memory sync object id is invalid");
  }
  return value;
}

function containsNeverSyncText(item) {
  return NEVER_SYNC_TEXT_PATTERNS.some(
    (pattern) => pattern.test(item.content) || pattern.test(item.provenance),
  );
}

function canonicalMemoryPayload(item) {
  return Object.freeze({
    schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
    memory: item,
  });
}

function canonicalTombstonePayload(request) {
  return Object.freeze({
    schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
    memoryIdentity: Object.freeze({
      id: request.id,
      ownerKind: "account",
      ownerId: request.ownerId,
    }),
  });
}

function mutationFingerprint(mutation) {
  return JSON.stringify({
    objectSchemaVersion: mutation.objectSchemaVersion,
    resolverVersion: mutation.resolverVersion,
    tombstone: mutation.operation === "delete",
    payload: mutation.payload,
  });
}

function objectFingerprint(object) {
  return JSON.stringify({
    objectSchemaVersion: object.objectSchemaVersion,
    resolverVersion: object.resolverVersion,
    tombstone: object.tombstone,
    payload: object.payload,
  });
}

export function classifyMemoryForAccountSync(value, { subjectId } = {}) {
  const subject = boundedSubjectId(subjectId);
  const item = validateMemoryItem(value);
  if (item.ownerKind !== "account") {
    return Object.freeze({ eligible: false, reason: "device-owned", item, objectId: null });
  }
  if (item.ownerId !== subject) {
    return Object.freeze({ eligible: false, reason: "owner-mismatch", item, objectId: null });
  }
  if (!PORTABLE_SCOPES.has(item.scope)) {
    return Object.freeze({ eligible: false, reason: `${item.scope}-scope-local-only`, item, objectId: null });
  }
  if (!PORTABLE_SENSITIVITY.has(item.sensitivity)) {
    return Object.freeze({ eligible: false, reason: "restricted-not-syncable", item, objectId: null });
  }
  if (containsNeverSyncText(item)) {
    return Object.freeze({ eligible: false, reason: "never-sync-secret-material", item, objectId: null });
  }
  const objectId = objectIdForMemoryId(item.id);
  if (objectId === null) {
    return Object.freeze({ eligible: false, reason: "memory-id-not-portable-v1", item, objectId: null });
  }
  return Object.freeze({ eligible: true, reason: "eligible", item, objectId });
}

export function createMemorySyncObject({ item, serverRevision }) {
  const normalized = validateMemoryItem(item);
  const classification = classifyMemoryForAccountSync(normalized, { subjectId: normalized.ownerId });
  if (!classification.eligible) {
    throw new TypeError(`Memory item is not syncable: ${classification.reason}`);
  }
  return Object.freeze({
    $schema: MEMORY_SYNC_OBJECT_SCHEMA,
    objectId: classification.objectId,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    serverRevision: requireRevision(serverRevision, "Memory sync server revision", { allowZero: false }),
    tombstone: false,
    payload: canonicalMemoryPayload(classification.item),
  });
}

export function createMemorySyncTombstone({ id, ownerId, serverRevision }) {
  const request = validateMemoryForgetRequest({ id, ownerKind: "account", ownerId });
  const objectId = objectIdForMemoryId(request.id);
  if (objectId === null) {
    throw new TypeError("Memory id is not portable in memory sync schema v1");
  }
  return Object.freeze({
    $schema: MEMORY_SYNC_OBJECT_SCHEMA,
    objectId,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    serverRevision: requireRevision(serverRevision, "Memory sync server revision", { allowZero: false }),
    tombstone: true,
    payload: canonicalTombstonePayload(request),
  });
}

export function validateMemorySyncObject(value, { subjectId } = {}) {
  const subject = boundedSubjectId(subjectId);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory sync object must be an object");
  }
  if (value.$schema != null && value.$schema !== MEMORY_SYNC_OBJECT_SCHEMA) {
    throw new TypeError("Memory sync object envelope schema is incompatible");
  }
  if (value.dataClass !== MEMORY_SYNC_DATA_CLASS) {
    throw new TypeError("Sync object is not Memory data");
  }
  if (
    value.objectSchemaVersion !== MEMORY_SYNC_OBJECT_SCHEMA_VERSION
    || value.resolverVersion !== MEMORY_SYNC_RESOLVER_VERSION
  ) {
    throw new TypeError("Memory sync object schema/resolver version is incompatible");
  }
  const serverRevision = requireRevision(value.serverRevision, "Memory sync server revision", { allowZero: false });
  if (value.tombstone === true) {
    if (!exactKeys(value.payload, ["schema", "memoryIdentity"])) {
      throw new TypeError("Memory sync tombstone payload fields are incompatible");
    }
    if (value.payload.schema !== MEMORY_SYNC_PAYLOAD_SCHEMA) {
      throw new TypeError("Memory sync tombstone payload schema is incompatible");
    }
    if (!exactKeys(value.payload.memoryIdentity, ["id", "ownerKind", "ownerId"])) {
      throw new TypeError("Memory sync tombstone identity is incompatible");
    }
    const request = validateMemoryForgetRequest(value.payload.memoryIdentity);
    if (request.ownerKind !== "account" || request.ownerId !== subject) {
      throw new Error("Memory sync tombstone owner does not match the active account subject");
    }
    const expectedObjectId = objectIdForMemoryId(request.id);
    if (expectedObjectId === null || value.objectId !== expectedObjectId) {
      throw new Error("Memory sync tombstone stable object identity is invalid");
    }
    return createMemorySyncTombstone({
      id: request.id,
      ownerId: request.ownerId,
      serverRevision,
    });
  }
  if (value.tombstone !== false) {
    throw new TypeError("Memory sync object must declare an explicit tombstone state");
  }
  if (!exactKeys(value.payload, ["schema", "memory"])) {
    throw new TypeError("Memory sync payload fields are incompatible");
  }
  if (value.payload.schema !== MEMORY_SYNC_PAYLOAD_SCHEMA) {
    throw new TypeError("Memory sync payload schema is incompatible");
  }
  const classification = classifyMemoryForAccountSync(value.payload.memory, { subjectId: subject });
  if (!classification.eligible) {
    throw new Error(`Remote Memory object is not eligible for account sync: ${classification.reason}`);
  }
  if (value.objectId !== classification.objectId) {
    throw new Error("Memory sync stable object identity does not match Memory identity");
  }
  return createMemorySyncObject({ item: classification.item, serverRevision });
}

function createUpsertMutation(classification, baseServerRevision, idempotencyKey) {
  return Object.freeze({
    $schema: MEMORY_SYNC_MUTATION_SCHEMA,
    operation: "upsert",
    objectId: classification.objectId,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    baseServerRevision: requireRevision(baseServerRevision, "Memory sync base server revision"),
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    payload: canonicalMemoryPayload(classification.item),
  });
}

function createDeleteMutation(request, baseServerRevision, idempotencyKey) {
  const objectId = objectIdForMemoryId(request.id);
  if (objectId === null) return null;
  return Object.freeze({
    $schema: MEMORY_SYNC_MUTATION_SCHEMA,
    operation: "delete",
    objectId,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    baseServerRevision: requireRevision(baseServerRevision, "Memory sync base server revision"),
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    payload: canonicalTombstonePayload(request),
  });
}

export function validateMemorySyncMutation(value, { subjectId } = {}) {
  const subject = boundedSubjectId(subjectId);
  if (!exactKeys(value, [
    "$schema",
    "operation",
    "objectId",
    "dataClass",
    "objectSchemaVersion",
    "resolverVersion",
    "baseServerRevision",
    "idempotencyKey",
    "payload",
  ])) {
    throw new TypeError("Memory sync mutation fields are incompatible");
  }
  if (value.$schema !== MEMORY_SYNC_MUTATION_SCHEMA || value.dataClass !== MEMORY_SYNC_DATA_CLASS) {
    throw new TypeError("Memory sync mutation schema/data class is incompatible");
  }
  if (
    value.objectSchemaVersion !== MEMORY_SYNC_OBJECT_SCHEMA_VERSION
    || value.resolverVersion !== MEMORY_SYNC_RESOLVER_VERSION
  ) {
    throw new TypeError("Memory sync mutation version is incompatible");
  }
  const baseServerRevision = requireRevision(value.baseServerRevision, "Memory sync base server revision");
  const idempotencyKey = requireIdempotencyKey(value.idempotencyKey);

  if (value.operation === "upsert") {
    if (!exactKeys(value.payload, ["schema", "memory"]) || value.payload.schema !== MEMORY_SYNC_PAYLOAD_SCHEMA) {
      throw new TypeError("Memory sync upsert payload is incompatible");
    }
    const classification = classifyMemoryForAccountSync(value.payload.memory, { subjectId: subject });
    if (!classification.eligible || value.objectId !== classification.objectId) {
      throw new Error("Memory sync upsert identity is not eligible for the active account");
    }
    return createUpsertMutation(classification, baseServerRevision, idempotencyKey);
  }

  if (value.operation === "delete") {
    if (
      !exactKeys(value.payload, ["schema", "memoryIdentity"])
      || value.payload.schema !== MEMORY_SYNC_PAYLOAD_SCHEMA
      || !exactKeys(value.payload.memoryIdentity, ["id", "ownerKind", "ownerId"])
    ) {
      throw new TypeError("Memory sync delete payload is incompatible");
    }
    const request = validateMemoryForgetRequest(value.payload.memoryIdentity);
    if (request.ownerKind !== "account" || request.ownerId !== subject) {
      throw new Error("Memory sync delete owner does not match the active account");
    }
    const mutation = createDeleteMutation(request, baseServerRevision, idempotencyKey);
    if (mutation === null || value.objectId !== mutation.objectId) {
      throw new Error("Memory sync delete stable object identity is invalid");
    }
    return mutation;
  }

  throw new TypeError("Memory sync mutation operation is incompatible");
}

function validatePersistedConflict(value) {
  if (!exactKeys(value, ["objectId", "reason", "serverRevision"])) {
    throw new TypeError("Persisted Memory sync conflict fields are incompatible");
  }
  const objectId = validateMemorySyncObjectId(value.objectId);
  if (!CONFLICT_REASONS.has(value.reason)) {
    throw new TypeError("Persisted Memory sync conflict reason is incompatible");
  }
  return Object.freeze({
    objectId,
    reason: value.reason,
    serverRevision: requireRevision(
      value.serverRevision,
      "Persisted Memory sync conflict revision",
      { allowZero: false },
    ),
  });
}

function emptyRecoveredState({ recoveryBlocked = false, recoveryBlockReason = null } = {}) {
  return {
    revisions: new Map(),
    pending: new Map(),
    conflicts: new Map(),
    recovered: false,
    recoveryBlocked,
    recoveryBlockReason,
  };
}

function recoverPersistedState(store, subject) {
  if (!store) return emptyRecoveredState();
  let payload;
  try {
    payload = store.load();
  } catch {
    return emptyRecoveredState({ recoveryBlocked: true, recoveryBlockReason: "state-load-failed" });
  }
  if (payload === null) return emptyRecoveredState();

  try {
    const value = JSON.parse(payload);
    if (!exactKeys(value, ["$schema", "subjectId", "revisions", "pending", "conflicts"])) {
      throw new TypeError("Persisted Memory sync state fields are incompatible");
    }
    if (value.$schema !== MEMORY_SYNC_STATE_SCHEMA) {
      throw new TypeError("Persisted Memory sync state schema is incompatible");
    }
    const persistedSubject = boundedSubjectId(value.subjectId);
    if (persistedSubject !== subject) return emptyRecoveredState();
    if (!Array.isArray(value.revisions) || !Array.isArray(value.pending) || !Array.isArray(value.conflicts)) {
      throw new TypeError("Persisted Memory sync coordination collections are invalid");
    }
    if (
      value.revisions.length > MAX_COORDINATION_ENTRIES
      || value.pending.length > MAX_COORDINATION_ENTRIES
      || value.conflicts.length > MAX_COORDINATION_ENTRIES
    ) {
      throw new TypeError("Persisted Memory sync coordination state is too large");
    }

    const revisions = new Map();
    for (const entry of value.revisions) {
      if (!exactKeys(entry, ["objectId", "serverRevision"])) {
        throw new TypeError("Persisted Memory sync revision fields are incompatible");
      }
      const objectId = validateMemorySyncObjectId(entry.objectId);
      if (revisions.has(objectId)) throw new TypeError("Duplicate persisted Memory sync revision");
      revisions.set(objectId, requireRevision(entry.serverRevision, "Persisted Memory sync revision"));
    }

    const pending = new Map();
    for (const rawMutation of value.pending) {
      const mutation = validateMemorySyncMutation(rawMutation, { subjectId: subject });
      if (pending.has(mutation.objectId)) throw new TypeError("Duplicate persisted Memory sync mutation");
      const knownRevision = revisions.get(mutation.objectId) ?? 0;
      if (mutation.baseServerRevision > knownRevision) {
        throw new TypeError("Persisted Memory sync mutation is ahead of its known revision");
      }
      pending.set(mutation.objectId, mutation);
    }

    const conflicts = new Map();
    for (const rawConflict of value.conflicts) {
      const conflict = validatePersistedConflict(rawConflict);
      if (conflicts.has(conflict.objectId)) throw new TypeError("Duplicate persisted Memory sync conflict");
      const knownRevision = revisions.get(conflict.objectId) ?? 0;
      if (knownRevision !== conflict.serverRevision) {
        throw new TypeError("Persisted Memory sync conflict revision is inconsistent");
      }
      conflicts.set(conflict.objectId, conflict);
    }

    return {
      revisions,
      pending,
      conflicts,
      recovered: true,
      recoveryBlocked: false,
      recoveryBlockReason: null,
    };
  } catch {
    return emptyRecoveredState({ recoveryBlocked: true, recoveryBlockReason: "invalid-persisted-state" });
  }
}

function serializePersistedState(subject, revisions, pending, conflicts) {
  return JSON.stringify({
    $schema: MEMORY_SYNC_STATE_SCHEMA,
    subjectId: subject,
    revisions: [...revisions.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([objectId, serverRevision]) => ({ objectId, serverRevision })),
    pending: [...pending.values()].sort((left, right) => left.objectId.localeCompare(right.objectId)),
    conflicts: [...conflicts.values()].sort((left, right) => left.objectId.localeCompare(right.objectId)),
  });
}

export function createAccountMemorySyncRuntime({
  memoryPort,
  subjectId,
  authorizeSync,
  createIdempotencyKey,
  syncStateStore = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const subject = boundedSubjectId(subjectId);
  const stateStore = syncStateStore === null ? null : assertSyncStateStorePort(syncStateStore);
  if (typeof authorizeSync !== "function") {
    throw new TypeError("Memory account sync requires an explicit authorization policy");
  }
  if (typeof createIdempotencyKey !== "function") {
    throw new TypeError("Memory account sync requires createIdempotencyKey()");
  }

  const recovered = recoverPersistedState(stateStore, subject);
  const revisions = recovered.revisions;
  const fingerprints = new Map();
  const pending = recovered.pending;
  const conflicts = recovered.conflicts;
  const recoveryBlocked = recovered.recoveryBlocked;
  let queuePersistence = stateStore?.scope ?? "session";

  const persistCoordinationState = () => {
    if (!stateStore || recoveryBlocked) return false;
    try {
      const saved = stateStore.save(serializePersistedState(subject, revisions, pending, conflicts));
      if (saved === false) queuePersistence = "session";
      else queuePersistence = stateStore.scope;
      return saved;
    } catch {
      queuePersistence = "session";
      return false;
    }
  };

  const isAuthorized = (descriptor) => authorizeSync(Object.freeze({
    subjectId: subject,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    ...descriptor,
  })) === true;

  const recoveryBlockResult = (objectId = null) => Object.freeze({
    status: "blocked",
    reason: "coordination-recovery-required",
    objectId,
  });

  const stageUpsert = (value) => {
    const classification = classifyMemoryForAccountSync(value, { subjectId: subject });
    if (!classification.eligible) {
      return Object.freeze({ status: "local-only", reason: classification.reason, item: classification.item, objectId: null });
    }
    if (recoveryBlocked) return recoveryBlockResult(classification.objectId);
    if (!isAuthorized({ operation: "upsert", item: classification.item })) {
      return Object.freeze({ status: "blocked", reason: "authorization-required", objectId: classification.objectId });
    }
    if (conflicts.has(classification.objectId)) {
      return Object.freeze({ status: "conflict", reason: "manual-resolution-required", objectId: classification.objectId });
    }
    const mutation = createUpsertMutation(
      classification,
      revisions.get(classification.objectId) ?? 0,
      createIdempotencyKey("memory-upsert"),
    );
    pending.set(classification.objectId, mutation);
    persistCoordinationState();
    return Object.freeze({ status: "pending", reason: "queued", objectId: classification.objectId });
  };

  const stageForget = (value) => {
    const request = validateMemoryForgetRequest(value);
    if (request.ownerKind !== "account") {
      return Object.freeze({ status: "local-only", reason: "device-owned", objectId: null });
    }
    if (request.ownerId !== subject) {
      return Object.freeze({ status: "blocked", reason: "owner-mismatch", objectId: null });
    }
    const objectId = objectIdForMemoryId(request.id);
    if (objectId === null) {
      return Object.freeze({ status: "local-only", reason: "memory-id-not-portable-v1", objectId: null });
    }
    if (recoveryBlocked) return recoveryBlockResult(objectId);
    if (!isAuthorized({ operation: "delete", memoryIdentity: request })) {
      return Object.freeze({ status: "blocked", reason: "authorization-required", objectId });
    }
    if (conflicts.has(objectId)) {
      return Object.freeze({ status: "conflict", reason: "manual-resolution-required", objectId });
    }
    const mutation = createDeleteMutation(
      request,
      revisions.get(objectId) ?? 0,
      createIdempotencyKey("memory-delete"),
    );
    if (mutation === null) {
      return Object.freeze({ status: "local-only", reason: "memory-id-not-portable-v1", objectId: null });
    }
    pending.set(objectId, mutation);
    persistCoordinationState();
    return Object.freeze({ status: "pending", reason: "queued", objectId });
  };

  const applyRemoteObject = async (value) => {
    if (!value || typeof value !== "object" || value.dataClass !== MEMORY_SYNC_DATA_CLASS) {
      return Object.freeze({ status: "ignored", reason: "other-data-class", objectId: null });
    }
    if (recoveryBlocked) return recoveryBlockResult(value.objectId ?? null);
    const object = validateMemorySyncObject(value, { subjectId: subject });
    const objectId = object.objectId;
    const operation = object.tombstone ? "restore-delete" : "restore-upsert";
    const descriptor = object.tombstone
      ? { operation, memoryIdentity: object.payload.memoryIdentity }
      : { operation, item: object.payload.memory };
    if (!isAuthorized(descriptor)) {
      return Object.freeze({ status: "blocked", reason: "authorization-required", objectId });
    }

    const knownRevision = revisions.get(objectId) ?? 0;
    const incomingFingerprint = objectFingerprint(object);
    if (object.serverRevision < knownRevision) {
      return Object.freeze({ status: "ignored", reason: "stale-revision", objectId });
    }
    if (object.serverRevision === knownRevision && knownRevision !== 0) {
      if (fingerprints.get(objectId) === incomingFingerprint) {
        return Object.freeze({ status: "ignored", reason: "idempotent", objectId });
      }
      conflicts.set(objectId, Object.freeze({
        objectId,
        reason: "same-revision-divergence",
        serverRevision: object.serverRevision,
      }));
      persistCoordinationState();
      return Object.freeze({ status: "conflict", reason: "same-revision-divergence", objectId });
    }

    if (pending.has(objectId) || conflicts.has(objectId)) {
      revisions.set(objectId, object.serverRevision);
      conflicts.set(objectId, Object.freeze({
        objectId,
        reason: "concurrent-remote-update",
        serverRevision: object.serverRevision,
      }));
      persistCoordinationState();
      return Object.freeze({ status: "conflict", reason: "concurrent-remote-update", objectId });
    }

    if (object.tombstone) {
      memory.forget(object.payload.memoryIdentity);
    } else {
      memory.remember(object.payload.memory);
    }
    await memory.flush();
    revisions.set(objectId, object.serverRevision);
    fingerprints.set(objectId, incomingFingerprint);
    persistCoordinationState();
    return Object.freeze({
      status: object.tombstone ? "forgotten" : "applied",
      reason: "authoritative-remote-revision",
      objectId,
    });
  };

  const applyRemoteBatch = async (values) => {
    if (!Array.isArray(values) || values.length > MAX_REMOTE_BATCH) {
      throw new TypeError("Memory sync remote batch is invalid");
    }
    let applied = 0;
    let ignored = 0;
    let rejected = 0;
    let blocked = 0;
    for (const value of values) {
      if (!value || typeof value !== "object" || value.dataClass !== MEMORY_SYNC_DATA_CLASS) {
        ignored += 1;
        continue;
      }
      try {
        const result = await applyRemoteObject(value);
        if (["applied", "forgotten"].includes(result.status)) applied += 1;
        else if (result.status === "blocked" || result.status === "conflict") blocked += 1;
        else ignored += 1;
      } catch {
        rejected += 1;
      }
    }
    return Object.freeze({ applied, ignored, rejected, blocked, conflictCount: conflicts.size });
  };

  const flush = async (transport) => {
    const remote = assertSyncTransportPort(transport);
    if (recoveryBlocked) {
      return Object.freeze({ ...getSnapshot(), accepted: 0, failures: 0 });
    }
    let accepted = 0;
    let failures = 0;
    for (const [objectId, mutation] of [...pending]) {
      if (conflicts.has(objectId)) continue;
      let ack;
      try {
        ack = await remote.applyMutation(mutation);
      } catch {
        failures += 1;
        continue;
      }
      if (
        !ack
        || typeof ack !== "object"
        || ack.objectId !== objectId
        || ack.dataClass !== MEMORY_SYNC_DATA_CLASS
      ) {
        failures += 1;
        continue;
      }
      const serverRevision = requireRevision(
        ack.serverRevision,
        "Memory sync acknowledgement server revision",
        { allowZero: false },
      );
      if (ack.conflict === true) {
        revisions.set(objectId, serverRevision);
        conflicts.set(objectId, Object.freeze({
          objectId,
          reason: "server-conflict",
          serverRevision,
        }));
        persistCoordinationState();
        continue;
      }
      if (ack.conflict !== false) {
        failures += 1;
        continue;
      }
      const current = pending.get(objectId);
      revisions.set(objectId, serverRevision);
      fingerprints.set(objectId, mutationFingerprint(mutation));
      if (current?.idempotencyKey === mutation.idempotencyKey) {
        pending.delete(objectId);
        accepted += 1;
      } else if (current) {
        conflicts.set(objectId, Object.freeze({
          objectId,
          reason: "local-change-during-flight",
          serverRevision,
        }));
      }
      persistCoordinationState();
    }
    return Object.freeze({ ...getSnapshot(), accepted, failures });
  };

  const getSnapshot = () => Object.freeze({
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    subjectId: subject,
    pendingMutationCount: pending.size,
    conflictCount: conflicts.size,
    revisionCount: revisions.size,
    queuePersistence,
    recoveredCoordinationState: recovered.recovered,
    recoveryBlocked,
    recoveryBlockReason: recovered.recoveryBlockReason,
    coordinationStateSchema: MEMORY_SYNC_STATE_SCHEMA,
    reconciliationOwnership: "account-runtime",
    ownsCursor: false,
    ownsTransport: false,
    liveClientIntegration: false,
    productionPromoted: false,
  });

  return Object.freeze({
    schema: MEMORY_SYNC_RUNTIME_SCHEMA,
    remember(value) {
      const item = memory.remember(value);
      return Object.freeze({ item, sync: stageUpsert(item) });
    },
    forget(value) {
      const request = validateMemoryForgetRequest(value);
      const removed = memory.forget(request);
      return Object.freeze({ removed, sync: stageForget(request) });
    },
    stageUpsert,
    stageForget,
    applyRemoteObject,
    applyRemoteBatch,
    flush,
    getSnapshot,
    pendingMutations() {
      return Object.freeze([...pending.values()]);
    },
    pendingConflicts() {
      return Object.freeze([...conflicts.values()]);
    },
  });
}

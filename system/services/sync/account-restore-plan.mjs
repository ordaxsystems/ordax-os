export const ACCOUNT_RESTORE_PLAN_SCHEMA = "ordax.account-restore-plan/1";

const MAX_SNAPSHOT_OBJECTS = 2000;
const PORTABLE_STATE_CLASSES = new Set([
  "appearance",
  "preferences",
  "workspace-metadata",
]);
const NEVER_SYNC_DATA_CLASSES = new Set([
  "device-private-keys",
  "machine-identity-secrets",
  "device-bound-credentials",
  "local-privileged-recovery-material",
  "raw-disk-state",
  "ephemeral-cache",
]);

function requireSubjectId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new TypeError("Account restore subjectId is invalid");
  }
  return value;
}

function validateSnapshotObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Account restore snapshot object must be an object");
  }
  if (typeof value.objectId !== "string" || value.objectId.length < 1 || value.objectId.length > 240) {
    throw new TypeError("Account restore snapshot objectId is invalid");
  }
  if (typeof value.dataClass !== "string" || value.dataClass.length < 1 || value.dataClass.length > 80) {
    throw new TypeError("Account restore snapshot dataClass is invalid");
  }
  if (!Number.isSafeInteger(value.serverRevision) || value.serverRevision < 1) {
    throw new TypeError("Account restore snapshot serverRevision is invalid");
  }
  if (typeof value.tombstone !== "boolean") {
    throw new TypeError("Account restore snapshot tombstone state is required");
  }
  return value;
}

function validateMemorySyncSnapshot(value, subjectId) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Account restore Memory sync snapshot is invalid");
  }
  if (value.subjectId !== subjectId) {
    throw new Error("Account restore Memory sync subject does not match the account snapshot");
  }
  for (const field of [
    "pendingMutationCount",
    "conflictCount",
    "reconciliationRequiredCount",
    "revisionCount",
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new TypeError(`Account restore Memory sync ${field} is invalid`);
    }
  }
  if (value.reconciliationRequiredCount > value.conflictCount) {
    throw new TypeError("Account restore Memory reconciliation state is inconsistent");
  }
  if (typeof value.recoveryBlocked !== "boolean") {
    throw new TypeError("Account restore Memory recovery state is invalid");
  }
  return value;
}

function phase(id, status, objectIds, reason = null) {
  return Object.freeze({
    id,
    status,
    objectIds: Object.freeze([...objectIds]),
    reason,
  });
}

export function buildAccountRestorePlan({
  subjectId,
  snapshotObjects,
  memorySyncSnapshot = null,
} = {}) {
  const subject = requireSubjectId(subjectId);
  if (!Array.isArray(snapshotObjects) || snapshotObjects.length > MAX_SNAPSHOT_OBJECTS) {
    throw new TypeError("Account restore snapshot object collection is invalid");
  }

  const seenObjectIds = new Set();
  const portableObjectIds = [];
  const memoryObjectIds = [];
  const deferredObjectIds = [];

  for (const rawObject of snapshotObjects) {
    const object = validateSnapshotObject(rawObject);
    if (seenObjectIds.has(object.objectId)) {
      throw new TypeError("Account restore snapshot contains duplicate object identity");
    }
    seenObjectIds.add(object.objectId);

    if (NEVER_SYNC_DATA_CLASSES.has(object.dataClass)) {
      throw new Error(`Never-sync data class reached account restore: ${object.dataClass}`);
    }
    if (PORTABLE_STATE_CLASSES.has(object.dataClass)) {
      portableObjectIds.push(object.objectId);
      continue;
    }
    if (object.dataClass === "memory") {
      memoryObjectIds.push(object.objectId);
      continue;
    }
    deferredObjectIds.push(object.objectId);
  }

  const memoryState = validateMemorySyncSnapshot(memorySyncSnapshot, subject);
  let memoryStatus = "ready";
  let memoryReason = null;
  if (memoryObjectIds.length > 0 && memoryState === null) {
    memoryStatus = "blocked";
    memoryReason = "memory-sync-runtime-required";
  } else if (memoryState?.recoveryBlocked) {
    memoryStatus = "blocked";
    memoryReason = "memory-coordination-recovery-required";
  } else if ((memoryState?.reconciliationRequiredCount ?? 0) > 0) {
    memoryStatus = "blocked";
    memoryReason = "memory-authoritative-reconciliation-required";
  } else if ((memoryState?.conflictCount ?? 0) > 0) {
    memoryStatus = "blocked";
    memoryReason = "memory-conflict-resolution-required";
  } else if ((memoryState?.pendingMutationCount ?? 0) > 0) {
    memoryStatus = "blocked";
    memoryReason = "local-memory-pending-intent";
  }

  const phases = Object.freeze([
    phase("portable-settings-and-workspace", "ready", portableObjectIds),
    phase(
      "profile-space-and-app-metadata",
      deferredObjectIds.length > 0 ? "deferred" : "not-present",
      deferredObjectIds,
      deferredObjectIds.length > 0 ? "data-class-not-promoted-for-restore" : null,
    ),
    phase("authorized-memory", memoryStatus, memoryObjectIds, memoryReason),
    phase("rebuild-derived-local-state", "required-after-apply", [], "indexes-and-caches-are-derived"),
    phase("restore-health-check", "required-after-rebuild", [], "promotion-requires-health-proof"),
  ]);

  return Object.freeze({
    schema: ACCOUNT_RESTORE_PLAN_SCHEMA,
    subjectId: subject,
    phases,
    snapshotObjectCount: snapshotObjects.length,
    portableObjectCount: portableObjectIds.length,
    memoryObjectCount: memoryObjectIds.length,
    deferredObjectCount: deferredObjectIds.length,
    foundationApplyAllowed: memoryStatus !== "blocked",
    fullRestoreImplemented: false,
    appliesDeviceSecrets: false,
    grantsAuthority: false,
  });
}

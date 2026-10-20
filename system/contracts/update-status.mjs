export const UPDATE_STATUS_SCHEMA = "ordax.update-status/1";

const UPDATE_PHASES = new Set([
  "idle",
  "checking",
  "fetching",
  "validating",
  "activating",
  "health-wait",
  "rollback",
  "blocked",
  "error",
]);

const BASE_UPDATE_PHASES = new Set([
  "none",
  "waiting-candidate",
  "candidate-requested",
  "candidate-fetching",
  "candidate-ready",
  "staged",
  "activation-ready",
]);

function optionalNonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError("Update status numeric fields must be bounded non-negative integers");
  }
  return value;
}

function optionalString(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") {
    throw new TypeError("Update status text fields must be strings");
  }
  return value;
}

export function validateUpdateStatusSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Update status snapshot must be an object");
  }
  if (typeof value.sourceSha !== "string" || value.sourceSha.length === 0) {
    throw new TypeError("Update status requires sourceSha");
  }
  if (typeof value.status !== "string" || value.status.length === 0) {
    throw new TypeError("Update status requires status");
  }
  if (typeof value.applyMode !== "string" || value.applyMode.length === 0) {
    throw new TypeError("Update status requires applyMode");
  }
  const phase = optionalString(value.phase, "idle");
  if (!UPDATE_PHASES.has(phase)) {
    throw new TypeError(`Unsupported update phase: ${phase}`);
  }
  const deliveryNumber = optionalNonNegativeInteger(
    value.deliveryNumber ?? value.versionNumber,
    0,
    1_000_000,
  );
  const baseUpdatePhase = optionalString(
    value.baseUpdatePhase,
    value.bootRefreshRequired === true ? "waiting-candidate" : "none",
  );
  if (!BASE_UPDATE_PHASES.has(baseUpdatePhase)) {
    throw new TypeError(`Unsupported Base update phase: ${baseUpdatePhase}`);
  }
  return Object.freeze({
    sourceSha: value.sourceSha,
    deliveryNumber,
    versionNumber: deliveryNumber,
    runtimeSurfaceSha: optionalString(value.runtimeSurfaceSha, value.sourceSha),
    targetSha: optionalString(value.targetSha, ""),
    status: value.status,
    phase,
    applyMode: value.applyMode,
    attemptId: optionalString(value.attemptId, ""),
    bootRefreshRequired: value.bootRefreshRequired === true,
    baseUpdatePhase,
    baseUpdateSha: optionalString(value.baseUpdateSha, ""),
    checkedAt: optionalString(value.checkedAt, "unknown"),
    lastAppliedSha: optionalString(value.lastAppliedSha, ""),
    lastAppliedAt: optionalString(value.lastAppliedAt, "unknown"),
    lastApplyDurationSeconds: optionalNonNegativeInteger(value.lastApplyDurationSeconds, 0, 3600),
    lastStageDurationSeconds: optionalNonNegativeInteger(value.lastStageDurationSeconds, 0, 3600),
    rejectedSha: optionalString(value.rejectedSha, ""),
    lastError: optionalString(value.lastError, ""),
    healthToken: optionalString(value.healthToken, ""),
    manualCheckAvailable: value.manualCheckAvailable === true,
    manualCheckPending: value.manualCheckPending === true,
  });
}

export function assertUpdateStatusPort(port) {
  if (!port || typeof port !== "object" || port.schema !== UPDATE_STATUS_SCHEMA) {
    throw new TypeError("A compatible update-status port is required");
  }
  if (typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function") {
    throw new TypeError("Update-status port must implement getSnapshot() and subscribe()");
  }
  const snapshot = port.getSnapshot();
  if (snapshot !== null) validateUpdateStatusSnapshot(snapshot);
  return port;
}

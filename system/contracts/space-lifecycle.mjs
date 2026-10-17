export const SPACE_LIFECYCLE_SCHEMA = "ordax.space-lifecycle/1";
export const SPACE_LIFECYCLE_REQUEST_SCHEMA = "ordax.space-lifecycle-request/1";

const ACTIONS = new Set(["rename", "archive", "restore"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function normalizeSpaceId(value) {
  return boundedText(value, "Space lifecycle spaceId", 160).trim();
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError("Space lifecycle idempotencyKey must be a UUID");
  }
  return value.toLowerCase();
}

export function validateSpaceLifecycleSnapshot(value) {
  const raw = objectValue(value, "Space lifecycle snapshot");
  const supportedActions = raw.supportedActions ?? [];
  if (!Array.isArray(supportedActions) || supportedActions.length > ACTIONS.size) {
    throw new TypeError("Space lifecycle supportedActions must be a bounded array");
  }
  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (!ACTIONS.has(action) || seen.has(action)) {
      throw new TypeError(`Unsupported or duplicate Space lifecycle action: ${String(action)}`);
    }
    seen.add(action);
    return action;
  });
  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function validateSpaceLifecycleRequest(value) {
  const raw = objectValue(value, "Space lifecycle request");
  if (raw.schema !== SPACE_LIFECYCLE_REQUEST_SCHEMA || !ACTIONS.has(raw.action)) {
    throw new TypeError("Space lifecycle request schema/action is invalid");
  }

  const request = {
    schema: SPACE_LIFECYCLE_REQUEST_SCHEMA,
    action: raw.action,
    spaceId: normalizeSpaceId(raw.spaceId),
    idempotencyKey: normalizeIdempotencyKey(raw.idempotencyKey),
  };

  if (raw.action === "rename") {
    request.name = boundedText(raw.name, "Space lifecycle name", 120).trim();
  } else if (Object.hasOwn(raw, "name")) {
    throw new TypeError(`Space lifecycle ${raw.action} request cannot include name`);
  }

  for (const forbidden of ["actorId", "userId", "ownerId", "role", "membership", "authorized", "authority"]) {
    if (Object.hasOwn(raw, forbidden)) {
      throw new TypeError(`Space lifecycle request cannot supply ${forbidden}`);
    }
  }

  return Object.freeze(request);
}

export function isSpaceLifecycleActionSupported(snapshotValue, action) {
  const snapshot = validateSpaceLifecycleSnapshot(snapshotValue);
  return ACTIONS.has(action) && snapshot.supportedActions.includes(action);
}

export function assertSpaceLifecyclePort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_LIFECYCLE_SCHEMA) {
    throw new TypeError("A compatible Space lifecycle port is required");
  }
  if (
    typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
    || typeof port.refresh !== "function"
    || typeof port.renameSpace !== "function"
    || typeof port.archiveSpace !== "function"
    || typeof port.restoreSpace !== "function"
  ) {
    throw new TypeError(
      "Space lifecycle port must implement getSnapshot(), subscribe(), refresh(), renameSpace(), archiveSpace() and restoreSpace()",
    );
  }
  validateSpaceLifecycleSnapshot(port.getSnapshot());
  return port;
}

export const SPACE_LIFECYCLE_ACTIONS = Object.freeze([...ACTIONS]);

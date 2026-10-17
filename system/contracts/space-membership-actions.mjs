export const SPACE_MEMBERSHIP_ACTIONS_SCHEMA = "ordax.space-membership-actions/1";
export const SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA = "ordax.space-membership-action-request/1";
export const SPACE_MEMBERSHIP_ACTION_OUTCOME_SCHEMA = "ordax.space-membership-action-outcome/1";

const ACTIONS = new Set(["change-role", "suspend", "reactivate", "remove"]);
const ASSIGNABLE_ROLES = new Set(["admin", "member", "viewer"]);
const MEMBER_STATES = new Set(["active", "suspended"]);
const BASE_FIELDS = new Set([
  "schema",
  "action",
  "spaceId",
  "targetUserId",
  "idempotencyKey",
]);
const OUTCOME_FIELDS = new Set([
  "schema",
  "spaceId",
  "targetUserId",
  "role",
  "state",
  "removed",
  "changed",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} must be bounded text`);
  }
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be bounded text`);
  return normalized;
}

function idempotencyKey(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError("Space membership idempotencyKey must be a UUID");
  }
  return value.toLowerCase();
}

function assertExactFields(raw) {
  const allowed = new Set(BASE_FIELDS);
  if (raw.action === "change-role") allowed.add("role");
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Space membership request contains unsupported field ${key}`);
    }
  }
}

function assertExactOutcomeFields(raw) {
  for (const key of Object.keys(raw)) {
    if (!OUTCOME_FIELDS.has(key)) {
      throw new TypeError(`Space membership outcome contains unsupported field ${key}`);
    }
  }
  for (const key of OUTCOME_FIELDS) {
    if (!(key in raw)) {
      throw new TypeError(`Space membership outcome is missing field ${key}`);
    }
  }
}

export function validateSpaceMembershipActionsSnapshot(value) {
  const raw = objectValue(value, "Space membership actions snapshot");
  const supportedActions = raw.supportedActions ?? [];
  if (!Array.isArray(supportedActions) || supportedActions.length > ACTIONS.size) {
    throw new TypeError("Space membership supportedActions must be a bounded array");
  }
  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (!ACTIONS.has(action) || seen.has(action)) {
      throw new TypeError(`Unsupported or duplicate Space membership action: ${String(action)}`);
    }
    seen.add(action);
    return action;
  });
  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function validateSpaceMembershipActionRequest(value) {
  const raw = objectValue(value, "Space membership action request");
  if (raw.schema !== SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA || !ACTIONS.has(raw.action)) {
    throw new TypeError("Space membership request schema/action is invalid");
  }
  assertExactFields(raw);

  const request = {
    schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
    action: raw.action,
    spaceId: boundedText(raw.spaceId, "Space membership spaceId"),
    targetUserId: boundedText(raw.targetUserId, "Space membership targetUserId"),
    idempotencyKey: idempotencyKey(raw.idempotencyKey),
  };

  if (raw.action === "change-role") {
    if (!ASSIGNABLE_ROLES.has(raw.role)) {
      throw new TypeError("Space membership role is not assignable through membership actions");
    }
    request.role = raw.role;
  }

  return Object.freeze(request);
}

export function validateSpaceMembershipActionOutcome(value) {
  const raw = objectValue(value, "Space membership action outcome");
  if (raw.schema !== SPACE_MEMBERSHIP_ACTION_OUTCOME_SCHEMA) {
    throw new TypeError("Space membership outcome schema is invalid");
  }
  assertExactOutcomeFields(raw);
  const spaceId = boundedText(raw.spaceId, "Space membership outcome spaceId");
  const targetUserId = boundedText(raw.targetUserId, "Space membership outcome targetUserId");
  if (!ASSIGNABLE_ROLES.has(raw.role)) {
    throw new TypeError("Space membership outcome role is invalid");
  }
  if (!MEMBER_STATES.has(raw.state)) {
    throw new TypeError("Space membership outcome state is invalid");
  }
  if (typeof raw.removed !== "boolean" || typeof raw.changed !== "boolean") {
    throw new TypeError("Space membership outcome flags must be boolean");
  }
  return Object.freeze({
    schema: SPACE_MEMBERSHIP_ACTION_OUTCOME_SCHEMA,
    spaceId,
    targetUserId,
    role: raw.role,
    state: raw.state,
    removed: raw.removed,
    changed: raw.changed,
  });
}

export function isSpaceMembershipActionSupported(snapshotValue, action) {
  const snapshot = validateSpaceMembershipActionsSnapshot(snapshotValue);
  return ACTIONS.has(action) && snapshot.supportedActions.includes(action);
}

export function assertSpaceMembershipActionsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_MEMBERSHIP_ACTIONS_SCHEMA) {
    throw new TypeError("A compatible Space membership actions port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "refresh",
    "changeMemberRole",
    "suspendMember",
    "reactivateMember",
    "removeMember",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Space membership actions port must implement ${method}()`);
    }
  }
  validateSpaceMembershipActionsSnapshot(port.getSnapshot());
  return port;
}

export const SPACE_MEMBERSHIP_ACTIONS = Object.freeze([...ACTIONS]);
export const SPACE_MEMBERSHIP_ASSIGNABLE_ROLES = Object.freeze([...ASSIGNABLE_ROLES]);

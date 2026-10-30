export const SPACE_INVITES_SCHEMA = "ordax.space-invites/1";
export const SPACE_INVITE_CREATE_REQUEST_SCHEMA = "ordax.space-invite-create-request/1";
export const SPACE_INVITE_CREATE_RESULT_SCHEMA = "ordax.space-invite-create-result/1";
export const SPACE_INVITE_TOKEN_REQUEST_SCHEMA = "ordax.space-invite-token-request/1";
export const SPACE_INVITE_REVOKE_REQUEST_SCHEMA = "ordax.space-invite-revoke-request/1";
export const SPACE_INVITE_SCHEMA = "ordax.space-invite/1";

const ACTIONS = new Set(["create", "revoke", "accept", "decline"]);
const INVITE_STATES = new Set(["pending", "accepted", "declined", "expired", "revoked"]);
const INVITABLE_ROLES = new Set(["admin", "member", "viewer"]);
const TOKEN = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

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

function optionalBoundedText(value, label, max = 160) {
  return value == null ? null : boundedText(value, label, max);
}

function idempotencyKey(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError("Space invite idempotencyKey must be a UUID");
  }
  return value.toLowerCase();
}

function inviteToken(value) {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new TypeError("Space invite token must be a 256-bit hexadecimal token");
  }
  return value.toLowerCase();
}

function isoInstant(value, label) {
  if (typeof value !== "string" || value.length > 64 || !ISO_INSTANT.test(value)) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO timestamp`);
  // Date.parse normalizes invalid calendar dates (e.g. February 30).
  // Reconstruct the original wall-clock time after applying the supplied
  // numeric timezone, and reject any rollover before canonicalizing to UTC.
  const offset = value.endsWith("Z") ? 0 : (
    (value.slice(-6, -5) === "-" ? -1 : 1) *
    (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2)))
  );
  const wallClock = new Date(time + offset * 60_000).toISOString().slice(0, 19);
  if (wallClock !== value.slice(0, 19)) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return new Date(time).toISOString();
}

function exactFields(raw, allowed, label) {
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
  }
}

export function validateSpaceInvite(value) {
  const raw = objectValue(value, "Space invite");
  exactFields(
    raw,
    new Set([
      "schema",
      "id",
      "spaceId",
      "role",
      "state",
      "targetUserId",
      "createdAt",
      "expiresAt",
    ]),
    "Space invite",
  );
  if (raw.schema !== SPACE_INVITE_SCHEMA) throw new TypeError("Space invite schema is incompatible");
  if (!INVITABLE_ROLES.has(raw.role)) throw new TypeError("Space invite role is invalid");
  if (!INVITE_STATES.has(raw.state)) throw new TypeError("Space invite state is invalid");
  const createdAt = isoInstant(raw.createdAt, "Space invite createdAt");
  const expiresAt = isoInstant(raw.expiresAt, "Space invite expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    throw new TypeError("Space invite expiresAt must be after createdAt");
  }
  return Object.freeze({
    schema: SPACE_INVITE_SCHEMA,
    id: boundedText(raw.id, "Space invite id"),
    spaceId: boundedText(raw.spaceId, "Space invite spaceId"),
    role: raw.role,
    state: raw.state,
    targetUserId: optionalBoundedText(raw.targetUserId, "Space invite targetUserId"),
    createdAt,
    expiresAt,
  });
}

export function validateSpaceInviteCreateRequest(value) {
  const raw = objectValue(value, "Space invite create request");
  exactFields(
    raw,
    new Set(["schema", "spaceId", "role", "targetUserId", "idempotencyKey"]),
    "Space invite create request",
  );
  if (raw.schema !== SPACE_INVITE_CREATE_REQUEST_SCHEMA) {
    throw new TypeError("Space invite create request schema is incompatible");
  }
  if (!INVITABLE_ROLES.has(raw.role)) {
    throw new TypeError("Space invite role is not assignable through invites");
  }
  return Object.freeze({
    schema: SPACE_INVITE_CREATE_REQUEST_SCHEMA,
    spaceId: boundedText(raw.spaceId, "Space invite spaceId"),
    role: raw.role,
    targetUserId: optionalBoundedText(raw.targetUserId, "Space invite targetUserId"),
    idempotencyKey: idempotencyKey(raw.idempotencyKey),
  });
}

export function validateSpaceInviteCreateResult(value) {
  const raw = objectValue(value, "Space invite create result");
  exactFields(raw, new Set(["schema", "invite", "token", "created"]), "Space invite create result");
  if (raw.schema !== SPACE_INVITE_CREATE_RESULT_SCHEMA || typeof raw.created !== "boolean") {
    throw new TypeError("Space invite create result schema/state is invalid");
  }
  const invite = validateSpaceInvite(raw.invite);
  if (invite.state !== "pending") throw new TypeError("New Space invite must be pending");
  if (raw.created) {
    if (raw.token == null) throw new TypeError("New Space invite must return its one-time token");
    return Object.freeze({
      schema: SPACE_INVITE_CREATE_RESULT_SCHEMA,
      invite,
      token: inviteToken(raw.token),
      created: true,
    });
  }
  if (raw.token !== null) {
    throw new TypeError("Replayed Space invite creation cannot return a bearer token");
  }
  return Object.freeze({
    schema: SPACE_INVITE_CREATE_RESULT_SCHEMA,
    invite,
    token: null,
    created: false,
  });
}

export function validateSpaceInviteTokenRequest(value) {
  const raw = objectValue(value, "Space invite token request");
  exactFields(raw, new Set(["schema", "token", "idempotencyKey"]), "Space invite token request");
  if (raw.schema !== SPACE_INVITE_TOKEN_REQUEST_SCHEMA) {
    throw new TypeError("Space invite token request schema is incompatible");
  }
  return Object.freeze({
    schema: SPACE_INVITE_TOKEN_REQUEST_SCHEMA,
    token: inviteToken(raw.token),
    idempotencyKey: idempotencyKey(raw.idempotencyKey),
  });
}

export function validateSpaceInviteRevokeRequest(value) {
  const raw = objectValue(value, "Space invite revoke request");
  exactFields(raw, new Set(["schema", "inviteId", "idempotencyKey"]), "Space invite revoke request");
  if (raw.schema !== SPACE_INVITE_REVOKE_REQUEST_SCHEMA) {
    throw new TypeError("Space invite revoke request schema is incompatible");
  }
  return Object.freeze({
    schema: SPACE_INVITE_REVOKE_REQUEST_SCHEMA,
    inviteId: boundedText(raw.inviteId, "Space invite inviteId"),
    idempotencyKey: idempotencyKey(raw.idempotencyKey),
  });
}

export function validateSpaceInvitesSnapshot(value) {
  const raw = objectValue(value, "Space invites snapshot");
  exactFields(raw, new Set(["supportedActions"]), "Space invites snapshot");
  const supportedActions = raw.supportedActions ?? [];
  if (!Array.isArray(supportedActions) || supportedActions.length > ACTIONS.size) {
    throw new TypeError("Space invites supportedActions must be a bounded array");
  }
  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (!ACTIONS.has(action) || seen.has(action)) {
      throw new TypeError(`Unsupported or duplicate Space invite action: ${String(action)}`);
    }
    seen.add(action);
    return action;
  });
  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function assertSpaceInvitesPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_INVITES_SCHEMA) {
    throw new TypeError("A compatible Space invites port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "refresh",
    "createInvite",
    "revokeInvite",
    "acceptInvite",
    "declineInvite",
  ]) {
    if (typeof port[method] !== "function") throw new TypeError(`Space invites port must implement ${method}()`);
  }
  validateSpaceInvitesSnapshot(port.getSnapshot());
  return port;
}

export const SPACE_INVITE_ACTIONS = Object.freeze([...ACTIONS]);
export const SPACE_INVITE_STATES = Object.freeze([...INVITE_STATES]);
export const SPACE_INVITABLE_ROLES = Object.freeze([...INVITABLE_ROLES]);

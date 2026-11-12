export const SPACES_PORT_SCHEMA = "ordax.spaces/1";
export const PROFILE_PACKS_PORT_SCHEMA = "ordax.profile-packs/1";
export const SPACES_SNAPSHOT_SCHEMA = "ordax.spaces-snapshot/1";
export const MAX_VISIBLE_SPACES = 64;

const SPACE_KINDS = new Set(["personal", "work", "professional"]);
const MEMBER_ROLES = new Set(["owner", "admin", "member", "viewer"]);
const SPACE_STATES = new Set(["active", "archived"]);
const SNAPSHOT_STATES = new Set(["idle", "loading", "ready", "unavailable", "error"]);
const SEMANTIC_IDENTIFIER = /^[a-z0-9][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const FORBIDDEN_SPACES_MUTATION_METHODS = Object.freeze([
  "archive",
  "create",
  "delete",
  "execute",
  "mutate",
  "remove",
  "restore",
  "update",
]);

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function optionalSemanticIdentifier(value, label) {
  if (value == null) return null;
  const normalized = boundedText(value, label, 80);
  if (!SEMANTIC_IDENTIFIER.test(normalized)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

export function validateSpace(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space must be an object");
  }
  if (!SPACE_KINDS.has(value.kind) || !SPACE_STATES.has(value.state ?? "active")) {
    throw new TypeError("Space kind/state is invalid");
  }
  const domain = optionalSemanticIdentifier(value.domain, "Space domain");
  const subtype = optionalSemanticIdentifier(value.subtype, "Space subtype");
  if ((domain === null) !== (subtype === null)) {
    throw new TypeError("Space domain and subtype must be supplied together");
  }
  return Object.freeze({
    schema: SPACES_PORT_SCHEMA,
    id: boundedText(value.id, "Space id", 160),
    name: boundedText(value.name, "Space name", 120),
    kind: value.kind,
    state: value.state ?? "active",
    ownerId: boundedText(value.ownerId, "Space owner id", 160),
    profilePack: value.profilePack == null
      ? null
      : boundedText(value.profilePack, "Profile pack", 160),
    ...(domain === null ? {} : { domain, subtype }),
  });
}

export function validateSpaceMembership(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space membership must be an object");
  }
  if (!MEMBER_ROLES.has(value.role)) {
    throw new TypeError("Space membership role is invalid");
  }
  return Object.freeze({
    spaceId: boundedText(value.spaceId, "Membership space id", 160),
    userId: boundedText(value.userId, "Membership user id", 160),
    role: value.role,
  });
}

export function validateProfilePack(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile pack must be an object");
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new TypeError("Profile pack version is invalid");
  }
  if (value.autoGrantPrivileges === true || value.allowUnsignedApps === true) {
    throw new TypeError("Profile pack cannot bypass authorization or package trust");
  }
  return Object.freeze({
    schema: PROFILE_PACKS_PORT_SCHEMA,
    slug: boundedText(value.slug, "Profile pack slug", 96),
    version: value.version,
    title: boundedText(value.title, "Profile pack title", 120),
    category: boundedText(value.category, "Profile pack category", 80),
    autoGrantPrivileges: false,
    allowUnsignedApps: false,
  });
}

export function validateSpacesSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Spaces snapshot must be an object");
  }
  if (value.schema !== SPACES_SNAPSHOT_SCHEMA || !SNAPSHOT_STATES.has(value.state)) {
    throw new TypeError("Spaces snapshot schema/state is invalid");
  }
  if (!Array.isArray(value.spaces) || value.spaces.length > MAX_VISIBLE_SPACES) {
    throw new TypeError("Spaces snapshot must contain a bounded spaces array");
  }
  const spaces = Object.freeze(value.spaces.map(validateSpace));
  const identities = new Set(spaces.map((space) => space.id));
  if (identities.size !== spaces.length) {
    throw new TypeError("Spaces snapshot contains duplicate ids");
  }
  if (value.state !== "ready" && spaces.length > 0) {
    throw new TypeError("Non-ready Spaces snapshot must not expose stale spaces");
  }
  return Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state: value.state,
    spaces,
  });
}

export function assertSpacesPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACES_PORT_SCHEMA) {
    throw new TypeError("Compatible OrdaX Spaces port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "refresh", "reset"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Spaces port must implement ${method}()`);
    }
  }
  for (const method of FORBIDDEN_SPACES_MUTATION_METHODS) {
    if (method in port) {
      throw new TypeError(`Spaces port exposed to Surface must not implement ${method}()`);
    }
  }
  validateSpacesSnapshot(port.getSnapshot());
  return port;
}

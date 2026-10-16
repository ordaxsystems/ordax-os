export const SPACE_CREATION_INTENT_SCHEMA = "ordax.space-creation-intent/1";
export const SPACE_CREATION_PREFLIGHT_SCHEMA = "ordax.space-creation-preflight/1";

const IDENTIFIER = /^[a-z0-9][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PROFILE_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const STATES = new Set(["profile-resolved", "blocked"]);
const BLOCK_REASONS = new Set([
  "unknown-space-type",
  "space-type-deferred",
  "creation-default-profile-missing",
  "creation-default-profile-unavailable",
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function identifier(value, label, max = 80) {
  if (typeof value !== "string" || value.length > max || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return value;
}

function profileValue(value, label) {
  const raw = objectValue(value, label);
  if (typeof raw.slug !== "string" || !PROFILE_SLUG.test(raw.slug)) {
    throw new TypeError(`${label}.slug is invalid`);
  }
  if (!Number.isSafeInteger(raw.version) || raw.version < 1) {
    throw new TypeError(`${label}.version is invalid`);
  }
  if (raw.identity !== `${raw.slug}@${raw.version}`) {
    throw new TypeError(`${label}.identity is invalid`);
  }
  if (typeof raw.title !== "string" || !raw.title || raw.title.length > 120 || raw.title.includes("\0")) {
    throw new TypeError(`${label}.title is invalid`);
  }
  if (!new Set(["personal", "work", "professional"]).has(raw.spaceKind)) {
    throw new TypeError(`${label}.spaceKind is invalid`);
  }
  return Object.freeze({
    slug: raw.slug,
    version: raw.version,
    identity: raw.identity,
    title: raw.title,
    spaceKind: raw.spaceKind,
  });
}

export function validateSpaceCreationIntent(value) {
  const raw = objectValue(value, "Space creation intent");
  if (raw.schema !== SPACE_CREATION_INTENT_SCHEMA) {
    throw new TypeError("Space creation intent schema is incompatible");
  }
  return Object.freeze({
    schema: SPACE_CREATION_INTENT_SCHEMA,
    domain: identifier(raw.domain, "Space creation domain"),
    subtype: identifier(raw.subtype, "Space creation subtype"),
  });
}

export function validateSpaceCreationPreflight(value) {
  const raw = objectValue(value, "Space creation preflight");
  if (raw.schema !== SPACE_CREATION_PREFLIGHT_SCHEMA || !STATES.has(raw.state)) {
    throw new TypeError("Space creation preflight schema/state is invalid");
  }
  const reason = raw.reason == null ? null : raw.reason;
  if (reason !== null && !BLOCK_REASONS.has(reason)) {
    throw new TypeError("Space creation preflight reason is invalid");
  }
  const type = raw.type == null ? null : Object.freeze({
    key: identifier(raw.type.key, "Space creation type key", 161),
    domain: identifier(raw.type.domain, "Space creation type domain"),
    subtype: identifier(raw.type.subtype, "Space creation type subtype"),
    lifecycle: raw.type.lifecycle,
  });
  if (type !== null && !new Set(["mvp-foundation", "deferred"]).has(type.lifecycle)) {
    throw new TypeError("Space creation type lifecycle is invalid");
  }
  if (type !== null && type.key !== `${type.domain}.${type.subtype}`) {
    throw new TypeError("Space creation type identity is inconsistent");
  }
  const profile = raw.profile == null ? null : profileValue(raw.profile, "Space creation profile");
  const resolved = raw.state === "profile-resolved";
  if (resolved && (reason !== null || type === null || profile === null)) {
    throw new TypeError("Resolved Space creation preflight must include type/profile without a blocker");
  }
  if (!resolved && reason === null) {
    throw new TypeError("Blocked Space creation preflight requires a reason");
  }
  if (raw.nextStep !== (resolved ? "validate-profile-provisioning" : null)) {
    throw new TypeError("Space creation preflight next step is invalid");
  }
  const authority = objectValue(raw.authority, "Space creation authority");
  if (
    authority.createSpace !== false
    || authority.provisionProfile !== false
    || authority.activateProfile !== false
  ) {
    throw new TypeError("Space creation preflight cannot expose mutation authority");
  }
  return Object.freeze({
    schema: SPACE_CREATION_PREFLIGHT_SCHEMA,
    state: raw.state,
    reason,
    type,
    profile,
    nextStep: raw.nextStep,
    authority: Object.freeze({
      createSpace: false,
      provisionProfile: false,
      activateProfile: false,
    }),
  });
}

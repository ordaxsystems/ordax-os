import { validateSpace } from "./spaces.mjs";
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

export const SPACE_CREATE_RECEIPT_SCHEMA = "prototype-ordax.space-create/1";
const SPACE_CREATE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactReceiptKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

// Consumer-only validation: the authenticated Account gateway and its RPC own
// persistence and authorization. No second Profile/Space mutation authority.
export function validateSpaceCreateReceipt(value, { subjectId, request } = {}) {
  if (
    !exactReceiptKeys(value, ["$schema", "created", "space", "profileToProvision", "nextStep"])
    || value.$schema !== SPACE_CREATE_RECEIPT_SCHEMA
    || typeof value.created !== "boolean"
    || value.nextStep !== "validate-profile-provisioning"
    || !exactReceiptKeys(value.space, [
      "id", "ownerId", "name", "kind", "state", "domain", "subtype", "profilePack",
    ])
    || !exactReceiptKeys(value.profileToProvision, ["slug", "version"])
    || typeof subjectId !== "string" || !SPACE_CREATE_UUID.test(subjectId)
  ) throw new TypeError("invalid-space-create-receipt");

  const space = validateSpace(value.space);
  const profile = value.profileToProvision;
  if (
    !SPACE_CREATE_UUID.test(space.id)
    || space.ownerId !== subjectId
    || space.profilePack !== null
    || !request || space.name !== request.name
    || space.domain !== request.domain || space.subtype !== request.subtype
    || typeof profile.slug !== "string" || !PROFILE_SLUG.test(profile.slug)
    || !Number.isSafeInteger(profile.version) || profile.version < 1
  ) throw new TypeError("invalid-space-create-receipt");

  return Object.freeze({
    $schema: SPACE_CREATE_RECEIPT_SCHEMA,
    created: value.created,
    space: Object.freeze({
      id: space.id,
      ownerId: space.ownerId,
      name: space.name,
      kind: space.kind,
      state: space.state,
      domain: space.domain,
      subtype: space.subtype,
      profilePack: null,
    }),
    profileToProvision: Object.freeze({
      slug: profile.slug,
      version: profile.version,
    }),
    nextStep: "validate-profile-provisioning",
  });
}

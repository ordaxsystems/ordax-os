export const SPACE_CREATE_SCHEMA = "prototype-ordax.space-create/1";

const IDENTIFIER = /^[a-z0-9][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_SLUG = /^[a-z0-9][a-z0-9-]{1,79}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SPACE_KINDS = new Set(["personal", "work", "professional"]);
const SPACE_STATES = new Set(["active", "archived"]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseSpaceCreateRequest(raw, contentType = "") {
  if (typeof raw !== "string" || !String(contentType).toLowerCase().startsWith("application/json")) {
    throw new TypeError("invalid-space-create-request");
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TypeError("invalid-space-create-request");
  }
  if (!exactKeys(value, ["name", "domain", "subtype", "idempotencyKey"])) {
    throw new TypeError("invalid-space-create-request");
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length < 1 || name.length > 120 || CONTROL.test(name)) {
    throw new TypeError("invalid-space-name");
  }
  for (const [label, candidate] of [["domain", value.domain], ["subtype", value.subtype]]) {
    if (typeof candidate !== "string" || candidate.length < 1 || candidate.length > 80 || !IDENTIFIER.test(candidate)) {
      throw new TypeError(`invalid-space-${label}`);
    }
  }
  if (typeof value.idempotencyKey !== "string" || !UUID.test(value.idempotencyKey)) {
    throw new TypeError("invalid-space-idempotency-key");
  }
  return Object.freeze({
    name,
    domain: value.domain,
    subtype: value.subtype,
    idempotencyKey: value.idempotencyKey.toLowerCase(),
  });
}

export function spaceCreateRpcArgs(request) {
  return Object.freeze({
    p_name: request.name,
    p_domain: request.domain,
    p_subtype: request.subtype,
    p_idempotency_key: request.idempotencyKey,
  });
}

export function projectSpaceCreateResult(row, { subjectId, request } = {}) {
  if (!exactKeys(row, [
    "space_id", "owner_user_id", "name", "kind", "state", "domain", "subtype",
    "profile_slug", "profile_version", "created",
  ])) throw new TypeError("invalid-space-create-result");
  if (typeof subjectId !== "string" || !UUID.test(subjectId) || row.owner_user_id !== subjectId) {
    throw new TypeError("invalid-space-create-owner");
  }
  if (!request || row.domain !== request.domain || row.subtype !== request.subtype) {
    throw new TypeError("invalid-space-create-semantics");
  }
  if (
    typeof row.space_id !== "string" || !UUID.test(row.space_id)
    || typeof row.name !== "string" || row.name.length < 1 || row.name.length > 120 || CONTROL.test(row.name)
    || !SPACE_KINDS.has(row.kind) || !SPACE_STATES.has(row.state)
    || typeof row.profile_slug !== "string" || !PROFILE_SLUG.test(row.profile_slug)
    || !Number.isSafeInteger(row.profile_version) || row.profile_version < 1
    || typeof row.created !== "boolean"
  ) throw new TypeError("invalid-space-create-result");

  return Object.freeze({
    $schema: SPACE_CREATE_SCHEMA,
    created: row.created,
    space: Object.freeze({
      id: row.space_id,
      ownerId: row.owner_user_id,
      name: row.name,
      kind: row.kind,
      state: row.state,
      domain: row.domain,
      subtype: row.subtype,
      profilePack: null,
    }),
    profileToProvision: Object.freeze({
      slug: row.profile_slug,
      version: row.profile_version,
    }),
    nextStep: "validate-profile-provisioning",
  });
}

/**
 * Validate the exact HTTP receipt before a Desktop host publishes it to UI.
 * The gateway/RPC remain the only authority; this is a fail-closed projection.
 */
export function validateSpaceCreateReceipt(value, { subjectId, request } = {}) {
  if (
    !exactKeys(value, ["$schema", "created", "space", "profileToProvision", "nextStep"])
    || value.$schema !== SPACE_CREATE_SCHEMA
    || typeof value.created !== "boolean"
    || value.nextStep !== "validate-profile-provisioning"
    || !exactKeys(value.space, [
      "id", "ownerId", "name", "kind", "state", "domain", "subtype", "profilePack",
    ])
    || !exactKeys(value.profileToProvision, ["slug", "version"])
  ) throw new TypeError("invalid-space-create-receipt");

  const space = value.space;
  const profile = value.profileToProvision;
  if (
    typeof subjectId !== "string" || !UUID.test(subjectId)
    || typeof space.id !== "string" || !UUID.test(space.id)
    || space.ownerId !== subjectId
    || typeof space.name !== "string" || space.name.length < 1
    || space.name.length > 120 || space.name.trim() !== space.name
    || CONTROL.test(space.name)
    || !SPACE_KINDS.has(space.kind) || !SPACE_STATES.has(space.state)
    || space.profilePack !== null
    || typeof space.domain !== "string" || !IDENTIFIER.test(space.domain) || space.domain.length > 80
    || typeof space.subtype !== "string" || !IDENTIFIER.test(space.subtype) || space.subtype.length > 80
    || !request || space.name !== request.name || space.domain !== request.domain
    || space.subtype !== request.subtype
    || typeof profile.slug !== "string" || !PROFILE_SLUG.test(profile.slug)
    || !Number.isSafeInteger(profile.version) || profile.version < 1
  ) throw new TypeError("invalid-space-create-receipt");

  return Object.freeze({
    $schema: SPACE_CREATE_SCHEMA,
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

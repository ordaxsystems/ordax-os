import { validateSpaceMembership } from "./spaces.mjs";

export const SPACE_MEMBERS_READ_SCHEMA = "ordax.space-members-read/1";
export const SPACE_MEMBERS_PAGE_SCHEMA = "ordax.space-members-page/1";
export const MAX_SPACE_MEMBERS_PAGE_SIZE = 128;

const MEMBER_STATES = new Set(["active", "suspended"]);
const FORBIDDEN_MUTATION_METHODS = Object.freeze([
  "addMember",
  "changeMemberRole",
  "inviteMember",
  "reactivateMember",
  "removeMember",
  "suspendMember",
  "transferOwnership",
]);

function boundedText(value, label, max = 200) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function optionalCursor(value) {
  if (value == null) return null;
  return boundedText(value, "Space members cursor", 240);
}

export function validateSpaceMember(value) {
  const membership = validateSpaceMembership(value);
  if (!MEMBER_STATES.has(value?.state)) {
    throw new TypeError("Space member state is invalid");
  }
  return Object.freeze({
    spaceId: membership.spaceId,
    userId: membership.userId,
    role: membership.role,
    state: value.state,
  });
}

export function validateSpaceMembersPage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space members page must be an object");
  }
  if (value.schema !== SPACE_MEMBERS_PAGE_SCHEMA) {
    throw new TypeError("Space members page schema is invalid");
  }
  const spaceId = boundedText(value.spaceId, "Space members spaceId", 160);
  if (!Array.isArray(value.members) || value.members.length > MAX_SPACE_MEMBERS_PAGE_SIZE) {
    throw new TypeError("Space members page must contain a bounded members array");
  }
  const members = Object.freeze(value.members.map(validateSpaceMember));
  const identities = new Set();
  for (const member of members) {
    if (member.spaceId !== spaceId) {
      throw new TypeError("Space members page contains a member from another Space");
    }
    if (identities.has(member.userId)) {
      throw new TypeError("Space members page contains duplicate users");
    }
    identities.add(member.userId);
  }
  return Object.freeze({
    schema: SPACE_MEMBERS_PAGE_SCHEMA,
    spaceId,
    members,
    nextCursor: optionalCursor(value.nextCursor),
  });
}

export function validateSpaceMembersListRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Space members list request must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "spaceId" && key !== "cursor") {
      throw new TypeError(`Space members list request contains unsupported field ${key}`);
    }
  }
  return Object.freeze({
    spaceId: boundedText(value.spaceId, "Space members spaceId", 160),
    cursor: optionalCursor(value.cursor),
  });
}

export function assertSpaceMembersReadPort(port) {
  if (!port || typeof port !== "object" || port.schema !== SPACE_MEMBERS_READ_SCHEMA) {
    throw new TypeError("A compatible Space members read port is required");
  }
  if (typeof port.listMembers !== "function") {
    throw new TypeError("Space members read port must implement listMembers()");
  }
  for (const method of FORBIDDEN_MUTATION_METHODS) {
    if (method in port) {
      throw new TypeError(`Space members read port must not implement ${method}()`);
    }
  }
  return port;
}

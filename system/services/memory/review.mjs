import {
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  memoryOwnersEqual,
  validateMemoryItem,
  validateMemoryOwner,
} from "../../contracts/memory.mjs";

const REVIEW_SCOPES = Object.freeze(["device", "account", "space", "project", "session"]);
const MAX_REVIEW_SCAN_ITEMS = 2048;

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function optionalText(value, label, max) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    // RFC 4122 / RFC 9562 UUID v4 bits. This fallback exists for runtimes
    // without crypto.randomUUID() but must preserve the same portable identity
    // contract used by account Memory cloud sync.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Memory review requires a cryptographically strong id source");
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Memory review clock returned an invalid time");
  }
  return date.toISOString();
}

function matchesBoundary(item, boundary) {
  if (!memoryOwnersEqual(item, boundary)) return false;
  if (boundary.spaceId !== null && item.spaceId !== boundary.spaceId) return false;
  if (boundary.projectId !== null && item.projectId !== boundary.projectId) return false;
  return true;
}

export function createMemoryReviewRuntime(memoryPort, {
  ownerKind,
  ownerId = null,
  spaceId = null,
  projectId = null,
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  if (typeof now !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Memory review runtime requires clock and id factory functions");
  }
  const owner = validateMemoryOwner({ ownerKind, ownerId }, "Memory review owner");
  const defaultScopes = owner.ownerKind === "device"
    ? REVIEW_SCOPES.filter((scope) => scope !== "account")
    : REVIEW_SCOPES;
  const boundary = Object.freeze({
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    spaceId: optionalText(spaceId, "Memory review Space id", 160),
    projectId: optionalText(projectId, "Memory review project id", 240),
  });

  const page = ({ scopes = defaultScopes, query = "", limit = 32, offset = 0 } = {}) => {
    const results = memory.search({
      ownerKind: boundary.ownerKind,
      ownerId: boundary.ownerId,
      scopes,
      spaceId: boundary.spaceId,
      projectId: boundary.projectId,
      includeRestricted: true,
      query,
      limit,
      offset,
    });
    return Object.freeze(results.map((item) => {
      const validated = validateMemoryItem(item);
      if (!matchesBoundary(validated, boundary)) {
        throw new Error("Memory review result escaped its authorization boundary");
      }
      return validated;
    }));
  };

  const locate = (id) => {
    const memoryId = boundedText(id, "Memory review item id", 160);
    for (let offset = 0; offset < MAX_REVIEW_SCAN_ITEMS; offset += MAX_MEMORY_SEARCH_RESULTS) {
      const candidates = page({ limit: MAX_MEMORY_SEARCH_RESULTS, offset });
      const item = candidates.find((candidate) => candidate.id === memoryId) ?? null;
      if (item !== null) return item;
      if (candidates.length < MAX_MEMORY_SEARCH_RESULTS) return null;
    }
    return null;
  };

  return Object.freeze({
    create(contentValue, {
      kind = "fact",
      sensitivity = "private",
      provenance = "user-manual",
    } = {}) {
      const id = boundedText(String(idFactory()), "Memory review new item id", 160);
      const scope = boundary.ownerKind === "device" ? "device" : "account";
      if (boundary.spaceId !== null || boundary.projectId !== null) {
        throw new Error("Manual Memory creation is limited to personal owner scopes");
      }
      const item = validateMemoryItem({
        id,
        ownerKind: boundary.ownerKind,
        ownerId: boundary.ownerId,
        scope,
        kind,
        sensitivity,
        content: boundedText(contentValue, "Memory review new item content", 32768),
        provenance,
        sourceTimestamp: isoNow(now),
        spaceId: null,
        projectId: null,
      });
      return memory.remember(item);
    },
    list(options = {}) {
      return page(options);
    },
    update(id, patch = {}) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("Memory review patch must be an object");
      }
      const current = locate(id);
      if (current === null) return null;
      for (const immutable of ["id", "ownerKind", "ownerId", "scope", "spaceId", "projectId", "kind"]) {
        if (patch[immutable] !== undefined && patch[immutable] !== current[immutable]) {
          throw new TypeError(`Memory review cannot change ${immutable}`);
        }
      }
      const next = validateMemoryItem({
        ...current,
        content: patch.content ?? current.content,
        provenance: patch.provenance ?? current.provenance,
        sensitivity: patch.sensitivity ?? current.sensitivity,
        sourceTimestamp: patch.sourceTimestamp ?? isoNow(now),
      });
      return memory.remember(next);
    },
    remove(id) {
      const current = locate(id);
      if (current === null) return false;
      return memory.forget({
        id: current.id,
        ownerKind: boundary.ownerKind,
        ownerId: boundary.ownerId,
      });
    },
  });
}

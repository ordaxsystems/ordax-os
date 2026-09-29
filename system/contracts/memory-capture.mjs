import {
  validateMemoryOwner,
  validateMemoryItem,
} from "./memory.mjs";

export const MEMORY_CAPTURE_AUTH_SCHEMA = "ordax.memory-capture-auth/1";
export const MEMORY_CAPTURE_RESULT_SCHEMA = "ordax.memory-capture-result/1";

const CAPTURE_SCOPES = new Set(["device", "account", "space"]);
const CAPTURE_KINDS = new Set(["preference", "fact", "instruction", "summary"]);
const CAPTURE_SENSITIVITY = new Set(["normal", "private"]);

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

export function validateMemoryCaptureAuthorization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory capture authorization must be an object");
  }
  if (value.schema !== MEMORY_CAPTURE_AUTH_SCHEMA || value.authority !== "composition") {
    throw new TypeError("Memory capture authorization must come from composition");
  }
  const owner = validateMemoryOwner(value, "Memory capture owner");
  if (!CAPTURE_SCOPES.has(value.scope)) {
    throw new TypeError("Memory capture scope is not allowed");
  }
  const spaceId = optionalText(value.spaceId, "Memory capture Space id", 160);
  if (value.scope === "account" && owner.ownerKind !== "account") {
    throw new TypeError("Account memory capture requires an account owner");
  }
  if (value.scope === "space") {
    if (owner.ownerKind !== "account" || !spaceId) {
      throw new TypeError("Space memory capture requires an account owner and Space id");
    }
  } else if (spaceId !== null) {
    throw new TypeError("Non-Space memory capture cannot carry a Space id");
  }
  return Object.freeze({
    schema: MEMORY_CAPTURE_AUTH_SCHEMA,
    authority: "composition",
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    scope: value.scope,
    spaceId,
  });
}

export function validateMemoryCaptureDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory capture draft must be an object");
  }
  const allowed = new Set(["content", "kind", "sensitivity", "provenance"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Memory capture draft cannot choose ${key}`);
    }
  }
  if (!CAPTURE_KINDS.has(value.kind)) {
    throw new TypeError("Memory capture kind is not allowed");
  }
  const sensitivity = value.sensitivity ?? "private";
  if (!CAPTURE_SENSITIVITY.has(sensitivity)) {
    throw new TypeError("Memory capture sensitivity is not allowed");
  }
  return Object.freeze({
    content: boundedText(value.content, "Memory capture content", 32768),
    kind: value.kind,
    sensitivity,
    provenance: boundedText(value.provenance, "Memory capture provenance", 1024),
  });
}

export function validateMemoryCaptureResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory capture result must be an object");
  }
  if (value.schema !== MEMORY_CAPTURE_RESULT_SCHEMA) {
    throw new TypeError("Memory capture result schema is invalid");
  }
  const item = validateMemoryItem(value.item);
  if (item.scope === "project" || item.scope === "session" || item.sensitivity === "restricted") {
    throw new TypeError("Memory capture result contains a forbidden target");
  }
  return Object.freeze({
    schema: MEMORY_CAPTURE_RESULT_SCHEMA,
    item,
    durable: value.durable === true,
  });
}

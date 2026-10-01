export const ACTION_GATEWAY_SCHEMA = "ordax.action-gateway/1";
export const ACTION_REQUEST_SCHEMA = "ordax.action-request/1";

const OWNER_KINDS = new Set(["device", "account"]);
const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const SHA256_RE = /^[0-9a-f]{64}$/;

function boundedText(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max = 256) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

export function validateActionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action Gateway request must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_REQUEST_SCHEMA) {
    throw new TypeError("Action Gateway request schema is incompatible");
  }
  if (!OWNER_KINDS.has(value.ownerKind)) {
    throw new TypeError("Action Gateway owner kind is invalid");
  }
  if (!EFFECTS.has(value.effect)) {
    throw new TypeError("Action Gateway effect is invalid");
  }

  const ownerId = value.ownerKind === "account"
    ? boundedText(value.ownerId, "Action Gateway owner id", 160)
    : null;
  if (value.ownerKind === "device" && value.ownerId != null) {
    throw new TypeError("Device Action Gateway request cannot invent an account owner id");
  }

  return Object.freeze({
    schema: ACTION_REQUEST_SCHEMA,
    workItemId: boundedText(value.workItemId, "Action Gateway work item id", 160),
    approvalId: optionalText(value.approvalId, "Action Gateway approval id", 200),
    actionId: boundedText(value.actionId, "Action Gateway action id", 128),
    toolId: boundedText(value.toolId, "Action Gateway tool id", 96),
    toolArtifactSha256: (() => {
      const digest = boundedText(value.toolArtifactSha256, "Action Gateway tool artifact sha256", 64);
      if (!SHA256_RE.test(digest)) throw new TypeError("Action Gateway tool artifact sha256 is invalid");
      return digest;
    })(),
    effect: value.effect,
    ownerKind: value.ownerKind,
    ownerId,
    spaceId: optionalText(value.spaceId, "Action Gateway Space id", 160),
    projectId: optionalText(value.projectId, "Action Gateway project id", 160),
    resourceRef: optionalText(value.resourceRef, "Action Gateway resource ref", 512),
    reason: boundedText(value.reason, "Action Gateway reason", 512),
    requestedAt: timestamp(value.requestedAt, "Action Gateway requestedAt"),
  });
}

export function assertActionGateway(value) {
  if (!value || typeof value !== "object" || value.schema !== ACTION_GATEWAY_SCHEMA) {
    throw new TypeError("A compatible Action Gateway is required");
  }
  if (typeof value.decide !== "function") {
    throw new TypeError("Action Gateway must implement decide()");
  }
  return value;
}

import { validateIntelligenceToolGrant } from "./intelligence-tool.mjs";

export const INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA =
  "ordax.intelligence-tool-grant-registry/1";
export const INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA =
  "ordax.intelligence-tool-grant-issuer/1";
export const INTELLIGENCE_TOOL_GRANT_ISSUE_SCHEMA =
  "ordax.intelligence-tool-grant-issue/1";
export const INTELLIGENCE_TOOL_GRANT_MAX_TTL_MS = 5 * 60 * 1000;

const OWNER_KINDS = new Set(["device", "account"]);
const MODES = new Set(["read", "write"]);

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

export function validateIntelligenceToolGrantIssue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool grant issue request must be an object");
  }
  if (value.schema !== undefined && value.schema !== INTELLIGENCE_TOOL_GRANT_ISSUE_SCHEMA) {
    throw new TypeError("Intelligence tool grant issue schema is incompatible");
  }
  if (!OWNER_KINDS.has(value.ownerKind)) {
    throw new TypeError("Intelligence tool grant issue owner kind is invalid");
  }
  if (!MODES.has(value.mode)) {
    throw new TypeError("Intelligence tool grant issue mode is invalid");
  }
  if (value.approvedBy !== "user") {
    throw new TypeError("Initial Intelligence tool grants require explicit user approval");
  }

  const ownerId = value.ownerKind === "account"
    ? boundedText(value.ownerId, "Intelligence tool grant issue owner id", 160)
    : null;
  if (value.ownerKind === "device" && value.ownerId != null) {
    throw new TypeError("Device grant issue must not invent an account owner id");
  }

  const requestedAt = timestamp(value.requestedAt, "Intelligence tool grant issue requestedAt");
  const expiresAt = timestamp(value.expiresAt, "Intelligence tool grant issue expiresAt");
  const requestedAtMs = Date.parse(requestedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAtMs <= requestedAtMs) {
    throw new TypeError("Intelligence tool grant expiry must follow approval time");
  }
  if (expiresAtMs - requestedAtMs > INTELLIGENCE_TOOL_GRANT_MAX_TTL_MS) {
    throw new TypeError("Intelligence tool grant exceeds the initial bounded TTL");
  }

  const approvalId = boundedText(value.approvalId, "Intelligence tool grant approval id", 200);
  const toolId = boundedText(value.toolId, "Intelligence tool grant tool id", 96);
  const toolArtifactSha256 = boundedText(value.toolArtifactSha256, "Intelligence tool grant artifact sha256", 64);
  if (!/^[0-9a-f]{64}$/.test(toolArtifactSha256)) {
    throw new TypeError("Intelligence tool grant artifact sha256 is invalid");
  }
  const action = boundedText(value.action, "Intelligence tool grant action", 128);
  const spaceId = optionalText(value.spaceId, "Intelligence tool grant Space", 160);
  const projectId = optionalText(value.projectId, "Intelligence tool grant project", 160);
  const resourceRef = optionalText(value.resourceRef, "Intelligence tool grant resource ref", 512);
  if (value.mode === "write" && resourceRef === null) {
    throw new TypeError("Write grant issue requires an explicit resource reference");
  }

  // Reuse the canonical grant validator so issuance cannot drift from execution authority.
  validateIntelligenceToolGrant({
    grantId: "pending-grant",
    approvalId,
    toolId,
    toolArtifactSha256,
    action,
    mode: value.mode,
    approved: true,
    source: "user-approval",
    ownerKind: value.ownerKind,
    ownerId,
    spaceId,
    projectId,
    resourceRef,
    expiresAt,
  });

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_ISSUE_SCHEMA,
    approvalId,
    toolId,
    toolArtifactSha256,
    action,
    mode: value.mode,
    approvedBy: "user",
    ownerKind: value.ownerKind,
    ownerId,
    spaceId,
    projectId,
    resourceRef,
    requestedAt,
    expiresAt,
  });
}

export function assertIntelligenceToolGrantRegistry(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_TOOL_GRANT_REGISTRY_SCHEMA
    || typeof value.resolve !== "function"
  ) {
    throw new TypeError("A compatible Intelligence tool grant registry is required");
  }
  return value;
}

export function assertIntelligenceToolGrantIssuer(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_TOOL_GRANT_ISSUER_SCHEMA
    || typeof value.issue !== "function"
    || typeof value.revoke !== "function"
  ) {
    throw new TypeError("A compatible Intelligence tool grant issuer is required");
  }
  return value;
}

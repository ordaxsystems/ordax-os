export const EXTERNAL_EGRESS_GRANT_SCHEMA = "ordax.external-egress-grant/1";
export const EXTERNAL_EGRESS_GRANT_ISSUE_SCHEMA = "ordax.external-egress-grant-issue/1";
export const EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA = "ordax.external-egress-grant-registry/1";
export const EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA = "ordax.external-egress-grant-issuer/1";

export const EXTERNAL_EGRESS_MAX_TTL_MS = 5 * 60 * 1000;
export const EXTERNAL_EGRESS_MAX_DESTINATIONS = 16;
export const EXTERNAL_EGRESS_MAX_REQUESTS = 10;
export const EXTERNAL_EGRESS_MAX_BYTES = 10_000_000;
export const EXTERNAL_EGRESS_MAX_COST_USD = 100;
export const EXTERNAL_EGRESS_MAX_DEADLINE_MS = 60_000;

const OWNER_KINDS = new Set(["device", "account"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const FORBIDDEN_KEYS = new Set([
  "apiKey",
  "apikey",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "credential",
  "credentials",
  "password",
  "cookie",
  "cookies",
  "headers",
  "authorization",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function rejectSecretFields(value, label) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(`${label} cannot carry credential field ${key}`);
    }
  }
}

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

function identifier(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(parsed).toISOString();
}

function boundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function boundedCost(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > EXTERNAL_EGRESS_MAX_COST_USD) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function httpsOrigin(value, label) {
  const raw = boundedText(value, label, 320);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${label} must be an HTTPS origin`);
  }
  if (
    url.protocol !== "https:"
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
    || url.port
  ) {
    throw new TypeError(`${label} must be an exact HTTPS origin without credentials, path, query, fragment or custom port`);
  }
  return url.origin.toLowerCase();
}

function destinations(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > EXTERNAL_EGRESS_MAX_DESTINATIONS) {
    throw new TypeError("External egress destinations must be a non-empty bounded array");
  }
  const normalized = value.map((entry, index) => httpsOrigin(entry, `External egress destination[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("External egress destinations must be unique");
  }
  return Object.freeze(normalized);
}

function normalizeScope(value, { includeGrantId }) {
  const input = object(value, includeGrantId ? "External egress grant" : "External egress grant issue");
  rejectSecretFields(input, includeGrantId ? "External egress grant" : "External egress grant issue");

  if (input.effect !== undefined && input.effect !== "external-egress") {
    throw new TypeError("External egress grant effect is incompatible");
  }
  if (!OWNER_KINDS.has(input.ownerKind)) {
    throw new TypeError("External egress grant owner kind is invalid");
  }
  const ownerId = input.ownerKind === "account"
    ? boundedText(input.ownerId, "External egress owner id", 160)
    : null;
  if (input.ownerKind === "device" && input.ownerId != null) {
    throw new TypeError("Device external egress grant cannot invent an account owner id");
  }
  const toolArtifactSha256 = boundedText(
    input.toolArtifactSha256,
    "External egress tool artifact sha256",
    64,
  );
  if (!SHA256_RE.test(toolArtifactSha256)) {
    throw new TypeError("External egress tool artifact sha256 is invalid");
  }

  const issuedAt = timestamp(
    includeGrantId ? input.issuedAt : input.requestedAt,
    includeGrantId ? "External egress issuedAt" : "External egress requestedAt",
  );
  const expiresAt = timestamp(input.expiresAt, "External egress expiresAt");
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= issuedMs) {
    throw new TypeError("External egress grant expiry must follow approval time");
  }
  if (expiresMs - issuedMs > EXTERNAL_EGRESS_MAX_TTL_MS) {
    throw new TypeError("External egress grant exceeds the bounded TTL");
  }

  return Object.freeze({
    ...(includeGrantId ? { grantId: identifier(input.grantId, "External egress grant id") } : {}),
    workItemId: boundedText(input.workItemId, "External egress work item id", 160),
    approvalId: boundedText(input.approvalId, "External egress approval id", 200),
    toolId: identifier(input.toolId, "External egress tool id"),
    toolArtifactSha256,
    actionId: boundedText(input.actionId, "External egress action id", 128),
    effect: "external-egress",
    ownerKind: input.ownerKind,
    ownerId,
    spaceId: optionalText(input.spaceId, "External egress Space id", 160),
    projectId: optionalText(input.projectId, "External egress project id", 160),
    resourceRef: boundedText(input.resourceRef, "External egress resource ref", 512),
    destinations: destinations(input.destinations),
    maxRequests: boundedInteger(input.maxRequests, "External egress maxRequests", 1, EXTERNAL_EGRESS_MAX_REQUESTS),
    maxExternalBytes: boundedInteger(input.maxExternalBytes, "External egress maxExternalBytes", 1_024, EXTERNAL_EGRESS_MAX_BYTES),
    maxCostUsd: boundedCost(input.maxCostUsd, "External egress maxCostUsd"),
    deadlineMs: boundedInteger(input.deadlineMs, "External egress deadlineMs", 250, EXTERNAL_EGRESS_MAX_DEADLINE_MS),
    approvedBy: input.approvedBy === "user"
      ? "user"
      : (() => { throw new TypeError("External egress grant requires explicit user approval"); })(),
    issuedAt,
    expiresAt,
  });
}

export function validateExternalEgressGrantIssue(value) {
  const input = object(value, "External egress grant issue");
  if (input.schema !== undefined && input.schema !== EXTERNAL_EGRESS_GRANT_ISSUE_SCHEMA) {
    throw new TypeError("External egress grant issue schema is incompatible");
  }
  const normalized = normalizeScope(input, { includeGrantId: false });
  return Object.freeze({
    schema: EXTERNAL_EGRESS_GRANT_ISSUE_SCHEMA,
    ...normalized,
    requestedAt: normalized.issuedAt,
    issuedAt: undefined,
  });
}

export function validateExternalEgressGrant(value) {
  const input = object(value, "External egress grant");
  if (input.schema !== undefined && input.schema !== EXTERNAL_EGRESS_GRANT_SCHEMA) {
    throw new TypeError("External egress grant schema is incompatible");
  }
  const normalized = normalizeScope(input, { includeGrantId: true });
  return Object.freeze({ schema: EXTERNAL_EGRESS_GRANT_SCHEMA, ...normalized });
}

export function assertExternalEgressGrantRegistry(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA
    || typeof value.resolve !== "function"
  ) {
    throw new TypeError("A compatible External Egress Grant registry is required");
  }
  return value;
}

export function assertExternalEgressGrantIssuer(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA
    || typeof value.issue !== "function"
    || typeof value.revoke !== "function"
  ) {
    throw new TypeError("A compatible External Egress Grant issuer is required");
  }
  return value;
}

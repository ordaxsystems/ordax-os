import { validateIntelligenceAgentId } from "./intelligence-agent.mjs";
import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";
import { validateIntelligenceToolId } from "./intelligence-tool.mjs";

export const INTELLIGENCE_TOOL_GRANT_SCHEMA = "ordax.intelligence-tool-grant/1";
export const INTELLIGENCE_TOOL_GRANT_BROKER_SCHEMA = "ordax.intelligence-tool-grant-broker/1";

const GRANT_ID_RE = /^tool-grant-[a-z0-9]{16,96}$/;
const CAPABILITY_ID_RE = /^[a-z][a-z0-9.-]{0,127}$/;
const SCOPE_ID_RE = /^[a-z][a-z0-9.-]{0,63}$/;
const ALLOWED_KEYS = new Set([
  "schema",
  "id",
  "agentId",
  "toolId",
  "capabilityId",
  "target",
  "inputScopes",
  "issuedAt",
  "expiresAt",
  "oneShot",
  "readOnly",
  "networkEgress",
  "mutatesState",
  "authority",
  "executable",
  "toolExecution",
]);

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validateScopes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TypeError("Intelligence tool grant scopes must be a bounded non-empty array");
  }
  const scopes = value.map((scope) => {
    const normalized = boundedText(scope, "Intelligence tool grant scope", 64);
    if (!SCOPE_ID_RE.test(normalized)) {
      throw new TypeError("Intelligence tool grant scope is invalid");
    }
    return normalized;
  });
  if (new Set(scopes).size !== scopes.length) {
    throw new TypeError("Intelligence tool grant scopes must be unique");
  }
  return Object.freeze(scopes);
}

export function validateIntelligenceToolGrantId(value) {
  const id = boundedText(value, "Intelligence tool grant id", 112);
  if (!GRANT_ID_RE.test(id)) {
    throw new TypeError("Intelligence tool grant id is invalid");
  }
  return id;
}

export function validateIntelligenceToolGrantDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool grant descriptor must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new TypeError(`Intelligence tool grant field ${key} is not allowed`);
    }
  }
  if (value.schema !== INTELLIGENCE_TOOL_GRANT_SCHEMA) {
    throw new TypeError("Intelligence tool grant schema is invalid");
  }
  if (
    value.oneShot !== true
    || value.readOnly !== true
    || value.networkEgress !== false
    || value.mutatesState !== false
    || value.authority !== "none"
    || value.executable !== false
    || value.toolExecution !== false
  ) {
    throw new TypeError("Intelligence tool grant foundation must remain one-shot, read-only and non-executable");
  }

  const target = validateIntelligenceTaskTarget(value.target);
  if (target.kind === "unspecified") {
    throw new TypeError("Intelligence tool grant requires a concrete target");
  }
  const issuedAt = timestamp(value.issuedAt, "Intelligence tool grant issuedAt");
  const expiresAt = timestamp(value.expiresAt, "Intelligence tool grant expiresAt");
  if (expiresAt <= issuedAt) {
    throw new TypeError("Intelligence tool grant expiry must be after issue time");
  }
  const capabilityId = boundedText(value.capabilityId, "Intelligence tool grant capability id", 128);
  if (!CAPABILITY_ID_RE.test(capabilityId)) {
    throw new TypeError("Intelligence tool grant capability id is invalid");
  }

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
    id: validateIntelligenceToolGrantId(value.id),
    agentId: validateIntelligenceAgentId(value.agentId),
    toolId: validateIntelligenceToolId(value.toolId),
    capabilityId,
    target,
    inputScopes: validateScopes(value.inputScopes),
    issuedAt,
    expiresAt,
    oneShot: true,
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

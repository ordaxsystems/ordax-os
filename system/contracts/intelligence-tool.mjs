export const INTELLIGENCE_TOOL_SCHEMA = "ordax.intelligence-tool/1";
export const INTELLIGENCE_TOOL_GRANT_SCHEMA = "ordax.intelligence-tool-grant/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const ACTION_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODES = new Set(["read", "write"]);
const APPROVAL = new Set(["none", "per-use", "session"]);
const SANDBOXES = new Set(["wasi-component", "native-broker"]);
const OWNER_KINDS = new Set(["device", "account"]);
const FORBIDDEN_GRANT_SOURCES = new Set(["prompt", "model", "profile", "profile-pack", "memory", "project-content"]);

const ABSOLUTELY_FORBIDDEN_ACTIONS = new Set([
  "shell.generic",
  "host.raw-disk",
  "system.release-key.read",
  "system.release-key.write",
  "system.trust-anchor.write",
  "system.physical-write-authorize",
]);

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

function identifier(value, label, pattern = ID_RE) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boundedUniqueStrings(value, label, maxItems = 64) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const result = value.map((item) => boundedText(item, label, 160));
  if (new Set(result).size !== result.length) {
    throw new TypeError(`${label} must contain unique values`);
  }
  return Object.freeze(result);
}

function normalizeActions(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError("tool actions must be a non-empty bounded array");
  }
  return Object.freeze(value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("tool action must be an object");
    }
    const id = identifier(entry.id, "tool action id", ACTION_RE);
    if (ABSOLUTELY_FORBIDDEN_ACTIONS.has(id)) {
      throw new TypeError(`tool action is forbidden: ${id}`);
    }
    if (!MODES.has(entry.mode)) throw new TypeError("tool action mode is unsupported");
    if (!APPROVAL.has(entry.approval)) {
      throw new TypeError("tool action approval policy is unsupported");
    }
    if (entry.mode === "write" && entry.approval === "none") {
      throw new TypeError("write tool actions require explicit approval");
    }
    return Object.freeze({
      id,
      mode: entry.mode,
      approval: entry.approval,
      scopes: boundedUniqueStrings(entry.scopes ?? [], "tool action scopes"),
    });
  }));
}

export function defineIntelligenceTool(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool must be an object");
  }
  if (!SANDBOXES.has(value.sandbox)) {
    throw new TypeError("Intelligence tool sandbox is unsupported");
  }
  if (typeof value.artifactSha256 !== "string" || !SHA256_RE.test(value.artifactSha256)) {
    throw new TypeError("Intelligence tool artifact sha256 is invalid");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: identifier(value.id, "tool id"),
    version: boundedText(value.version, "tool version", 64),
    artifactSha256: value.artifactSha256,
    sandbox: value.sandbox,
    actions: normalizeActions(value.actions),
    network: Object.freeze({
      allowed: value.network?.allowed === true,
      destinations: boundedUniqueStrings(value.network?.destinations ?? [], "network destinations", 32),
    }),
    filesystem: Object.freeze({
      allowed: value.filesystem?.allowed === true,
      scopes: boundedUniqueStrings(value.filesystem?.scopes ?? [], "filesystem scopes", 32),
    }),
    limits: Object.freeze({
      timeoutMs: Number.isSafeInteger(value.limits?.timeoutMs) && value.limits.timeoutMs >= 100
        && value.limits.timeoutMs <= 300000
        ? value.limits.timeoutMs
        : (() => { throw new TypeError("tool timeoutMs is outside bounds"); })(),
      maxOutputBytes: Number.isSafeInteger(value.limits?.maxOutputBytes)
        && value.limits.maxOutputBytes > 0
        && value.limits.maxOutputBytes <= 8 * 1024 * 1024
        ? value.limits.maxOutputBytes
        : (() => { throw new TypeError("tool maxOutputBytes is outside bounds"); })(),
    }),
  });
}

export function validateIntelligenceToolGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence tool grant must be an object");
  }
  const mode = value.mode;
  if (!MODES.has(mode)) throw new TypeError("tool grant mode is unsupported");
  if (mode === "write" && value.approved !== true) {
    throw new TypeError("write tool grant requires explicit approval");
  }
  const action = identifier(value.action, "tool grant action", ACTION_RE);
  if (ABSOLUTELY_FORBIDDEN_ACTIONS.has(action)) {
    throw new TypeError(`tool grant action is forbidden: ${action}`);
  }
  const source = boundedText(value.source, "tool grant source", 64);
  const approvalId = boundedText(value.approvalId, "tool grant approval id", 200);
  const resourceRef = value.resourceRef == null || value.resourceRef === ""
    ? null
    : boundedText(value.resourceRef, "tool grant resource ref", 512);
  if (mode === "write" && resourceRef === null) {
    throw new TypeError("write tool grant requires an explicit resource reference");
  }
  if (FORBIDDEN_GRANT_SOURCES.has(source)) {
    throw new TypeError("content cannot create tool authority");
  }
  if (!OWNER_KINDS.has(value.ownerKind)) {
    throw new TypeError("tool grant owner kind is invalid");
  }
  const ownerId = value.ownerKind === "account"
    ? boundedText(value.ownerId, "tool grant owner id", 160)
    : null;
  if (value.ownerKind === "device" && value.ownerId != null) {
    throw new TypeError("device tool grant must not invent an account owner id");
  }
  let expiresAt = null;
  if (value.expiresAt != null) {
    const expiryText = boundedText(value.expiresAt, "tool grant expiry", 64);
    const parsed = Date.parse(expiryText);
    if (!Number.isFinite(parsed)) {
      throw new TypeError("tool grant expiry must be an ISO-8601 timestamp");
    }
    expiresAt = new Date(parsed).toISOString();
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
    grantId: identifier(value.grantId, "tool grant id"),
    approvalId,
    toolId: identifier(value.toolId, "tool grant tool id"),
    toolArtifactSha256: (() => {
      const digest = boundedText(value.toolArtifactSha256, "tool grant artifact sha256", 64);
      if (!SHA256_RE.test(digest)) throw new TypeError("tool grant artifact sha256 is invalid");
      return digest;
    })(),
    action,
    mode,
    approved: value.approved === true,
    source,
    ownerKind: value.ownerKind,
    ownerId,
    spaceId: value.spaceId == null ? null : boundedText(value.spaceId, "tool grant Space", 160),
    projectId: value.projectId == null ? null : boundedText(value.projectId, "tool grant project", 160),
    resourceRef,
    expiresAt,
  });
}

export function authorizeIntelligenceToolAction(toolValue, grantValue) {
  const tool = defineIntelligenceTool(toolValue);
  const grant = validateIntelligenceToolGrant(grantValue);
  if (grant.toolId !== tool.id || grant.toolArtifactSha256 !== tool.artifactSha256) return false;
  const action = tool.actions.find((candidate) => candidate.id === grant.action);
  if (!action || action.mode !== grant.mode) return false;
  if (action.mode === "write" && !grant.approved) return false;
  return true;
}

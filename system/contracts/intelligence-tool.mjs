export const INTELLIGENCE_TOOL_SCHEMA = "ordax.intelligence-tool/1";
export const INTELLIGENCE_TOOL_GRANT_SCHEMA = "ordax.intelligence-tool-grant/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const ACTION_RE = /^[a-z][a-z0-9._-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODES = new Set(["read", "write"]);
const APPROVAL = new Set(["none", "per-use", "session"]);
const SANDBOXES = new Set(["wasi-component", "native-broker"]);

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
  if (value.source === "prompt") {
    throw new TypeError("prompt text cannot create tool authority");
  }
  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
    grantId: identifier(value.grantId, "tool grant id"),
    toolId: identifier(value.toolId, "tool grant tool id"),
    action,
    mode,
    approved: value.approved === true,
    source: boundedText(value.source, "tool grant source", 64),
    ownerKind: boundedText(value.ownerKind, "tool grant owner kind", 32),
    ownerId: boundedText(value.ownerId, "tool grant owner id", 160),
    spaceId: value.spaceId == null ? null : boundedText(value.spaceId, "tool grant Space", 160),
    projectId: value.projectId == null ? null : boundedText(value.projectId, "tool grant project", 160),
    expiresAt: value.expiresAt == null ? null : boundedText(value.expiresAt, "tool grant expiry", 64),
  });
}

export function authorizeIntelligenceToolAction(toolValue, grantValue) {
  const tool = defineIntelligenceTool(toolValue);
  const grant = validateIntelligenceToolGrant(grantValue);
  if (grant.toolId !== tool.id) return false;
  const action = tool.actions.find((candidate) => candidate.id === grant.action);
  if (!action || action.mode !== grant.mode) return false;
  if (action.mode === "write" && !grant.approved) return false;
  return true;
}

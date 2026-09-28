import { validateIntelligenceTaskTarget } from "./intelligence-task.mjs";

export const INTELLIGENCE_HANDOFF_SCHEMA = "ordax.intelligence-handoff/1";
export const INTELLIGENCE_HANDOFF_TARGET_PREFIX = "ordax-intelligence://handoff/v1";

const HANDOFF_MODES = new Set(["ask", "plan"]);
const APP_ID_RE = /^[a-z][a-z0-9-]{0,95}$/;
const ALLOWED_QUERY_KEYS = new Set(["mode", "source", "kind", "id", "label", "prompt"]);
const MAX_TARGET_LENGTH = 4096;

function boundedOptionalText(value, label, max) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateIntelligenceHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Intelligence handoff must be an object");
  }
  if (!APP_ID_RE.test(value.sourceAppId ?? "")) {
    throw new TypeError("Intelligence handoff source app id is invalid");
  }
  if (!HANDOFF_MODES.has(value.mode)) {
    throw new TypeError("Intelligence handoff mode is invalid");
  }
  const target = validateIntelligenceTaskTarget(value.target);
  if (target.kind === "unspecified") {
    throw new TypeError("Intelligence handoff requires a concrete target");
  }
  if (
    (value.authority !== undefined && value.authority !== "none")
    || value.executable === true
    || value.toolExecution === true
  ) {
    throw new TypeError("Intelligence handoff cannot grant execution authority");
  }
  return Object.freeze({
    schema: INTELLIGENCE_HANDOFF_SCHEMA,
    sourceAppId: value.sourceAppId,
    mode: value.mode,
    target,
    displayLabel: boundedOptionalText(value.displayLabel, "Intelligence handoff display label", 160),
    suggestedPrompt: boundedOptionalText(value.suggestedPrompt, "Intelligence handoff suggested prompt", 2000),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

export function encodeIntelligenceHandoffTarget(value) {
  const handoff = validateIntelligenceHandoff(value);
  const query = new URLSearchParams();
  query.set("mode", handoff.mode);
  query.set("source", handoff.sourceAppId);
  query.set("kind", handoff.target.kind);
  query.set("id", handoff.target.id);
  if (handoff.displayLabel !== null) query.set("label", handoff.displayLabel);
  if (handoff.suggestedPrompt !== null) query.set("prompt", handoff.suggestedPrompt);
  const encoded = `${INTELLIGENCE_HANDOFF_TARGET_PREFIX}?${query.toString()}`;
  if (encoded.length > MAX_TARGET_LENGTH) {
    throw new TypeError("Intelligence handoff target exceeds the workspace target bound");
  }
  return encoded;
}

export function parseIntelligenceHandoffTarget(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.startsWith("ordax-intelligence:")) return null;
  if (value.length > MAX_TARGET_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError("Intelligence handoff target is invalid");
  }

  let target;
  try {
    target = new URL(value);
  } catch (error) {
    throw new TypeError("Intelligence handoff target URL is invalid", { cause: error });
  }
  if (
    target.protocol !== "ordax-intelligence:"
    || target.hostname !== "handoff"
    || target.pathname !== "/v1"
    || target.hash
    || target.username
    || target.password
    || target.port
  ) {
    throw new TypeError("Intelligence handoff target route is invalid");
  }

  for (const key of target.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || target.searchParams.getAll(key).length !== 1) {
      throw new TypeError("Intelligence handoff target query is invalid");
    }
  }
  for (const required of ["mode", "source", "kind", "id"]) {
    if (!target.searchParams.has(required)) {
      throw new TypeError(`Intelligence handoff target is missing ${required}`);
    }
  }

  return validateIntelligenceHandoff({
    sourceAppId: target.searchParams.get("source"),
    mode: target.searchParams.get("mode"),
    target: {
      kind: target.searchParams.get("kind"),
      id: target.searchParams.get("id"),
    },
    displayLabel: target.searchParams.get("label"),
    suggestedPrompt: target.searchParams.get("prompt"),
    authority: "none",
    executable: false,
    toolExecution: false,
  });
}

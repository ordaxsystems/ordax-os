import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
} from "./intelligence.mjs";

export const PROFILE_CONTENT_CONTEXT_SCHEMA = "ordax.profile-content-context/1";
export const PROFILE_CONTENT_CONTEXT_PORT_SCHEMA = "ordax.profile-content-context-port/1";
export const PROFILE_CONTENT_CONTEXT_MAX_ENTRIES = 8;
export const PROFILE_CONTENT_CONTEXT_MAX_TOTAL_CHARS = Math.floor(
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS / 2,
);

const SPACE_ID_MAX = 160;
const PROFILE_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

function text(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function profile(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile content context profile is invalid");
  }
  if (Object.keys(value).sort().join(",") !== "slug,version") {
    throw new TypeError("Profile content context profile fields are incompatible");
  }
  if (typeof value.slug !== "string" || !PROFILE_SLUG_RE.test(value.slug)) {
    throw new TypeError("Profile content context profile slug is invalid");
  }
  if (!Number.isSafeInteger(value.version) || value.version < 1) {
    throw new TypeError("Profile content context profile version is invalid");
  }
  return Object.freeze({ slug: value.slug, version: value.version });
}

export function validateProfileContentContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile content context must be an object");
  }
  if (value.schema !== PROFILE_CONTENT_CONTEXT_SCHEMA) {
    throw new TypeError("Profile content context schema is incompatible");
  }
  const spaceId = text(value.spaceId, "Profile content context Space id", SPACE_ID_MAX);
  const normalizedProfile = profile(value.profile);
  if (!Array.isArray(value.entries) || value.entries.length > PROFILE_CONTENT_CONTEXT_MAX_ENTRIES) {
    throw new TypeError("Profile content context entries are outside bounds");
  }
  let total = 0;
  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`Profile content context entry[${index}] is invalid`);
    }
    if (
      Object.keys(entry).sort().join(",")
      !== "id,provenance,scope,text"
    ) {
      throw new TypeError(`Profile content context entry[${index}] fields are incompatible`);
    }
    if (entry.scope !== "workspace") {
      throw new TypeError("Profile content context may only use workspace scope");
    }
    const normalized = Object.freeze({
      id: text(entry.id, "Profile content context entry id", 160),
      scope: "workspace",
      text: text(
        entry.text,
        "Profile content context entry text",
        INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
      ),
      provenance: text(
        entry.provenance,
        "Profile content context provenance",
        512,
      ),
    });
    total += normalized.text.length;
    if (total > PROFILE_CONTENT_CONTEXT_MAX_TOTAL_CHARS) {
      throw new TypeError("Profile content context exceeds total text bound");
    }
    return normalized;
  });
  if (normalizedProfile === null && entries.length !== 0) {
    throw new TypeError("Profile content context without active Profile must be empty");
  }
  return Object.freeze({
    schema: PROFILE_CONTENT_CONTEXT_SCHEMA,
    spaceId,
    profile: normalizedProfile,
    entries: Object.freeze(entries),
  });
}

export function assertProfileContentContextPort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== PROFILE_CONTENT_CONTEXT_PORT_SCHEMA
    || typeof port.read !== "function"
  ) {
    throw new TypeError("Compatible Profile content context port is required");
  }
  return port;
}

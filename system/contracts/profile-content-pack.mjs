import { createHash } from "node:crypto";

export const PROFILE_CONTENT_PACK_SCHEMA = "ordax.profile-content-pack/1";
export const PROFILE_CONTENT_HEALTH_SCHEMA = "ordax.profile-content-health/1";

const ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KINDS = new Set(["knowledge-pack", "skill-pack"]);
const KNOWLEDGE_MEDIA_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
]);
const MAX_ENTRIES = 2048;
const MAX_TEXT_CHARS = 1024 * 1024;
const MAX_TOTAL_TEXT_CHARS = 32 * 1024 * 1024;

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max = 240) {
  if (value == null) return null;
  return text(value, label, max);
}

function id(value, label) {
  const result = text(value, label, 128);
  if (!ID_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function sha256Text(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function sourceValue(value, label) {
  const source = objectValue(value, label);
  exactFields(source, [
    "uri",
    "revision",
    "license",
    "jurisdiction",
    "title",
  ], label);
  return Object.freeze({
    uri: text(source.uri, `${label}.uri`, 512),
    revision: text(source.revision, `${label}.revision`, 160),
    license: text(source.license, `${label}.license`, 120),
    jurisdiction: optionalText(source.jurisdiction, `${label}.jurisdiction`, 80),
    title: text(source.title, `${label}.title`, 240),
  });
}

function validateKnowledgeEntry(value, index) {
  const label = `Knowledge entry[${index}]`;
  const entry = objectValue(value, label);
  exactFields(entry, [
    "id",
    "mediaType",
    "content",
    "contentSha256",
    "source",
  ], label);
  if (!KNOWLEDGE_MEDIA_TYPES.has(entry.mediaType)) {
    throw new TypeError(`${label}.mediaType is unsupported`);
  }
  const content = text(entry.content, `${label}.content`, MAX_TEXT_CHARS);
  const contentSha256 = text(entry.contentSha256, `${label}.contentSha256`, 64);
  if (!SHA256_PATTERN.test(contentSha256) || sha256Text(content) !== contentSha256) {
    throw new TypeError(`${label}.contentSha256 does not match content`);
  }
  if (entry.mediaType === "application/json") {
    try {
      JSON.parse(content);
    } catch {
      throw new TypeError(`${label}.content is invalid JSON`);
    }
  }
  return Object.freeze({
    id: id(entry.id, `${label}.id`),
    mediaType: entry.mediaType,
    content,
    contentSha256,
    source: sourceValue(entry.source, `${label}.source`),
  });
}

function validateSkillEntry(value, index) {
  const label = `Skill entry[${index}]`;
  const entry = objectValue(value, label);
  exactFields(entry, [
    "id",
    "title",
    "instructions",
    "instructionsSha256",
    "authority",
    "toolIds",
    "source",
  ], label);
  if (entry.authority !== "none") {
    throw new TypeError(`${label}.authority must remain none`);
  }
  if (!Array.isArray(entry.toolIds) || entry.toolIds.length !== 0) {
    throw new TypeError(`${label}.toolIds must remain empty`);
  }
  const instructions = text(entry.instructions, `${label}.instructions`, MAX_TEXT_CHARS);
  const instructionsSha256 = text(
    entry.instructionsSha256,
    `${label}.instructionsSha256`,
    64,
  );
  if (
    !SHA256_PATTERN.test(instructionsSha256)
    || sha256Text(instructions) !== instructionsSha256
  ) {
    throw new TypeError(`${label}.instructionsSha256 does not match instructions`);
  }
  return Object.freeze({
    id: id(entry.id, `${label}.id`),
    title: text(entry.title, `${label}.title`, 160),
    instructions,
    instructionsSha256,
    authority: "none",
    toolIds: Object.freeze([]),
    source: sourceValue(entry.source, `${label}.source`),
  });
}

export function validateProfileContentPack(value) {
  const pack = objectValue(value, "Profile content pack");
  exactFields(pack, ["schema", "kind", "entries"], "Profile content pack");
  if (pack.schema !== PROFILE_CONTENT_PACK_SCHEMA) {
    throw new TypeError("Unsupported Profile content pack schema");
  }
  if (!KINDS.has(pack.kind)) {
    throw new TypeError("Profile content pack kind is unsupported");
  }
  if (!Array.isArray(pack.entries) || pack.entries.length < 1 || pack.entries.length > MAX_ENTRIES) {
    throw new TypeError("Profile content pack entries are outside bounds");
  }
  const validator = pack.kind === "knowledge-pack"
    ? validateKnowledgeEntry
    : validateSkillEntry;
  const entries = pack.entries.map((entry, index) => validator(entry, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new TypeError("Profile content pack entry ids must be unique");
  }
  const totalTextChars = entries.reduce(
    (total, entry) => total + ("content" in entry ? entry.content.length : entry.instructions.length),
    0,
  );
  if (totalTextChars > MAX_TOTAL_TEXT_CHARS) {
    throw new TypeError("Profile content pack total text exceeds bounds");
  }
  return Object.freeze({
    schema: PROFILE_CONTENT_PACK_SCHEMA,
    kind: pack.kind,
    entries: Object.freeze(entries),
  });
}

export function inspectProfileContentPackHealth(value, expectedKind) {
  const pack = validateProfileContentPack(value);
  if (pack.kind !== expectedKind) {
    throw new TypeError("Profile content pack kind does not match signed artifact kind");
  }
  return Object.freeze({
    schema: PROFILE_CONTENT_HEALTH_SCHEMA,
    state: "healthy",
    kind: pack.kind,
    entryCount: pack.entries.length,
    perEntryHashVerified: true,
    perEntryProvenanceVerified: true,
    executablePayloadAllowed: false,
    authority: "none",
  });
}

export const PROACTIVE_RESEARCH_SCHEMA = "ordax.proactive-research/1";
export const PROACTIVE_RESEARCH_SOURCE_SCHEMA = "ordax.proactive-research-source/1";
export const PROACTIVE_RESEARCH_AUTH_SCHEMA = "ordax.proactive-research-auth/1";
export const PROACTIVE_RESEARCH_RESULT_SCHEMA = "ordax.proactive-research-result/1";

const OWNER_KINDS = new Set(["device", "account"]);
const SOURCE_KINDS = new Set(["memory", "work", "project", "file-metadata", "system-status"]);
const SENSITIVITY = new Set(["public", "personal", "restricted"]);

function text(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} is outside bounds`);
  return normalized;
}

function optionalText(value, label, max = 256) {
  return value == null || value === "" ? null : text(value, label, max);
}

function validateOwner(ownerKind, ownerId) {
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Research owner kind is invalid");
  if (ownerKind === "device") {
    if (ownerId != null) throw new TypeError("Device research owner must not use synthetic owner id");
    return { ownerKind, ownerId: null };
  }
  return { ownerKind, ownerId: text(ownerId, "Research owner id", 160) };
}

export function validateResearchRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Research request must be an object");
  const owner = validateOwner(value.ownerKind, value.ownerId ?? null);
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length < 1 || value.sourceIds.length > 16) {
    throw new TypeError("Research source ids must be bounded");
  }
  const sourceIds = value.sourceIds.map((entry) => text(entry, "Research source id", 160));
  if (new Set(sourceIds).size !== sourceIds.length) throw new TypeError("Research source ids must be unique");
  return Object.freeze({
    researchId: text(value.researchId, "Research id", 160),
    subjectId: text(value.subjectId, "Research subject id", 160),
    query: text(value.query, "Research query", 1024),
    ...owner,
    spaceId: optionalText(value.spaceId, "Research Space id", 160),
    projectId: optionalText(value.projectId, "Research project id", 160),
    sourceIds: Object.freeze(sourceIds),
    includeRestricted: value.includeRestricted === true,
  });
}

export function validateResearchEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Research evidence must be an object");
  if (!SOURCE_KINDS.has(value.sourceKind)) throw new TypeError("Research source kind is invalid");
  if (!SENSITIVITY.has(value.sensitivity)) throw new TypeError("Research sensitivity is invalid");
  return Object.freeze({
    evidenceId: text(value.evidenceId, "Research evidence id", 160),
    sourceId: text(value.sourceId, "Research evidence source id", 160),
    sourceKind: value.sourceKind,
    provenanceRef: text(value.provenanceRef, "Research provenance ref", 512),
    excerpt: text(value.excerpt, "Research evidence excerpt", 4096),
    sensitivity: value.sensitivity,
  });
}

export function validateResearchResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== PROACTIVE_RESEARCH_RESULT_SCHEMA) {
    throw new TypeError("Research result is incompatible");
  }
  if (value.authority !== "none") throw new TypeError("Research result cannot create authority");
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 64) throw new TypeError("Research evidence refs must be bounded");
  const evidenceRefs = value.evidenceRefs.map((entry) => text(entry, "Research evidence ref", 160));
  if (new Set(evidenceRefs).size !== evidenceRefs.length) throw new TypeError("Research evidence refs must be unique");
  return Object.freeze({
    schema: PROACTIVE_RESEARCH_RESULT_SCHEMA,
    researchId: text(value.researchId, "Research result id", 160),
    subjectId: text(value.subjectId, "Research result subject id", 160),
    summary: text(value.summary, "Research summary", 8192),
    evidenceRefs: Object.freeze(evidenceRefs),
    authority: "none",
  });
}

export function assertResearchSource(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PROACTIVE_RESEARCH_SOURCE_SCHEMA
    || typeof value.id !== "string"
    || !SOURCE_KINDS.has(value.kind)
    || value.network !== false
    || value.mutation !== false
    || typeof value.read !== "function"
  ) throw new TypeError("A compatible local read-only research source is required");
  return value;
}

export function assertResearchAuthorization(value) {
  if (!value || typeof value !== "object" || value.schema !== PROACTIVE_RESEARCH_AUTH_SCHEMA || typeof value.authorizeRead !== "function") {
    throw new TypeError("A compatible research authorization port is required");
  }
  return value;
}

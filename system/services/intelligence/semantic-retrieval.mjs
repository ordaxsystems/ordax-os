import {
  defineSemanticIndexDescriptor,
  defineSemanticIndexRecord,
  semanticIndexNeedsRebuild,
  semanticRecordIsCurrent,
} from "../../contracts/semantic-index.mjs";

export const SCOPED_SEMANTIC_RETRIEVAL_SCHEMA = "ordax.scoped-semantic-retrieval/1";

const SHA256_RE = /^[a-f0-9]{64}$/;
const SOURCE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/;
const MAX_RECORDS = 8192;
const MAX_RESULTS = 32;
const MAX_SCORING_DIMENSIONS = 4096;
const MAX_SCORING_COMPONENTS = 8_388_608;

function requireScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("Semantic retrieval authorization scope is required");
  }
  for (const property of ["ownerKind", "ownerId"]) {
    if (typeof scope[property] !== "string" || !scope[property].trim()) {
      throw new TypeError("Semantic retrieval authorization scope is invalid");
    }
  }
  for (const property of ["spaceId", "projectId"]) {
    if (scope[property] != null && (typeof scope[property] !== "string" || !scope[property].trim())) {
      throw new TypeError("Semantic retrieval authorization scope is invalid");
    }
  }
  return Object.freeze({
    ownerKind: scope.ownerKind,
    ownerId: scope.ownerId,
    spaceId: scope.spaceId ?? null,
    projectId: scope.projectId ?? null,
  });
}

function matchesScope(a, b) {
  return a.ownerKind === b.ownerKind
    && a.ownerId === b.ownerId
    && a.spaceId === b.spaceId
    && a.projectId === b.projectId;
}

function validateVector(vector, dimensions, label) {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new TypeError(label + " dimensions differ from active embedding artifact");
  }
  if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new TypeError(label + " contains non-finite values");
  }
  return vector;
}

function vectorNorm(vector) {
  let squared = 0;
  for (const component of vector) squared += component * component;
  return Math.sqrt(squared);
}

function score(query, record, distance, queryNorm) {
  let dot = 0;
  let norm = 0;
  let squaredDistance = 0;
  for (let index = 0; index < query.length; index += 1) {
    dot += query[index] * record[index];
    norm += record[index] * record[index];
    const delta = query[index] - record[index];
    squaredDistance += delta * delta;
  }
  if (distance === "l2") return -Math.sqrt(squaredDistance);
  if (distance === "dot") return dot;
  if (norm === 0) throw new TypeError("Cosine semantic record cannot be a zero vector");
  return dot / (queryNorm * Math.sqrt(norm));
}

// Pure read-only ranking. The Memory/Profile owner MUST produce the list of
// authorizedSources after enforcing permissions. This function checks the
// exact owner/Space/project binding and source hashes before scoring.
// It does not fetch data, create embeddings, write an index, or grant access.
export function rankScopedSemanticRecords({
  index,
  runtime,
  authorizationScope,
  authorizedSources,
  records,
  queryVector,
  limit = 8,
} = {}) {
  const descriptor = defineSemanticIndexDescriptor(index);
  const scope = requireScope(authorizationScope);
  if (!matchesScope(descriptor, scope)) {
    throw new Error("Semantic retrieval index does not belong to the authorized scope");
  }
  if (!descriptor.rebuildable || descriptor.sourceOfTruth !== false) {
    throw new TypeError("Semantic retrieval requires a derived, rebuildable index");
  }
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError("Active embedding runtime identity is required");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULTS) {
    throw new TypeError("Semantic retrieval limit is outside bounds");
  }
  if (!Array.isArray(authorizedSources) || !Array.isArray(records)
      || authorizedSources.length > MAX_RECORDS || records.length > MAX_RECORDS) {
    throw new TypeError("Semantic retrieval source/record counts exceed bounds");
  }
  if (descriptor.dimensions > MAX_SCORING_DIMENSIONS
      || records.length * descriptor.dimensions > MAX_SCORING_COMPONENTS) {
    throw new TypeError("Semantic retrieval exceeds local vector scoring budget");
  }
  const empty = (state) => Object.freeze({
    schema: SCOPED_SEMANTIC_RETRIEVAL_SCHEMA,
    state,
    indexId: descriptor.id,
    matches: Object.freeze([]),
  });

  // Incompatible embedding artifact/model/version/dimensions invalidate
  // the entire derived index. Rebuild from canonical data, never dual-write.
  if (semanticIndexNeedsRebuild(descriptor, runtime)) return empty("rebuild-required");
  const vector = validateVector(queryVector, descriptor.dimensions, "Semantic query vector");
  const queryNorm = descriptor.distance === "cosine" ? vectorNorm(vector) : 1;
  if (descriptor.distance === "cosine" && queryNorm === 0) {
    throw new TypeError("Cosine semantic query cannot be a zero vector");
  }

  // Authorization filtering precedes vector validation and distance scoring.
  const eligible = new Map();
  for (const source of authorizedSources) {
    if (!source || typeof source !== "object" || Array.isArray(source)
        || typeof source.sourceKind !== "string"
        || source.sourceKind.length < 1 || source.sourceKind.length > 48
        || source.sourceKind.includes("\0")
        || typeof source.sourceId !== "string" || !SOURCE_ID_RE.test(source.sourceId)
        || typeof source.contentSha256 !== "string"
        || !SHA256_RE.test(source.contentSha256)) {
      throw new TypeError("Semantic authorized source identity is invalid");
    }
    const sourceScope = requireScope(source);
    if (!matchesScope(scope, sourceScope)) {
      throw new Error("Semantic authorized source crosses owner or Space");
    }
    const key = source.sourceKind + "\u0000" + source.sourceId;
    if (eligible.has(key)) throw new TypeError("Duplicate semantic authorized source identity");
    eligible.set(key, Object.freeze({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      contentSha256: source.contentSha256,
    }));
  }

  const ranked = [];
  const encountered = new Set();
  for (const untrusted of records) {
    // Do not even inspect an unauthorized record vector.
    const key = String(untrusted?.sourceKind) + "\u0000" + String(untrusted?.sourceId);
    const source = eligible.get(key);
    if (!source) continue;
    const record = defineSemanticIndexRecord(untrusted);
    if (record.indexId !== descriptor.id || !semanticRecordIsCurrent(record, source)) continue;
    if (encountered.has(key)) throw new TypeError("Duplicate current semantic record identity");
    encountered.add(key);
    validateVector(record.vector, descriptor.dimensions, "Semantic record vector");
    const value = score(vector, record.vector, descriptor.distance, queryNorm);
    if (!Number.isFinite(value)) throw new TypeError("Semantic similarity is not finite");
    ranked.push(Object.freeze({
      sourceKind: record.sourceKind,
      sourceId: record.sourceId,
      contentSha256: record.contentSha256,
      score: value,
    }));
  }
  ranked.sort((left, right) => right.score - left.score
    || left.sourceKind.localeCompare(right.sourceKind, "en")
    || left.sourceId.localeCompare(right.sourceId, "en"));
  return Object.freeze({
    schema: SCOPED_SEMANTIC_RETRIEVAL_SCHEMA,
    state: "ready",
    indexId: descriptor.id,
    matches: Object.freeze(ranked.slice(0, limit)),
  });
}

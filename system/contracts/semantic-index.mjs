export const SEMANTIC_INDEX_SCHEMA = "ordax.semantic-index/1";
export const SEMANTIC_INDEX_RECORD_SCHEMA = "ordax.semantic-index-record/1";

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function boundedText(value, label, max = 240) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function id(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function positiveInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

export function defineSemanticIndexDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Semantic index descriptor must be an object");
  }
  if (typeof value.embeddingArtifactSha256 !== "string" || !SHA256_RE.test(value.embeddingArtifactSha256)) {
    throw new TypeError("Embedding artifact sha256 is invalid");
  }
  return Object.freeze({
    schema: SEMANTIC_INDEX_SCHEMA,
    id: id(value.id, "semantic index id"),
    version: boundedText(value.version, "semantic index version", 64),
    ownerKind: boundedText(value.ownerKind, "semantic index owner kind", 32),
    ownerId: boundedText(value.ownerId, "semantic index owner id", 160),
    spaceId: value.spaceId == null ? null : boundedText(value.spaceId, "semantic index Space", 160),
    projectId: value.projectId == null ? null : boundedText(value.projectId, "semantic index project", 160),
    embeddingModelId: boundedText(value.embeddingModelId, "embedding model id", 160),
    embeddingArtifactSha256: value.embeddingArtifactSha256,
    dimensions: positiveInteger(value.dimensions, "embedding dimensions", 65536),
    distance: ["cosine", "dot", "l2"].includes(value.distance) ? value.distance : (() => {
      throw new TypeError("semantic index distance is unsupported");
    })(),
    rebuildable: value.rebuildable === true,
    sourceOfTruth: value.sourceOfTruth === false ? false : true,
  });
}

export function defineSemanticIndexRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Semantic index record must be an object");
  }
  const contentSha256 = value.contentSha256;
  if (typeof contentSha256 !== "string" || !SHA256_RE.test(contentSha256)) {
    throw new TypeError("Semantic index record content sha256 is invalid");
  }
  const vector = value.vector;
  if (!Array.isArray(vector) || vector.length === 0 || vector.length > 65536) {
    throw new TypeError("Semantic index record vector is outside bounds");
  }
  const normalized = vector.map((number) => {
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw new TypeError("Semantic index vector contains a non-finite value");
    }
    return number;
  });
  return Object.freeze({
    schema: SEMANTIC_INDEX_RECORD_SCHEMA,
    indexId: id(value.indexId, "semantic index record index id"),
    sourceKind: boundedText(value.sourceKind, "semantic index source kind", 48),
    sourceId: id(value.sourceId, "semantic index source id"),
    contentSha256,
    sourceTimestamp: boundedText(value.sourceTimestamp, "semantic index source timestamp", 64),
    vector: Object.freeze(normalized),
  });
}

export function semanticRecordIsCurrent(recordValue, source) {
  const record = defineSemanticIndexRecord(recordValue);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Semantic index source is required");
  }
  return (
    record.sourceKind === source.sourceKind
    && record.sourceId === source.sourceId
    && record.contentSha256 === source.contentSha256
  );
}

export function semanticIndexNeedsRebuild(indexValue, runtime) {
  const index = defineSemanticIndexDescriptor(indexValue);
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError("Semantic index runtime identity is required");
  }
  return (
    index.embeddingModelId !== runtime.embeddingModelId
    || index.embeddingArtifactSha256 !== runtime.embeddingArtifactSha256
    || index.dimensions !== runtime.dimensions
    || index.distance !== runtime.distance
  );
}

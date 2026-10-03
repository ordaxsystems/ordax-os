export const MEMORY_STORAGE_MANIFEST_SCHEMA = "ordax.memory-storage-manifest/1";
export const MEMORY_CANONICAL_ITEM_SCHEMA = "ordax.memory/1";
export const MEMORY_DERIVED_INDEX_SCHEMA = "ordax.memory-derived-index/1";
export const MEMORY_BASELINE_STORAGE_FORMAT = 1;

const OWNER_KINDS = new Set(["device", "account"]);
const INDEX_STATES = new Set(["absent", "ready", "stale", "rebuilding"]);

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim() || value.length > max || value.includes("\0")) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function integer(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) throw new TypeError(`${label} is invalid`);
  return value;
}

function owner(ownerKind, ownerId) {
  if (!OWNER_KINDS.has(ownerKind)) throw new TypeError("Memory storage owner kind is invalid");
  if (ownerKind === "device") {
    if (ownerId !== null) throw new TypeError("Device memory storage must not use a synthetic owner id");
    return { ownerKind, ownerId: null };
  }
  return { ownerKind, ownerId: text(ownerId, "Memory storage owner id", 160) };
}

function validateIndex(value, canonicalGeneration) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory derived index descriptor must be an object");
  }
  if (!INDEX_STATES.has(value.state)) throw new TypeError("Memory derived index state is invalid");
  const generation = integer(value.generation, "Memory derived index generation");
  const sourceGeneration = integer(value.sourceGeneration, "Memory derived index source generation");
  if (sourceGeneration > canonicalGeneration) {
    throw new TypeError("Memory derived index cannot be newer than canonical memory");
  }
  if (value.state === "ready" && sourceGeneration !== canonicalGeneration) {
    throw new TypeError("Ready memory derived index must match canonical generation");
  }
  return Object.freeze({
    schema: MEMORY_DERIVED_INDEX_SCHEMA,
    state: value.state,
    generation,
    sourceGeneration,
    modelId: value.modelId === null ? null : text(value.modelId, "Memory derived index model id", 240),
  });
}

export function createMemoryStorageManifest({ ownerKind, ownerId = null, storageFormat = MEMORY_BASELINE_STORAGE_FORMAT } = {}) {
  const normalizedOwner = owner(ownerKind, ownerId);
  return Object.freeze({
    $schema: MEMORY_STORAGE_MANIFEST_SCHEMA,
    ...normalizedOwner,
    canonicalItemSchema: MEMORY_CANONICAL_ITEM_SCHEMA,
    storageFormat: integer(storageFormat, "Memory storage format", { min: 1 }),
    canonicalGeneration: 0,
    index: Object.freeze({
      schema: MEMORY_DERIVED_INDEX_SCHEMA,
      state: "absent",
      generation: 0,
      sourceGeneration: 0,
      modelId: null,
    }),
  });
}

export function validateMemoryStorageManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Memory storage manifest must be an object");
  }
  if (value.$schema !== MEMORY_STORAGE_MANIFEST_SCHEMA) throw new TypeError("Memory storage manifest schema is invalid");
  if (value.canonicalItemSchema !== MEMORY_CANONICAL_ITEM_SCHEMA) {
    throw new TypeError("Memory canonical item schema is incompatible");
  }
  const normalizedOwner = owner(value.ownerKind, value.ownerId ?? null);
  const storageFormat = integer(value.storageFormat, "Memory storage format", { min: 1 });
  const canonicalGeneration = integer(value.canonicalGeneration, "Memory canonical generation");
  return Object.freeze({
    $schema: MEMORY_STORAGE_MANIFEST_SCHEMA,
    ...normalizedOwner,
    canonicalItemSchema: MEMORY_CANONICAL_ITEM_SCHEMA,
    storageFormat,
    canonicalGeneration,
    index: validateIndex(value.index, canonicalGeneration),
  });
}

export function advanceMemoryCanonicalGeneration(value) {
  const manifest = validateMemoryStorageManifest(value);
  const nextGeneration = manifest.canonicalGeneration + 1;
  return Object.freeze({
    ...manifest,
    canonicalGeneration: nextGeneration,
    index: Object.freeze({
      ...manifest.index,
      state: manifest.index.state === "absent" ? "absent" : "stale",
    }),
  });
}

export function markMemoryIndexReady(value, { modelId, generation } = {}) {
  const manifest = validateMemoryStorageManifest(value);
  return Object.freeze({
    ...manifest,
    index: Object.freeze({
      schema: MEMORY_DERIVED_INDEX_SCHEMA,
      state: "ready",
      generation: integer(generation, "Memory derived index generation", { min: 1 }),
      sourceGeneration: manifest.canonicalGeneration,
      modelId: text(modelId, "Memory derived index model id", 240),
    }),
  });
}

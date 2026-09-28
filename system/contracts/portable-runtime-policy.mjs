export const PORTABLE_RUNTIME_POLICY_SCHEMA = "ordax.portable-runtime-policy/1";

const MEDIA_CLASSES = new Set(["unknown", "removable-flash", "external-ssd"]);
const CACHE_CLASSES = new Set(["ephemeral", "rebuildable", "durable"]);

function boundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function boundedRatio(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new TypeError(`${label} must be a ratio in (0, 1]`);
  }
  return value;
}

export function definePortableRuntimePolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Portable runtime policy must be an object");
  }
  if (!MEDIA_CLASSES.has(value.mediaClass)) {
    throw new TypeError("Portable runtime media class is unsupported");
  }
  return Object.freeze({
    schema: PORTABLE_RUNTIME_POLICY_SCHEMA,
    mediaClass: value.mediaClass,
    volatileCacheRatio: boundedRatio(value.volatileCacheRatio, "volatileCacheRatio"),
    volatileCacheMinBytes: boundedInteger(value.volatileCacheMinBytes, "volatileCacheMinBytes", 0, 1024 ** 3),
    volatileCacheMaxBytes: boundedInteger(value.volatileCacheMaxBytes, "volatileCacheMaxBytes", 1, 4 * 1024 ** 3),
    preserveAvailableMemoryBytes: boundedInteger(
      value.preserveAvailableMemoryBytes,
      "preserveAvailableMemoryBytes",
      0,
      8 * 1024 ** 3,
    ),
    persistentWriteBatchMs: boundedInteger(value.persistentWriteBatchMs, "persistentWriteBatchMs", 0, 60000),
    zram: Object.freeze({
      allowed: value.zram?.allowed === true,
      backingWritebackAllowed: value.zram?.backingWritebackAllowed === true,
      maxMemoryRatio: boundedRatio(value.zram?.maxMemoryRatio ?? 0.25, "zram.maxMemoryRatio"),
    }),
    cachePolicy: Object.freeze({
      ephemeral: "memory-first",
      rebuildable: "memory-first-persist-batched",
      durable: "atomic-persistent",
    }),
  });
}

export function planPortableRuntimeResources(policyValue, metrics) {
  const policy = definePortableRuntimePolicy(policyValue);
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new TypeError("Portable runtime metrics are required");
  }
  const available = boundedInteger(metrics.memoryAvailableBytes, "memoryAvailableBytes", 0, Number.MAX_SAFE_INTEGER);
  const freeStorage = boundedInteger(metrics.userStorageFreeBytes, "userStorageFreeBytes", 0, Number.MAX_SAFE_INTEGER);

  const afterReserve = Math.max(0, available - policy.preserveAvailableMemoryBytes);
  const proportional = Math.floor(afterReserve * policy.volatileCacheRatio);
  const cacheBytes = Math.min(
    policy.volatileCacheMaxBytes,
    Math.max(policy.volatileCacheMinBytes, proportional),
    afterReserve,
  );

  return Object.freeze({
    schema: PORTABLE_RUNTIME_POLICY_SCHEMA,
    mediaClass: policy.mediaClass,
    volatileCacheBytes: cacheBytes,
    persistentWriteBatchMs: policy.persistentWriteBatchMs,
    zramEligible: policy.zram.allowed && afterReserve > 0,
    zramBackingWritebackAllowed: policy.zram.backingWritebackAllowed,
    lowStorage: freeStorage === 0,
    semanticIndexPersistence: "derived-batched",
    logs: "bounded-volatile-first",
  });
}

export function classifyPortableState(kind) {
  if (!CACHE_CLASSES.has(kind)) {
    throw new TypeError("Portable state class is unsupported");
  }
  return Object.freeze({
    kind,
    persistent: kind === "durable",
    rebuildable: kind === "rebuildable",
    volatilePreferred: kind !== "durable",
  });
}

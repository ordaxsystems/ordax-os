import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";

export const VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA =
  "ordax.verified-app-store-catalog-watermark-store/1";
export const VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA =
  "ordax.verified-app-store-catalog-watermark/1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_CAS_ATTEMPTS = 3;

function validateWatermark(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Verified Store catalog watermark must be an object or null");
  }
  const keys = Object.keys(value).sort();
  const expected = ["catalogSha256", "schema", "sequence"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError("Verified Store catalog watermark fields are not canonical");
  }
  if (value.schema !== VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA) {
    throw new TypeError("Unsupported verified Store catalog watermark schema");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
    throw new TypeError("Verified Store catalog watermark sequence is invalid");
  }
  if (typeof value.catalogSha256 !== "string" || !SHA256_RE.test(value.catalogSha256)) {
    throw new TypeError("Verified Store catalog watermark digest is invalid");
  }
  return Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
    sequence: value.sequence,
    catalogSha256: value.catalogSha256,
  });
}

export function assertVerifiedAppStoreCatalogWatermarkStore(store) {
  if (
    !store
    || typeof store !== "object"
    || Array.isArray(store)
    || store.schema !== VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA
    || typeof store.load !== "function"
    || typeof store.compareAndSwap !== "function"
  ) {
    throw new TypeError("A persistent async verified Store catalog watermark store is required");
  }
  return store;
}

function unavailable(reason) {
  return Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: Object.freeze([]),
    reason,
    authority: "none",
  });
}

function compareSnapshotToWatermark(snapshot, watermark) {
  if (watermark === null) return "advance";
  if (snapshot.sequence < watermark.sequence) return "rollback";
  if (snapshot.sequence > watermark.sequence) return "advance";
  return snapshot.catalogSha256 === watermark.catalogSha256
    ? "same"
    : "equivocation";
}

async function persistAcceptedWatermark(snapshot, store) {
  const next = Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
    sequence: snapshot.sequence,
    catalogSha256: snapshot.catalogSha256,
  });

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    let watermark;
    try {
      watermark = validateWatermark(await store.load());
    } catch {
      return unavailable("catalog-watermark-unavailable");
    }

    const relation = compareSnapshotToWatermark(snapshot, watermark);
    if (relation === "rollback") return unavailable("catalog-sequence-rollback");
    if (relation === "equivocation") return unavailable("catalog-sequence-equivocation");
    if (relation === "same") return snapshot;

    try {
      if (await store.compareAndSwap(watermark, next) === true) {
        return snapshot;
      }
    } catch {
      return unavailable("catalog-watermark-persistence-failed");
    }
  }

  return unavailable("catalog-watermark-race");
}

export function createVerifiedAppStoreCatalogReplayGuard({
  sourcePort,
  watermarkStore,
} = {}) {
  const source = assertVerifiedAppStoreCatalogPort(sourcePort);
  const store = assertVerifiedAppStoreCatalogWatermarkStore(watermarkStore);
  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let current = unavailable("catalog-watermark-uninitialized");

  const evaluate = async () => {
    let snapshot;
    try {
      snapshot = validateVerifiedAppStoreCatalogSnapshot(source.getSnapshot());
    } catch {
      return unavailable("verified-catalog-source-invalid");
    }
    if (snapshot.state !== "ready") return snapshot;
    return persistAcceptedWatermark(snapshot, store);
  };

  const refresh = async () => {
    const requestedGeneration = ++generation;
    const next = await evaluate();
    if (destroyed || requestedGeneration !== generation) return current;
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (changed) {
      for (const listener of [...listeners]) listener(current);
    }
    return current;
  };

  const unsubscribe = source.subscribe(() => {
    if (!destroyed) void refresh();
  });

  const port = Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Verified Store catalog listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  return Object.freeze({
    port,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      unsubscribe?.();
      listeners.clear();
    },
  });
}

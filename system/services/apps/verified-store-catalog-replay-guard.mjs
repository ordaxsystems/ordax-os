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
    throw new TypeError("A persistent verified Store catalog watermark store is required");
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

export function createVerifiedAppStoreCatalogReplayGuard({
  sourcePort,
  watermarkStore,
} = {}) {
  const source = assertVerifiedAppStoreCatalogPort(sourcePort);
  const store = assertVerifiedAppStoreCatalogWatermarkStore(watermarkStore);
  const listeners = new Set();
  let destroyed = false;

  const evaluate = () => {
    let snapshot;
    try {
      snapshot = validateVerifiedAppStoreCatalogSnapshot(source.getSnapshot());
    } catch {
      return unavailable("verified-catalog-source-invalid");
    }
    if (snapshot.state !== "ready") return snapshot;

    let watermark;
    try {
      watermark = validateWatermark(store.load());
    } catch {
      return unavailable("catalog-watermark-unavailable");
    }

    if (watermark !== null) {
      if (snapshot.sequence < watermark.sequence) {
        return unavailable("catalog-sequence-rollback");
      }
      if (
        snapshot.sequence === watermark.sequence
        && snapshot.catalogSha256 !== watermark.catalogSha256
      ) {
        return unavailable("catalog-sequence-equivocation");
      }
      if (
        snapshot.sequence === watermark.sequence
        && snapshot.catalogSha256 === watermark.catalogSha256
      ) {
        return snapshot;
      }
    }

    const expected = watermark;
    const next = Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
      sequence: snapshot.sequence,
      catalogSha256: snapshot.catalogSha256,
    });
    try {
      if (store.compareAndSwap(expected, next) !== true) {
        return unavailable("catalog-watermark-race");
      }
    } catch {
      return unavailable("catalog-watermark-persistence-failed");
    }
    return snapshot;
  };

  let current = evaluate();
  const unsubscribe = source.subscribe(() => {
    if (destroyed) return;
    const next = evaluate();
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    current = next;
    if (!changed) return;
    for (const listener of [...listeners]) listener(current);
  });

  const port = {
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
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      listeners.clear();
    },
  };

  return Object.freeze(port);
}

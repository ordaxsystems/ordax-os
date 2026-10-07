import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";

const STORE_CATALOG_ENDPOINT = "/__ordax/native/store-catalog";
const REQUEST_OPTIONS = Object.freeze({
  method: "GET",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});

function unavailable(reason) {
  return validateVerifiedAppStoreCatalogSnapshot({
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    sequence: null,
    catalogSha256: null,
    source: null,
    trust: null,
    entries: [],
    reason,
    authority: "none",
  });
}

async function readSnapshot(windowRef) {
  const response = await windowRef.fetch(STORE_CATALOG_ENDPOINT, REQUEST_OPTIONS);
  if (!response || typeof response.ok !== "boolean") {
    throw new TypeError("Native verified Store catalog response is invalid");
  }
  if (!response.ok) {
    throw new Error(`Native verified Store catalog unavailable: HTTP ${response.status}`);
  }
  if (typeof response.json !== "function") {
    throw new TypeError("Native verified Store catalog response must implement json()");
  }
  return validateVerifiedAppStoreCatalogSnapshot(await response.json());
}

export async function createNativeVerifiedAppStoreCatalog(
  windowRef = globalThis.window,
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native verified Store catalog requires window.fetch");
  }

  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let snapshot = unavailable("native-store-catalog-loading");

  const emit = (next) => {
    snapshot = validateVerifiedAppStoreCatalogSnapshot(next);
    for (const listener of [...listeners]) listener(snapshot);
  };

  const refresh = async () => {
    const requestGeneration = ++generation;
    let next;
    try {
      next = await readSnapshot(windowRef);
    } catch {
      next = unavailable("native-store-catalog-unavailable");
    }
    if (destroyed || requestGeneration !== generation) return snapshot;
    emit(next);
    return snapshot;
  };

  const port = Object.freeze({
    schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Native verified Store catalog listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  assertVerifiedAppStoreCatalogPort(port);
  await refresh();

  return Object.freeze({
    port,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      listeners.clear();
    },
  });
}

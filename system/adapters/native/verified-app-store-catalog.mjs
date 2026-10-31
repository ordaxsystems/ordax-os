import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";

const STORE_CATALOG_ENDPOINT = "/__ordax/native/store-catalog";
const DEFAULT_CATALOG_TIMEOUT_MS = 5_000;
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

async function readSnapshot(windowRef, signal) {
  const response = await windowRef.fetch(STORE_CATALOG_ENDPOINT, {
    ...REQUEST_OPTIONS,
    signal,
  });
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
  { timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native verified Store catalog requires window.fetch");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError("Native verified Store catalog timeout must be a bounded positive integer");
  }

  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let snapshot = unavailable("native-store-catalog-loading");
  let activeRead = null;

  const emit = (next) => {
    snapshot = validateVerifiedAppStoreCatalogSnapshot(next);
    for (const listener of [...listeners]) listener(snapshot);
  };

  const refresh = async () => {
    if (destroyed) return snapshot;
    const requestGeneration = ++generation;
    // Superseded reads must settle even when Native fetch ignores abort.
    activeRead?.cancel();
    const controller = new AbortController();
    let rejectCancelled;
    let cancelled = false;
    const cancelledRead = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      rejectCancelled(new Error("Native verified Store catalog read cancelled"));
    };
    activeRead = { cancel };
    const deadline = setTimeout(cancel, timeoutMs);
    // A prior signed snapshot is not an authorization for a new observation.
    // Revoke it before awaiting Native verification, so the derived Store
    // projection clears lifecycle actions during a slow or failed refresh.
    if (snapshot.state === "ready") {
      emit(unavailable("native-store-catalog-refreshing"));
    }
    let next;
    try {
      next = await Promise.race([
        readSnapshot(windowRef, controller.signal),
        cancelledRead,
      ]);
    } catch {
      next = unavailable("native-store-catalog-unavailable");
    } finally {
      clearTimeout(deadline);
      if (activeRead?.cancel === cancel) activeRead = null;
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
      activeRead?.cancel();
      // A disposed verifier must not continue exposing trusted candidates to
      // a retained read-only port or its subscribers.
      snapshot = unavailable("native-store-catalog-disposed");
      for (const listener of [...listeners]) listener(snapshot);
      listeners.clear();
    },
  });
}

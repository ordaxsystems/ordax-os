import {
  APP_STORE_CATALOG_PORT_SCHEMA,
  APP_STORE_CATALOG_SCHEMA,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  componentVersionIsNewer,
} from "../../contracts/component-manifest.mjs";
import {
  validateComponentRuntimeMetadata,
} from "../../contracts/component-runtime-metadata.mjs";
import {
  assertVerifiedAppStoreCatalogPort,
  validateVerifiedAppStoreCatalogSnapshot,
} from "../../contracts/verified-app-store-catalog.mjs";
import {
  assertVerifiedComponentPackageSource,
} from "../../contracts/verified-component-package-source.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
} from "./delivery-policy.mjs";
import {
  listExternalFirstPartyComponentIds,
  hasNativeExternalFirstPartyModuleRead,
} from "./external-first-party-policy.mjs";

const REQUEST_OPTIONS = Object.freeze({
  method: "GET",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});

function unavailable(reason) {
  return validateAppStoreCatalogSnapshot({
    schema: APP_STORE_CATALOG_SCHEMA,
    state: "unavailable",
    entries: [],
    reason,
    authority: "none",
  });
}

function candidateFlags(candidate) {
  return candidate === null
    ? { artifactIdentityVerified: false, provenanceVerified: false }
    : { artifactIdentityVerified: true, provenanceVerified: true };
}

function blockedEntry({
  appId,
  title,
  installedVersion = null,
  candidate = null,
  reason,
  removable = false,
}) {
  let availableVersion = candidate?.version ?? null;
  let flags = candidateFlags(candidate);
  if (
    installedVersion !== null
    && availableVersion !== null
    && !componentVersionIsNewer(availableVersion, installedVersion)
  ) {
    availableVersion = null;
    flags = candidateFlags(null);
  }
  return {
    appId,
    title,
    state: "blocked",
    installedVersion,
    availableVersion,
    installable: false,
    updatable: false,
    removable: installedVersion !== null && removable,
    blockedReason: reason,
    ...flags,
  };
}

function projectEntry({ appId, candidate, current, policy }) {
  const title = candidate?.title ?? appId;

  if (current.source === "bundled") {
    return blockedEntry({
      appId,
      title,
      candidate,
      reason: "component-slot-bundled-source-conflict",
    });
  }

  // Explicit removal is absent from activation but remains manually reinstallable
  // through the SAME signed Store lifecycle; the first-run owner must use the
  // canonical Native removal marker to exclude automatic installation.
  if (current.source === "absent" || current.source === "removed") {
    if (candidate === null) return null;
    if (policy.deliveryClass === "structural") {
      return blockedEntry({
        appId,
        title,
        candidate,
        reason: "structural-app-cannot-use-store-lifecycle",
      });
    }
    if (!hasNativeExternalFirstPartyModuleRead(appId)) {
      return blockedEntry({
        appId, title, candidate,
        reason: "runtime-module-read-unavailable",
      });
    }
    return {
      appId,
      title,
      state: "available",
      installedVersion: null,
      availableVersion: candidate.version,
      installable: true,
      updatable: false,
      removable: false,
      blockedReason: null,
      ...candidateFlags(candidate),
    };
  }

  const installedVersion = current.version;
  if (candidate === null) {
    return {
      appId,
      title,
      state: "installed",
      installedVersion,
      availableVersion: null,
      installable: false,
      updatable: false,
      removable: policy.removable,
      blockedReason: null,
      ...candidateFlags(null),
    };
  }

  if (
    candidate.version === installedVersion
    && candidate.sourceCommit === current.sourceCommit
  ) {
    return {
      appId,
      title,
      state: "installed",
      installedVersion,
      availableVersion: null,
      installable: false,
      updatable: false,
      removable: policy.removable,
      blockedReason: null,
      ...candidateFlags(null),
    };
  }

  if (componentVersionIsNewer(candidate.version, installedVersion)) {
    if (!hasNativeExternalFirstPartyModuleRead(appId)) {
      return blockedEntry({
        appId, title, installedVersion, candidate,
        reason: "runtime-module-read-unavailable",
        removable: policy.removable,
      });
    }
    return {
      appId,
      title,
      state: "installed",
      installedVersion,
      availableVersion: candidate.version,
      installable: false,
      updatable: true,
      removable: policy.removable,
      blockedReason: null,
      ...candidateFlags(candidate),
    };
  }

  return blockedEntry({
    appId,
    title,
    installedVersion,
    candidate,
    reason: candidate.version === installedVersion
      ? "installed-catalog-identity-drift"
      : "verified-catalog-older-than-installed",
    removable: policy.removable,
  });
}

async function readJson(response, label) {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new TypeError(`${label} response is invalid`);
  }
  if (!response.ok) {
    throw new Error(`${label} unavailable: HTTP ${response.status}`);
  }
  if (typeof response.json !== "function") {
    throw new TypeError(`${label} response must implement json()`);
  }
  return response.json();
}

// Independent Native reads must not serialize the whole Store or create an
// unbounded request fan-out as the first-party inventory grows.
const MAX_CONCURRENT_METADATA_READS = 4;
const DEFAULT_METADATA_TIMEOUT_MS = 5_000;

async function mapInSourceOrder(values, readOne, signal) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_METADATA_READS, values.length) },
    async () => {
      while (cursor < values.length && !signal.aborted) {
        const index = cursor++;
        results[index] = await readOne(values[index]);
      }
    },
  ));
  return results;
}

async function readCurrentWithinDeadline({
  fetchImpl, metadataUrl, appId, signal, timeoutMs,
}) {
  if (signal.aborted) throw new Error("Store refresh superseded");
  const controller = new AbortController();
  let rejectCancelled;
  let cancelled = false;
  const cancelledPromise = new Promise((_, reject) => {
    rejectCancelled = reject;
  });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    rejectCancelled(new Error("Native current activation metadata unavailable"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, timeoutMs);
  try {
    const pending = (async () => readJson(
      await fetchImpl(metadataUrl, {
        ...REQUEST_OPTIONS,
        signal: controller.signal,
      }),
      "Current activation metadata for " + appId,
    ))();
    return await Promise.race([pending, cancelledPromise]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

export function createVerifiedAppStoreProjection({
  verifiedCatalogPort,
  componentSource,
  fetchImpl = globalThis.fetch,
  metadataTimeoutMs = DEFAULT_METADATA_TIMEOUT_MS,
} = {}) {
  const catalog = assertVerifiedAppStoreCatalogPort(verifiedCatalogPort);
  const source = assertVerifiedComponentPackageSource(componentSource);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified Store projection requires fetchImpl()");
  }
  if (!Number.isInteger(metadataTimeoutMs) || metadataTimeoutMs < 1 || metadataTimeoutMs > 30_000) {
    throw new TypeError("Native current metadata timeout must be a bounded positive integer");
  }

  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let snapshot = unavailable("verified-store-projection-loading");

  const emit = (next) => {
    snapshot = validateAppStoreCatalogSnapshot(next);
    for (const listener of [...listeners]) listener(snapshot);
  };

  let activeRefresh = null;

  const build = async (signal) => {
    const verified = validateVerifiedAppStoreCatalogSnapshot(catalog.getSnapshot());
    if (verified.state !== "ready") {
      return unavailable(verified.reason ?? "verified-catalog-unavailable");
    }

    const candidates = new Map(verified.entries.map((entry) => [entry.appId, entry]));
    const appIds = [...new Set([
      ...listExternalFirstPartyComponentIds(),
      ...verified.entries.map((entry) => entry.appId),
    ])].sort();

    const resolved = await mapInSourceOrder(appIds, async (appId) => {
      if (signal.aborted) return null;
      const candidate = candidates.get(appId) ?? null;
      const policy = getFirstPartyAppDeliveryPolicy(appId);
      if (policy === null) {
        return candidate === null ? null : blockedEntry({
          appId,
          title: candidate.title,
          candidate,
          reason: "first-party-delivery-policy-unavailable",
        });
      }

      let current;
      try {
        const metadataUrl = source.metadataUrl(appId, "current");
        const raw = await readCurrentWithinDeadline({
          fetchImpl, metadataUrl, appId, signal,
          timeoutMs: metadataTimeoutMs,
        });
        current = validateComponentRuntimeMetadata(raw, {
          componentId: appId,
          state: "current",
        });
      } catch {
        if (signal.aborted || candidate === null) return null;
        return blockedEntry({
          appId,
          title: candidate.title,
          candidate,
          reason: "activation-state-unavailable",
        });
      }
      if (signal.aborted) return null;
      return projectEntry({ appId, candidate, current, policy });
    }, signal);

    if (signal.aborted) {
      return unavailable("verified-store-projection-superseded");
    }
    return validateAppStoreCatalogSnapshot({
      schema: APP_STORE_CATALOG_SCHEMA,
      state: "ready",
      entries: resolved.filter((entry) => entry !== null && entry !== undefined),
      reason: null,
      authority: "none",
    });
  };

  const refresh = async () => {
    if (destroyed) return snapshot;
    activeRefresh?.abort();
    const controller = new AbortController();
    activeRefresh = controller;
    const requestGeneration = ++generation;
    // Revoke any stale install/update buttons synchronously before current
    // activation metadata is fetched from the Native host.
    if (snapshot.state === "ready") {
      emit(unavailable("verified-store-projection-refreshing"));
    }
    let next;
    try {
      next = await build(controller.signal);
    } catch {
      next = unavailable("verified-store-projection-unavailable");
    }
    if (destroyed || requestGeneration !== generation) return snapshot;
    if (activeRefresh === controller) activeRefresh = null;
    emit(next);
    return snapshot;
  };

  const unsubscribeCatalog = catalog.subscribe(() => {
    void refresh();
  });

  const port = Object.freeze({
    schema: APP_STORE_CATALOG_PORT_SCHEMA,
    authority: "none",
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Verified Store projection listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  void refresh();

  return Object.freeze({
    port,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      activeRefresh?.abort();
      activeRefresh = null;
      unsubscribeCatalog?.();
      listeners.clear();
    },
  });
}

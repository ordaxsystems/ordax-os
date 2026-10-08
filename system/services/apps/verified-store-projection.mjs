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

  if (current.source === "absent") {
    if (candidate === null) return null;
    if (policy.deliveryClass === "structural") {
      return blockedEntry({
        appId,
        title,
        candidate,
        reason: "structural-app-cannot-use-store-lifecycle",
      });
    }
    // A verified package does not imply the Native host can read its runtime.
    // Derive this capability from the same generated SSOT as the lifecycle gate.
    if (!hasNativeExternalFirstPartyModuleRead(appId)) {
      return blockedEntry({
        appId,
        title,
        candidate,
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
    // Installed state is still canonical and uninstall may remain valid,
    // even if the host cannot load the newer candidate.
    if (!hasNativeExternalFirstPartyModuleRead(appId)) {
      return blockedEntry({
        appId,
        title,
        installedVersion,
        candidate,
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

export function createVerifiedAppStoreProjection({
  verifiedCatalogPort,
  componentSource,
  fetchImpl = globalThis.fetch,
} = {}) {
  const catalog = assertVerifiedAppStoreCatalogPort(verifiedCatalogPort);
  const source = assertVerifiedComponentPackageSource(componentSource);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified Store projection requires fetchImpl()");
  }

  const listeners = new Set();
  let destroyed = false;
  let generation = 0;
  let snapshot = unavailable("verified-store-projection-loading");

  const emit = (next) => {
    snapshot = validateAppStoreCatalogSnapshot(next);
    for (const listener of [...listeners]) listener(snapshot);
  };

  const build = async () => {
    const verified = validateVerifiedAppStoreCatalogSnapshot(catalog.getSnapshot());
    if (verified.state !== "ready") {
      return unavailable(verified.reason ?? "verified-catalog-unavailable");
    }

    const candidates = new Map(verified.entries.map((entry) => [entry.appId, entry]));
    const appIds = [...new Set([
      ...listExternalFirstPartyComponentIds(),
      ...verified.entries.map((entry) => entry.appId),
    ])].sort();

    const entries = [];
    for (const appId of appIds) {
      const candidate = candidates.get(appId) ?? null;
      const policy = getFirstPartyAppDeliveryPolicy(appId);
      if (policy === null) {
        if (candidate !== null) {
          entries.push(blockedEntry({
            appId,
            title: candidate.title,
            candidate,
            reason: "first-party-delivery-policy-unavailable",
          }));
        }
        continue;
      }

      let current;
      try {
        const metadataUrl = source.metadataUrl(appId, "current");
        const raw = await readJson(
          await fetchImpl(metadataUrl, REQUEST_OPTIONS),
          `Current activation metadata for ${appId}`,
        );
        current = validateComponentRuntimeMetadata(raw, {
          componentId: appId,
          state: "current",
        });
      } catch {
        if (candidate !== null) {
          entries.push(blockedEntry({
            appId,
            title: candidate.title,
            candidate,
            reason: "activation-state-unavailable",
          }));
        }
        continue;
      }

      const entry = projectEntry({ appId, candidate, current, policy });
      if (entry !== null) entries.push(entry);
    }

    return validateAppStoreCatalogSnapshot({
      schema: APP_STORE_CATALOG_SCHEMA,
      state: "ready",
      entries,
      reason: null,
      authority: "none",
    });
  };

  const refresh = async () => {
    const requestGeneration = ++generation;
    let next;
    try {
      next = await build();
    } catch {
      next = unavailable("verified-store-projection-unavailable");
    }
    if (destroyed || requestGeneration !== generation) return snapshot;
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
      unsubscribeCatalog?.();
      listeners.clear();
    },
  });
}

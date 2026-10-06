import {
  APP_INTELLIGENCE_CATALOG_PORT_SCHEMA,
  APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
  createEmptyAppIntelligenceCatalogSnapshot,
  validateAppIntelligenceCatalogSnapshot,
} from "../../contracts/app-intelligence-catalog.mjs";

function manifestIdentity(snapshot) {
  return JSON.stringify(snapshot.manifests);
}

export function createAppIntelligenceCatalogRegistry({ manifests = [] } = {}) {
  const listeners = new Set();
  let disposed = false;
  let snapshot = manifests.length === 0
    ? createEmptyAppIntelligenceCatalogSnapshot()
    : validateAppIntelligenceCatalogSnapshot({
        schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
        revision: 0,
        manifests,
        authority: "none",
        execution: "declarative-only",
      });

  const port = Object.freeze({
    schema: APP_INTELLIGENCE_CATALOG_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("App intelligence catalog listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  const publish = (next) => {
    if (disposed) throw new Error("App intelligence catalog registry is disposed");
    if (manifestIdentity(next) === manifestIdentity(snapshot)) return snapshot;
    snapshot = validateAppIntelligenceCatalogSnapshot({
      schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
      revision: snapshot.revision + 1,
      manifests: next.manifests,
      authority: "none",
      execution: "declarative-only",
    });
    for (const listener of [...listeners]) listener(snapshot);
    return snapshot;
  };

  return Object.freeze({
    port,
    replaceVerifiedManifests(manifestsValue) {
      const validated = validateAppIntelligenceCatalogSnapshot({
        schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
        revision: snapshot.revision,
        manifests: manifestsValue,
        authority: "none",
        execution: "declarative-only",
      });
      return publish(validated);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  });
}

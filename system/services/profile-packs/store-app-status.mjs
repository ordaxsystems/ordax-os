import { validateProfileAppReferences } from "../../contracts/profile-app-references.mjs";
import { validateAppStoreCatalogSnapshot } from "../../contracts/app-store.mjs";

// Pure read-only join. The Store is the sole authority for installation,
// availability and updates; Profile Packs only reference stable app IDs.
export function projectProfileStoreAppStatus({ apps, storeSnapshot } = {}) {
  const references = validateProfileAppReferences(apps);
  const store = validateAppStoreCatalogSnapshot(storeSnapshot);
  if (store.state !== "ready") {
    return Object.freeze({
      state: "unavailable",
      reason: store.reason,
      entries: Object.freeze(references.map((appId) => Object.freeze({
        appId, status: "unknown", installedVersion: null,
        availableVersion: null, blockedReason: null,
      }))),
    });
  }
  const byId = new Map(store.entries.map((entry) => [entry.appId, entry]));
  return Object.freeze({
    state: "ready",
    reason: null,
    entries: Object.freeze(references.map((appId) => {
      const entry = byId.get(appId);
      if (!entry) {
        return Object.freeze({
          appId, status: "not-listed", installedVersion: null,
          availableVersion: null, blockedReason: null,
        });
      }
      const status = entry.state === "blocked" ? "blocked"
        : entry.state === "failed-retained" ? "failed-retained"
        : ["installing", "updating", "removing", "staged"].includes(entry.state) ? "in-progress"
        : entry.installedVersion !== null ? (entry.updatable ? "update-available" : "installed")
        : entry.installable ? "available" : "unavailable";
      return Object.freeze({
        appId, status, installedVersion: entry.installedVersion,
        availableVersion: entry.availableVersion, blockedReason: entry.blockedReason,
      });
    })),
  });
}

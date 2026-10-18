import { validateSpace } from "../../contracts/spaces.mjs";
import { validateProfilePackCatalogList } from "../../contracts/profile-pack-catalog.mjs";
import { projectProfileStoreAppStatus } from "../profile-packs/store-app-status.mjs";

const EMPTY = Object.freeze([]);

// This is a presentation join only, not a per-Space installation inventory.
// The Account owns selected Space/profilePack; Profile owns references;
// the Store owns device/runtime installation observations.
/**
 * @param {{
 *   space?: ReturnType<typeof import("../../contracts/spaces.mjs").validateSpace> | null;
 *   profileEntries?: ReturnType<typeof import("../../contracts/profile-pack-catalog.mjs").validateProfilePackCatalogList>;
 *   storeSnapshot?: ReturnType<typeof import("../../contracts/app-store.mjs").validateAppStoreCatalogSnapshot>;
 * }} [input]
 */
export function projectSelectedSpaceProfileStoreApps({ space = null, profileEntries, storeSnapshot } = {}) {
  if (space === null) return Object.freeze({ state: "no-selection", profileTitle: null, storeState: null, entries: EMPTY });
  const selected = validateSpace(space);
  if (selected.state !== "active") {
    return Object.freeze({ state: "unavailable", profileTitle: null, storeState: null, entries: EMPTY });
  }
  if (selected.profilePack === null) {
    return Object.freeze({ state: "no-profile", profileTitle: null, storeState: null, entries: EMPTY });
  }

  // Exact immutable slug@version only. No latest/alias/type fallback is allowed.
  const identity = /^([a-z0-9][a-z0-9-]{1,79})@([1-9][0-9]*)$/.exec(selected.profilePack);
  if (!identity) return Object.freeze({ state: "profile-unavailable", profileTitle: null, storeState: null, entries: EMPTY });
  const version = Number(identity[2]);
  if (!Number.isSafeInteger(version) || String(version) !== identity[2]) {
    return Object.freeze({ state: "profile-unavailable", profileTitle: null, storeState: null, entries: EMPTY });
  }
  const entries = validateProfilePackCatalogList(profileEntries);
  const profile = entries.find(entry => entry.slug === identity[1] && entry.version === version && entry.spaceKind === selected.kind);
  if (!profile) return Object.freeze({ state: "profile-unavailable", profileTitle: null, storeState: null, entries: EMPTY });

  const status = projectProfileStoreAppStatus({ apps: profile.apps, storeSnapshot });
  return Object.freeze({
    state: "ready",
    profileTitle: profile.title,
    storeState: status.state,
    entries: status.entries,
  });
}

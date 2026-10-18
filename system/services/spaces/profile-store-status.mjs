import { validateSpace } from "../../contracts/spaces.mjs";
import { projectProfileStoreAppStatus } from "../profile-packs/store-app-status.mjs";

// Read-only association. A Space carries a Profile slug but not a pinned
// version: never silently choose the latest published version.
export function projectSpaceProfileStoreStatus({ space, profiles, storeSnapshot } = {}) {
  if (space == null) return Object.freeze({ state: "no-space", profile: null, entries: Object.freeze([]) });
  const selected = validateSpace(space);
  if (selected.profilePack === null) return Object.freeze({ state: "no-profile", profile: null, entries: Object.freeze([]) });
  if (!Array.isArray(profiles)) throw new TypeError("Published Profile catalog entries are required");
  const matching = profiles.filter(entry => entry?.slug === selected.profilePack);
  if (matching.length !== 1) {
    return Object.freeze({
      state: matching.length === 0 ? "profile-not-listed" : "profile-ambiguous",
      profile: selected.profilePack,
      entries: Object.freeze([]),
    });
  }
  const profile = matching[0];
  if (!Number.isSafeInteger(profile.version) || profile.version < 1 || !Array.isArray(profile.apps)) {
    throw new TypeError("Published Profile entry is invalid");
  }
  const status = projectProfileStoreAppStatus({ apps: profile.apps, storeSnapshot });
  return Object.freeze({
    state: status.state === "ready" ? "ready" : "store-unavailable",
    profile: selected.profilePack,
    profileVersion: profile.version,
    reason: status.reason,
    entries: status.entries,
  });
}

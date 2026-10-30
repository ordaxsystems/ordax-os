import { validateSpace } from "../../contracts/spaces.mjs";
import { validateProfilePackCatalogList } from "../../contracts/profile-pack-catalog.mjs";
import { projectProfileStoreAppStatus } from "../profile-packs/store-app-status.mjs";

const EMPTY_ENTRIES = Object.freeze([]);
const PROFILE_ID = /^([a-z0-9][a-z0-9-]{1,79})@([1-9][0-9]*)$/;

function unresolved(state, profile) {
  return Object.freeze({ state, profile, entries: EMPTY_ENTRIES });
}

// Space.profilePack already uses the canonical slug@version identity.
// Bare slugs are retained for compatibility, but never implicitly bind a
// published version. The Store alone provides installation state.
export function projectSpaceProfileStoreStatus({ space, profiles, storeSnapshot } = {}) {
  if (space == null) return unresolved("no-space", null);
  const selected = validateSpace(space);
  // An archived Space cannot project live Store observations or Profile contents.
  if (selected.state !== "active") return unresolved("space-inactive", null);
  if (selected.profilePack === null) return unresolved("no-profile", null);

  const binding = selected.profilePack;
  if (!binding.includes("@")) return unresolved("profile-unpinned", binding);
  const match = PROFILE_ID.exec(binding);
  const version = match ? Number(match[2]) : NaN;
  if (!match || !Number.isSafeInteger(version)) return unresolved("profile-invalid-binding", binding);

  const published = validateProfilePackCatalogList(profiles);
  const profile = published.find(entry => entry.slug === match[1] && entry.version === version);
  if (!profile) return unresolved("profile-not-listed", binding);
  if (profile.spaceKind !== selected.kind) return unresolved("profile-kind-mismatch", binding);

  const status = projectProfileStoreAppStatus({ apps: profile.apps, storeSnapshot });
  return Object.freeze({
    state: status.state === "ready" ? "ready" : "store-unavailable",
    profile: binding,
    profileVersion: version,
    reason: status.reason,
    entries: status.entries,
  });
}

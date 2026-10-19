const placements = new Set(["central", "desktop", "dock", "navigation-menu"]);

// One owner for shortcut membership and ordering in the shared Surface shell.
// Placement values are zero-based positions; order may differ by destination.
// App availability remains owned by the runtime catalog and host capabilities.
const entries = [
  { appId: "studio", placements: { central: 0, desktop: 0, dock: 0 } },
  { appId: "files", placements: { central: 1, desktop: 1, dock: 1, "navigation-menu": 0 } },
  { appId: "settings", placements: { central: 2, desktop: 2, dock: 2, "navigation-menu": 2 } },
  { appId: "store", placements: { dock: 3 } },
  { appId: "account", placements: { dock: 4 } },
  { appId: "system", placements: { dock: 5, "navigation-menu": 3 } },
];

const appIds = new Set();
const placementIndexes = new Map([...placements].map((placement) => [placement, new Set()]));
export const SURFACE_SHORTCUT_CATALOG = Object.freeze(entries.map((entry) => {
  if (typeof entry.appId !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.appId)) {
    throw new TypeError("Surface shortcut app id is invalid");
  }
  if (appIds.has(entry.appId)) throw new TypeError(`Duplicate Surface shortcut app id: ${entry.appId}`);
  appIds.add(entry.appId);
  if (!entry.placements || typeof entry.placements !== "object" || Array.isArray(entry.placements)
      || Object.keys(entry.placements).length === 0
      || Object.entries(entry.placements).some(([placement, index]) => {
        if (!placements.has(placement) || !Number.isInteger(index) || index < 0) return true;
        const indexes = placementIndexes.get(placement);
        if (indexes.has(index)) return true;
        indexes.add(index);
        return false;
      })) {
    throw new TypeError(`Surface shortcut placements are invalid for ${entry.appId}`);
  }
  return Object.freeze({
    appId: entry.appId,
    placements: Object.freeze({ ...entry.placements }),
  });
}));

export function listSurfaceShortcutAppIds(placement) {
  if (!placements.has(placement)) throw new TypeError(`Unknown Surface shortcut placement: ${String(placement)}`);
  return Object.freeze(SURFACE_SHORTCUT_CATALOG
    .filter((entry) => Object.hasOwn(entry.placements, placement))
    .sort((left, right) => left.placements[placement] - right.placements[placement])
    .map((entry) => entry.appId));
}

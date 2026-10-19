const placements = new Set(["central", "desktop", "dock"]);

// One ordered owner for shortcuts shown in the shared Surface shell.
// App availability remains owned by the runtime catalog and host capabilities.
const entries = [
  { appId: "studio", placements: ["central", "desktop", "dock"] },
  { appId: "files", placements: ["central", "desktop", "dock"] },
  { appId: "settings", placements: ["central", "desktop", "dock"] },
  { appId: "store", placements: ["dock"] },
  { appId: "account", placements: ["dock"] },
  { appId: "system", placements: ["dock"] },
];

const appIds = new Set();
export const SURFACE_SHORTCUT_CATALOG = Object.freeze(entries.map((entry) => {
  if (typeof entry.appId !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.appId)) {
    throw new TypeError("Surface shortcut app id is invalid");
  }
  if (appIds.has(entry.appId)) throw new TypeError(`Duplicate Surface shortcut app id: ${entry.appId}`);
  appIds.add(entry.appId);
  if (!Array.isArray(entry.placements) || entry.placements.length === 0
      || entry.placements.some((placement) => !placements.has(placement))
      || new Set(entry.placements).size !== entry.placements.length) {
    throw new TypeError(`Surface shortcut placements are invalid for ${entry.appId}`);
  }
  return Object.freeze({
    appId: entry.appId,
    placements: Object.freeze([...entry.placements]),
  });
}));

export function listSurfaceShortcutAppIds(placement) {
  if (!placements.has(placement)) throw new TypeError(`Unknown Surface shortcut placement: ${String(placement)}`);
  return Object.freeze(SURFACE_SHORTCUT_CATALOG
    .filter((entry) => entry.placements.includes(placement))
    .map((entry) => entry.appId));
}

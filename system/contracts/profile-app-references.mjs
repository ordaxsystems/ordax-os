import { validateComponentId } from "./component-manifest.mjs";

// A Profile selects app identities only. Versions, artifacts, installation,
// updates and rollback remain with the canonical OrdaX Store/runtime owner.
export function validateProfileAppReferences(value, label = "Profile app references") {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const seen = new Set();
  const apps = value.map((raw, index) => {
    let appId;
    try {
      appId = validateComponentId(raw);
    } catch {
      throw new TypeError(`${label}[${index}] must be a canonical Store app id`);
    }
    if (seen.has(appId)) {
      throw new TypeError(`${label} contains duplicate app id ${appId}`);
    }
    seen.add(appId);
    return appId;
  });
  return Object.freeze(apps);
}

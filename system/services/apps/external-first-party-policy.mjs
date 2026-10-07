import { validateComponentId } from "../../contracts/component-manifest.mjs";

export const EXTERNAL_FIRST_PARTY_OWNER = "washingtonmsdj/ordax-apps";
export const EXTERNAL_FIRST_PARTY_COMPONENT_IDS = Object.freeze(["notes", "studio"]);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
if (IDS.size !== EXTERNAL_FIRST_PARTY_COMPONENT_IDS.length) {
  throw new TypeError("External first-party component ids must be unique");
}
for (const appId of EXTERNAL_FIRST_PARTY_COMPONENT_IDS) {
  validateComponentId(appId);
}

export function listExternalFirstPartyComponentIds() {
  return EXTERNAL_FIRST_PARTY_COMPONENT_IDS;
}

export function isExternalFirstPartyComponentId(value) {
  try {
    return IDS.has(validateComponentId(value));
  } catch {
    return false;
  }
}

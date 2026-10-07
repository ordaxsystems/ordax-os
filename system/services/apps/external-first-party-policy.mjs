// GENERATED FILE. DO NOT EDIT BY HAND.
// Source of truth: docs/contracts/runtime-component-package.json
// Generator: tools/app-policy/render_external_first_party_policy.py

import { validateComponentId } from "../../contracts/component-manifest.mjs";

export const EXTERNAL_FIRST_PARTY_OWNER = "ordaxsystems/ordax-apps";
export const EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT = Object.freeze({
  "notes": "ordaxsystems/ordax-apps",
  "studio": "ordaxsystems/ordax-apps",
});
export const EXTERNAL_FIRST_PARTY_COMPONENT_IDS = Object.freeze(
  Object.keys(EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT),
);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
if (IDS.size !== EXTERNAL_FIRST_PARTY_COMPONENT_IDS.length) {
  throw new TypeError("External first-party component ids must be unique");
}
for (const appId of EXTERNAL_FIRST_PARTY_COMPONENT_IDS) {
  validateComponentId(appId);
  if (EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT[appId] !== EXTERNAL_FIRST_PARTY_OWNER) {
    throw new TypeError(`External first-party source repository drifted: ${appId}`);
  }
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

// GENERATED FILE. DO NOT EDIT BY HAND.
// Source of truth: docs/contracts/runtime-component-package.json
// Generator: tools/app-policy/render_external_first_party_policy.py

import { validateComponentId } from "../../contracts/component-manifest.mjs";

export const EXTERNAL_FIRST_PARTY_OWNER = "ordaxsystems/ordax-apps";
export const EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT = Object.freeze({
  "calculator": "ordaxsystems/ordax-apps",
  "calendar": "ordaxsystems/ordax-apps",
  "character-map": "ordaxsystems/ordax-apps",
  "clock": "ordaxsystems/ordax-apps",
  "colors": "ordaxsystems/ordax-apps",
  "converter": "ordaxsystems/ordax-apps",
  "image-viewer": "ordaxsystems/ordax-apps",
  "media-player": "ordaxsystems/ordax-apps",
  "notes": "ordaxsystems/ordax-apps",
  "paint": "ordaxsystems/ordax-apps",
  "pdf-viewer": "ordaxsystems/ordax-apps",
  "studio": "ordaxsystems/ordax-apps",
  "text-viewer": "ordaxsystems/ordax-apps",
  "toolbox": "ordaxsystems/ordax-apps",
});
export const EXTERNAL_FIRST_PARTY_COMPONENT_IDS = Object.freeze(
  Object.keys(EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT),
);

// Generated from the same canonical OS package policy's Native module broker
// scope. Store catalog presence alone does not grant executable-read support.
export const EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS = Object.freeze([
  "notes",
  "studio",
]);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
const MODULE_READ_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
if (MODULE_READ_IDS.size !== EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS.length
  || [...MODULE_READ_IDS].some((appId) => !IDS.has(appId))) {
  throw new TypeError("External first-party module-read ids disagree with canonical owners");
}
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

// A necessary, not sufficient, gate for Store install/update delegation.
// Native trust, health, promotion and rollback gates remain independent.
export function hasNativeExternalFirstPartyModuleRead(value) {
  try {
    return MODULE_READ_IDS.has(validateComponentId(value));
  } catch {
    return false;
  }
}

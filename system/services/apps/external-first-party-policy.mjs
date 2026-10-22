// GENERATED FILE. DO NOT EDIT BY HAND.
// Source of truth: docs/contracts/runtime-component-package.json
// Generator: tools/app-policy/render_external_first_party_policy.py

import { validateComponentId } from "../../contracts/component-manifest.mjs";

export const EXTERNAL_FIRST_PARTY_OWNER = "ordaxsystems/ordax-apps";
export const EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT = Object.freeze({
  "activity": "ordaxsystems/ordax-apps",
  "assistant": "ordaxsystems/ordax-apps",
  "calculator": "ordaxsystems/ordax-apps",
  "calendar": "ordaxsystems/ordax-apps",
  "character-map": "ordaxsystems/ordax-apps",
  "clock": "ordaxsystems/ordax-apps",
  "colors": "ordaxsystems/ordax-apps",
  "converter": "ordaxsystems/ordax-apps",
  "image-viewer": "ordaxsystems/ordax-apps",
  "internet": "ordaxsystems/ordax-apps",
  "media-player": "ordaxsystems/ordax-apps",
  "network": "ordaxsystems/ordax-apps",
  "notes": "ordaxsystems/ordax-apps",
  "paint": "ordaxsystems/ordax-apps",
  "pdf-viewer": "ordaxsystems/ordax-apps",
  "projects": "ordaxsystems/ordax-apps",
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
  "calculator",
  "notes",
  "studio",
]);
export const EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS = Object.freeze([
  "notes",
]);

const IDS = new Set(EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
const MODULE_READ_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS);
const PROBATION_IDS = new Set(EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS);
if (PROBATION_IDS.size !== EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS.length
  || [...PROBATION_IDS].some((appId) => !MODULE_READ_IDS.has(appId))) {
  throw new TypeError("External first-party probation ids disagree with canonical Native read scope");
}
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

// Required, never sufficient for production activation.
export function hasNativeExternalFirstPartyProbation(value) {
  try {
    return PROBATION_IDS.has(validateComponentId(value));
  } catch {
    return false;
  }
}

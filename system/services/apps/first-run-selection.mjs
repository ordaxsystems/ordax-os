import {
  getFirstPartyAppDeliveryPolicy,
} from "./delivery-policy.mjs";

// Selection policy only. It never installs, signs, activates, or removes an app.
// IDs are existing app identities, not a parallel source/package registry.
export const FIRST_RUN_APP_SELECTION_SCHEMA = "ordax.first-run-app-selection/1";

// The base OS remains minimal. These removable apps are selected for a future
// verified initial provision from local signed packages or an approved release.
const DEFAULT_APP_IDS = Object.freeze([
  "files",
  "internet",
  "notes",
  "calculator",
  "clock",
  "converter",
  "calendar",
  "text-viewer",
  "image-viewer",
  "pdf-viewer",
  "media-player",
  "paint",
  "colors",
  "character-map",
  "toolbox",
]);

const DEFAULT_ID_SET = new Set(DEFAULT_APP_IDS);
if (DEFAULT_ID_SET.size !== DEFAULT_APP_IDS.length) {
  throw new TypeError("First Run default app ids must be unique");
}
for (const appId of DEFAULT_APP_IDS) {
  const policy = getFirstPartyAppDeliveryPolicy(appId);
  if (!policy || policy.deliveryClass === "structural" || !policy.removable) {
    throw new TypeError("First Run may select only existing removable apps: " + appId);
  }
}

export function listFirstRunDefaultAppIds() {
  return DEFAULT_APP_IDS;
}

function validatedIds(value, field) {
  if (!Array.isArray(value)) throw new TypeError(field + " must be an array");
  const ids = new Set();
  for (const id of value) {
    if (typeof id !== "string" || !getFirstPartyAppDeliveryPolicy(id) || ids.has(id)) {
      throw new TypeError(field + " contains an unknown or duplicate app id");
    }
    ids.add(id);
  }
  return ids;
}

// Inputs MUST be authoritative snapshots from the owner of installed-state,
// durable user removal intent, and signed+verified catalog. This is a read-only
// selection for an installer, never an executable installation instruction.
// Without that evidence, the app remains pending instead of appearing installed.
export function planFirstRunAppSelection({
  initialProvisioning,
  installedAppIds,
  explicitlyRemovedAppIds,
  verifiedCandidateAppIds,
} = {}) {
  if (typeof initialProvisioning !== "boolean") {
    throw new TypeError("initialProvisioning must be a boolean");
  }
  const installed = validatedIds(installedAppIds, "installedAppIds");
  const removed = validatedIds(explicitlyRemovedAppIds, "explicitlyRemovedAppIds");
  const verified = validatedIds(verifiedCandidateAppIds, "verifiedCandidateAppIds");
  for (const appId of removed) {
    if (installed.has(appId)) {
      throw new TypeError("installed and explicitly removed states cannot overlap");
    }
  }

  const alreadyInstalled = [], suppressed = [], eligible = [], unavailable = [];
  for (const appId of DEFAULT_APP_IDS) {
    if (installed.has(appId)) alreadyInstalled.push(appId);
    else if (removed.has(appId) || !initialProvisioning) suppressed.push(appId);
    else if (verified.has(appId)) eligible.push(appId);
    else unavailable.push(appId);
  }
  return Object.freeze({
    schema: FIRST_RUN_APP_SELECTION_SCHEMA,
    initialProvisioning,
    defaultAppIds: DEFAULT_APP_IDS,
    alreadyInstalledAppIds: Object.freeze(alreadyInstalled),
    suppressedAppIds: Object.freeze(suppressed),
    eligibleCandidateAppIds: Object.freeze(eligible),
    unavailableAppIds: Object.freeze(unavailable),
    installedByThisPlan: false,
    mayInstallWithoutVerifiedLifecycle: false,
    reinstallAfterUserRemoval: false,
    authority: "none",
  });
}

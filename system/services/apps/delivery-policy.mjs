import {
  FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA,
  FIRST_PARTY_APP_DELIVERY_PROJECTION_SCHEMA,
  validateFirstPartyAppDeliveryObservation,
  validateFirstPartyAppDeliveryPolicy,
} from "../../contracts/first-party-app-delivery.mjs";

const RAW_POLICIES = Object.freeze([
  { appId: "settings", deliveryClass: "structural", removable: false, discovery: "installed-only" },
  { appId: "account", deliveryClass: "structural", removable: false, discovery: "installed-only" },
  { appId: "system", deliveryClass: "structural", removable: false, discovery: "installed-only" },
  { appId: "store", deliveryClass: "structural", removable: false, discovery: "installed-only" },

  { appId: "files", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "internet", deliveryClass: "bootstrap", removable: true, discovery: "installed-only" },

  { appId: "assistant", deliveryClass: "on-demand", removable: true, discovery: "launcher-recommended" },
  { appId: "studio", deliveryClass: "on-demand", removable: true, discovery: "launcher-recommended" },
  { appId: "projects", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "activity", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "notes", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "network", deliveryClass: "on-demand", removable: true, discovery: "store-only" },

  // Additional optional first-party products: verified catalog only, no MVP bootstrap.
  { appId: "calculator", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "clock", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "converter", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "text-viewer", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "image-viewer", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "calendar", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "colors", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "character-map", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "paint", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "media-player", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "pdf-viewer", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "toolbox", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
]);

const POLICIES = Object.freeze(
  RAW_POLICIES.map((entry) =>
    validateFirstPartyAppDeliveryPolicy({
      schema: FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA,
      ...entry,
      authority: "none",
    }),
  ),
);

const POLICY_BY_ID = new Map(POLICIES.map((entry) => [entry.appId, entry]));
if (POLICY_BY_ID.size !== POLICIES.length) {
  throw new TypeError("First-party delivery policy app ids must be unique");
}

export function listFirstPartyAppDeliveryPolicies() {
  return POLICIES;
}

export function getFirstPartyAppDeliveryPolicy(appId) {
  return POLICY_BY_ID.get(appId) ?? null;
}

export function projectFirstPartyAppDelivery(appId, rawObservation) {
  const policy = getFirstPartyAppDeliveryPolicy(appId);
  if (!policy) {
    throw new TypeError(`Unknown first-party app delivery id: ${String(appId)}`);
  }
  const observation = validateFirstPartyAppDeliveryObservation(rawObservation);

  let state;
  let reason = observation.blockedReason;

  if (observation.failedRetained) {
    state = "failed-retained";
  } else if (observation.transition === "installing") {
    state = "installing";
  } else if (observation.transition === "updating") {
    state = "updating";
  } else if (observation.transition === "removing") {
    state = "removing";
  } else if (observation.transition === "staged") {
    state = "staged";
  } else if (observation.installed) {
    state = "installed";
  } else if (policy.deliveryClass === "structural") {
    state = "blocked";
    reason = reason ?? "structural-payload-missing";
  } else if (reason !== null) {
    state = "blocked";
  } else if (observation.catalogued) {
    state = "available";
  } else {
    state = "not-catalogued";
  }

  const launchable = observation.installed && state !== "removing";
  const installable =
    !observation.installed &&
    policy.deliveryClass !== "structural" &&
    state === "available";
  const removable =
    policy.removable &&
    observation.installed &&
    ["installed", "failed-retained"].includes(state);
  const showInLauncher =
    launchable ||
    (state === "available" && policy.discovery === "launcher-recommended");

  return Object.freeze({
    schema: FIRST_PARTY_APP_DELIVERY_PROJECTION_SCHEMA,
    appId,
    deliveryClass: policy.deliveryClass,
    state,
    reason,
    launchable,
    installable,
    removable,
    showInLauncher,
    openAction: launchable ? "launch" : installable && showInLauncher ? "show-install" : "none",
    dataRemovalRequiresSeparateAction: true,
    authority: "none",
  });
}

import {
  FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA,
  FIRST_PARTY_APP_DELIVERY_PROJECTION_SCHEMA,
  validateFirstPartyAppDeliveryObservation,
  validateFirstPartyAppDeliveryPolicy,
} from "../../contracts/first-party-app-delivery.mjs";
import { listFirstPartyApps } from "../../apps/catalog.mjs";

const RAW_POLICIES = Object.freeze([
  { appId: "settings", deliveryClass: "structural", removable: false, discovery: "installed-only" },
  { appId: "account", deliveryClass: "structural", removable: false, discovery: "installed-only" },
  { appId: "system", deliveryClass: "structural", removable: false, discovery: "installed-only" },

  { appId: "files", deliveryClass: "bootstrap", removable: true, discovery: "installed-only" },
  { appId: "internet", deliveryClass: "bootstrap", removable: true, discovery: "installed-only" },

  { appId: "assistant", deliveryClass: "on-demand", removable: true, discovery: "launcher-recommended" },
  { appId: "studio", deliveryClass: "on-demand", removable: true, discovery: "launcher-recommended" },
  { appId: "projects", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "activity", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "notes", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
  { appId: "network", deliveryClass: "on-demand", removable: true, discovery: "store-only" },
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

function assertCanonicalCoverage() {
  const apps = listFirstPartyApps();
  const ids = new Set(apps.map((app) => app.id));
  if (POLICY_BY_ID.size !== POLICIES.length) {
    throw new TypeError("First-party delivery policy app ids must be unique");
  }
  if (ids.size !== POLICY_BY_ID.size) {
    throw new TypeError("First-party delivery policy must cover every first-party app exactly once");
  }
  for (const app of apps) {
    if (!POLICY_BY_ID.has(app.id)) {
      throw new TypeError(`First-party app delivery policy is missing app: ${app.id}`);
    }
    if (app.localization?.packPolicy !== "component-scoped") {
      throw new TypeError(`First-party app ${app.id} must keep component-scoped localization`);
    }
  }
  for (const appId of POLICY_BY_ID.keys()) {
    if (!ids.has(appId)) {
      throw new TypeError(`First-party delivery policy references unknown app: ${appId}`);
    }
  }
}

assertCanonicalCoverage();

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

  const launchable = observation.installed;
  const installable =
    !observation.installed &&
    policy.deliveryClass !== "structural" &&
    state === "available";
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
    removable: policy.removable && observation.installed,
    showInLauncher,
    openAction: launchable ? "launch" : installable && showInLauncher ? "show-install" : "none",
    dataRemovalRequiresSeparateAction: true,
    authority: "none",
  });
}

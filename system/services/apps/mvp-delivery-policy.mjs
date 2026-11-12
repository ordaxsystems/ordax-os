import { listFirstPartyAppDeliveryPolicies } from "./delivery-policy.mjs";

export const MVP_APP_DELIVERY_SCHEMA = "prototype-ordax.mvp-app-delivery/1";
export const MVP_FIRST_ONLINE_REFRESH_SCHEMA = "ordax.mvp-first-online-refresh/1";

// Project system-owned classes from the canonical delivery policy, never duplicate IDs.
const DELIVERY_POLICIES = listFirstPartyAppDeliveryPolicies();
const idsByClass = name => Object.freeze(DELIVERY_POLICIES.filter(entry => entry.deliveryClass === name).map(entry => entry.appId));
const STRUCTURAL_APP_IDS = idsByClass("structural");
const INITIAL_BOOTSTRAP_APP_IDS = idsByClass("bootstrap");
const INITIAL_ON_DEMAND_APP_IDS = Object.freeze([
  "internet",
  "activity",
  "files",
  "assistant",
  "network",
  "notes",
  "projects",
  "studio",
]);

function assertCanonicalPolicy() {
  if (INITIAL_BOOTSTRAP_APP_IDS.length !== 0) {
    throw new TypeError("Clean OS must not bundle removable bootstrap applications");
  }
  const policies = DELIVERY_POLICIES;
  // The initial MVP on-demand list is a launch-scope subset.
  // Additional first-party Store-only utility apps must not modify First Run,
  // become bootstrap, or make independent Store delivery a launch blocker.
  const onDemandById = new Map(
    policies.filter((entry) => entry.deliveryClass === "on-demand")
      .map((entry) => [entry.appId, entry]),
  );
  for (const appId of INITIAL_ON_DEMAND_APP_IDS) {
    if (!onDemandById.has(appId)) {
      throw new TypeError("Missing initial MVP on-demand policy: " + appId);
    }
  }
  for (const [appId, policy] of onDemandById) {
    if (!INITIAL_ON_DEMAND_APP_IDS.includes(appId) && policy.discovery !== "store-only") {
      throw new TypeError("Extended first-party Store product cannot change MVP launcher policy: " + appId);
    }
  }
}

assertCanonicalPolicy();

export function getMvpAppDeliveryPolicy() {
  return Object.freeze({
    schema: MVP_APP_DELIVERY_SCHEMA,
    structuralAppIds: STRUCTURAL_APP_IDS,
    bundledBootstrapAppIds: INITIAL_BOOTSTRAP_APP_IDS,
    onDemandAppIds: INITIAL_ON_DEMAND_APP_IDS,
    optionalAppsBlockPublicLaunch: false,
    networkSkipPreservesUsableOfflineSystem: true,
    appCatalogCreatesInstallAuthority: false,
    storeCreatesInstallAuthority: false,
    onDemandAutoInstall: false,
    authority: "none",
  });
}

export function planMvpFirstOnlineRefresh({ online }) {
  if (typeof online !== "boolean") {
    throw new TypeError("MVP first-online refresh requires a boolean online state");
  }

  if (!online) {
    return Object.freeze({
      schema: MVP_FIRST_ONLINE_REFRESH_SCHEMA,
      state: "offline",
      checkBaseUpdate: false,
      refreshSignedAppCatalog: false,
      ensureBootstrapAppIds: Object.freeze([]),
      onDemandAppIds: INITIAL_ON_DEMAND_APP_IDS,
      onDemandAutoInstall: false,
      blocksFirstRunCompletion: false,
      authority: "none",
    });
  }

  return Object.freeze({
    schema: MVP_FIRST_ONLINE_REFRESH_SCHEMA,
    state: "online-refresh-required",
    checkBaseUpdate: true,
    refreshSignedAppCatalog: true,
    ensureBootstrapAppIds: INITIAL_BOOTSTRAP_APP_IDS,
    onDemandAppIds: INITIAL_ON_DEMAND_APP_IDS,
    onDemandAutoInstall: false,
    blocksFirstRunCompletion: false,
    authority: "none",
  });
}

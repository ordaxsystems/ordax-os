import { listFirstPartyAppDeliveryPolicies } from "./delivery-policy.mjs";

export const MVP_APP_DELIVERY_SCHEMA = "prototype-ordax.mvp-app-delivery/1";
export const MVP_FIRST_ONLINE_REFRESH_SCHEMA = "ordax.mvp-first-online-refresh/1";

const STRUCTURAL_APP_IDS = Object.freeze(["account", "settings", "store", "system"]);
const INITIAL_BOOTSTRAP_APP_IDS = Object.freeze(["files", "internet"]);
const INITIAL_ON_DEMAND_APP_IDS = Object.freeze([
  "activity",
  "assistant",
  "network",
  "notes",
  "projects",
  "studio",
]);

function sameIds(actual, expected, label) {
  const normalized = [...actual].sort();
  const wanted = [...expected].sort();
  if (
    normalized.length !== wanted.length
    || normalized.some((value, index) => value !== wanted[index])
  ) {
    throw new TypeError(`${label} does not match the canonical first-party delivery policy`);
  }
}

function assertCanonicalPolicy() {
  const policies = listFirstPartyAppDeliveryPolicies();
  sameIds(
    policies.filter((entry) => entry.deliveryClass === "structural").map((entry) => entry.appId),
    STRUCTURAL_APP_IDS,
    "MVP structural app set",
  );
  sameIds(
    policies.filter((entry) => entry.deliveryClass === "bootstrap").map((entry) => entry.appId),
    INITIAL_BOOTSTRAP_APP_IDS,
    "MVP bootstrap app set",
  );
  sameIds(
    policies.filter((entry) => entry.deliveryClass === "on-demand").map((entry) => entry.appId),
    INITIAL_ON_DEMAND_APP_IDS,
    "MVP on-demand app set",
  );
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

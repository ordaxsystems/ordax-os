const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const DELIVERY_CLASSES = new Set(["structural", "bootstrap", "on-demand"]);
const DISCOVERY_POLICIES = new Set(["installed-only", "launcher-recommended", "store-only"]);
const TRANSITION_STATES = new Set(["idle", "installing", "staged"]);

export const FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA = "ordax.first-party-app-delivery-policy/1";
export const FIRST_PARTY_APP_DELIVERY_PROJECTION_SCHEMA = "ordax.first-party-app-delivery-projection/1";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function validateFirstPartyAppDeliveryPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("First-party app delivery policy must be an object");
  }
  assertExactKeys(
    value,
    ["schema", "appId", "deliveryClass", "removable", "discovery", "authority"],
    "First-party app delivery policy",
  );
  if (value.schema !== FIRST_PARTY_APP_DELIVERY_POLICY_SCHEMA) {
    throw new TypeError("Unsupported first-party app delivery policy schema");
  }
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) {
    throw new TypeError("First-party app delivery policy has invalid appId");
  }
  if (!DELIVERY_CLASSES.has(value.deliveryClass)) {
    throw new TypeError("First-party app delivery policy has invalid deliveryClass");
  }
  if (typeof value.removable !== "boolean") {
    throw new TypeError("First-party app delivery policy removable must be boolean");
  }
  if (!DISCOVERY_POLICIES.has(value.discovery)) {
    throw new TypeError("First-party app delivery policy has invalid discovery policy");
  }
  if (value.authority !== "none") {
    throw new TypeError("First-party app delivery policy must remain authority:none");
  }

  if (value.deliveryClass === "structural") {
    if (value.removable) {
      throw new TypeError("Structural first-party apps cannot be declared removable");
    }
    if (value.discovery !== "installed-only") {
      throw new TypeError("Structural first-party apps must use installed-only discovery");
    }
  } else if (!value.removable) {
    throw new TypeError("Bootstrap/on-demand first-party apps require an explicit removable boundary");
  }

  return Object.freeze({ ...value });
}

export function validateFirstPartyAppDeliveryObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("First-party app delivery observation must be an object");
  }
  assertExactKeys(
    value,
    ["installed", "catalogued", "transition", "blockedReason", "failedRetained"],
    "First-party app delivery observation",
  );
  if (typeof value.installed !== "boolean" || typeof value.catalogued !== "boolean") {
    throw new TypeError("First-party app delivery observation installed/catalogued must be boolean");
  }
  if (!TRANSITION_STATES.has(value.transition)) {
    throw new TypeError("First-party app delivery observation has invalid transition");
  }
  if (value.blockedReason !== null && (typeof value.blockedReason !== "string" || !value.blockedReason.trim())) {
    throw new TypeError("First-party app delivery observation blockedReason must be null or non-empty string");
  }
  if (typeof value.failedRetained !== "boolean") {
    throw new TypeError("First-party app delivery observation failedRetained must be boolean");
  }
  if (value.failedRetained && !value.installed) {
    throw new TypeError("failed-retained requires a known installed version to retain");
  }
  if (value.failedRetained && value.transition !== "idle") {
    throw new TypeError("failed-retained cannot coexist with an active install transition");
  }
  if (value.blockedReason !== null && value.transition !== "idle") {
    throw new TypeError("blocked state cannot coexist with an active install transition");
  }
  return Object.freeze({ ...value });
}

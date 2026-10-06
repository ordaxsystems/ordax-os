import { validateFirstPartyAppDeliveryObservation } from "./first-party-app-delivery.mjs";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const STORE_LIFECYCLE_SCHEMA = "ordax.store-lifecycle/1";
export const STORE_LIFECYCLE_SNAPSHOT_SCHEMA = "ordax.store-lifecycle-snapshot/1";

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function validateStoreLifecycleSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Store lifecycle snapshot must be an object");
  }
  assertExactKeys(value, ["schema", "observations", "authority"], "Store lifecycle snapshot");
  if (value.schema !== STORE_LIFECYCLE_SNAPSHOT_SCHEMA) {
    throw new TypeError("Unsupported Store lifecycle snapshot schema");
  }
  if (!Array.isArray(value.observations)) {
    throw new TypeError("Store lifecycle observations must be an array");
  }
  if (value.authority !== "none") {
    throw new TypeError("Store lifecycle snapshot must remain authority:none");
  }

  const seen = new Set();
  const observations = value.observations.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Store lifecycle observation entry must be an object");
    }
    assertExactKeys(entry, ["appId", "observation"], "Store lifecycle observation entry");
    if (typeof entry.appId !== "string" || !APP_ID_RE.test(entry.appId) || seen.has(entry.appId)) {
      throw new TypeError("Store lifecycle observation appId is invalid or duplicated");
    }
    seen.add(entry.appId);
    return Object.freeze({
      appId: entry.appId,
      observation: validateFirstPartyAppDeliveryObservation(entry.observation),
    });
  });

  return Object.freeze({
    schema: STORE_LIFECYCLE_SNAPSHOT_SCHEMA,
    observations: Object.freeze(observations),
    authority: "none",
  });
}

export function assertStoreLifecyclePort(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Store lifecycle port must be an object");
  }
  if (value.schema !== STORE_LIFECYCLE_SCHEMA) {
    throw new TypeError("Unsupported Store lifecycle port schema");
  }
  for (const method of ["getSnapshot", "subscribe", "requestInstall"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Store lifecycle port is missing ${method}()`);
    }
  }
  validateStoreLifecycleSnapshot(value.getSnapshot());
  return value;
}

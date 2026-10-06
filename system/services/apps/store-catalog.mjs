import { listFirstPartyAppDeliveryPolicies } from "./delivery-policy.mjs";

export const STORE_CATALOG_ENTRY_SCHEMA = "ordax.store-catalog-entry/1";

function defineEntry(policy) {
  if (!policy || policy.deliveryClass === "structural") {
    throw new TypeError("Store catalog entries must come from non-structural first-party delivery policy");
  }
  return Object.freeze({
    schema: STORE_CATALOG_ENTRY_SCHEMA,
    appId: policy.appId,
    deliveryClass: policy.deliveryClass,
    discovery: policy.discovery,
    removable: policy.removable,
    presentation: "catalog-only",
    installAction: "none",
    authority: "none",
  });
}

const ENTRIES = Object.freeze(
  listFirstPartyAppDeliveryPolicies()
    .filter((policy) => policy.deliveryClass !== "structural")
    .map(defineEntry),
);
const ENTRY_BY_ID = new Map(ENTRIES.map((entry) => [entry.appId, entry]));
if (ENTRY_BY_ID.size !== ENTRIES.length) {
  throw new TypeError("Store catalog app ids must be unique");
}

export function listStoreCatalogEntries() {
  return ENTRIES;
}

export function getStoreCatalogEntry(appId) {
  return ENTRY_BY_ID.get(appId) ?? null;
}

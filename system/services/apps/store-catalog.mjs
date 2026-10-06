import { getFirstPartyAppDeliveryPolicy } from "./delivery-policy.mjs";

export const STORE_CATALOG_ENTRY_SCHEMA = "ordax.store-catalog-entry/1";

const STORE_APP_IDS = Object.freeze([
  "assistant",
  "studio",
  "projects",
  "activity",
  "notes",
  "network",
]);

function defineEntry(appId) {
  const policy = getFirstPartyAppDeliveryPolicy(appId);
  if (!policy || policy.deliveryClass !== "on-demand") {
    throw new TypeError(`Store catalog entry ${appId} must reference an on-demand first-party delivery policy`);
  }
  return Object.freeze({
    schema: STORE_CATALOG_ENTRY_SCHEMA,
    appId,
    deliveryClass: policy.deliveryClass,
    discovery: policy.discovery,
    removable: policy.removable,
    presentation: "catalog-only",
    installAction: "none",
    authority: "none",
  });
}

const ENTRIES = Object.freeze(STORE_APP_IDS.map(defineEntry));
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

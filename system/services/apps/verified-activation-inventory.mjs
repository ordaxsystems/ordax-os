import {
  validateComponentId,
  validateComponentVersion,
} from "../../contracts/component-manifest.mjs";
import {
  validateComponentSlotResolution,
  validateComponentSlotSourceCommit,
} from "../../contracts/component-slot-source.mjs";
import {
  assertVerifiedComponentPackageSource,
} from "../../contracts/verified-component-package-source.mjs";

export const FIRST_PARTY_APP_ACTIVATION_INVENTORY_SCHEMA =
  "ordax.first-party-app-activation-inventory/1";
export const FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA =
  "ordax.first-party-app-activation-record/1";

const MAX_APP_IDS = 128;

function validateAppIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_APP_IDS) {
    throw new TypeError("First-party activation inventory appIds must be a bounded non-empty array");
  }
  const ids = value.map(validateComponentId);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("First-party activation inventory appIds must be unique");
  }
  return ids;
}

async function readMetadataResponse(response, appId) {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new TypeError(`Verified activation metadata response is invalid: ${appId}`);
  }
  if (!response.ok) {
    throw new Error(
      `Verified activation metadata unavailable for ${appId}: HTTP ${response.status}`,
    );
  }
  if (typeof response.json !== "function") {
    throw new TypeError("Verified activation metadata response must implement json()");
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Verified activation metadata payload is invalid: ${appId}`);
  }
  return value;
}

function absentRecord(metadata, appId) {
  if (
    metadata.componentId !== appId
    || metadata.state !== "current"
    || metadata.source !== "absent"
    || !Number.isSafeInteger(metadata.revision)
    || metadata.revision < 0
    || metadata.version !== null
    || metadata.sourceCommit !== null
    || metadata.entrypoint !== null
  ) {
    throw new TypeError(`Verified absent activation identity is inconsistent: ${appId}`);
  }
  return Object.freeze({
    schema: FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA,
    appId,
    installed: false,
    version: null,
    sourceCommit: null,
    revision: metadata.revision,
    authority: "none",
  });
}

function installedRecord(metadata, appId) {
  const resolution = validateComponentSlotResolution(metadata);
  if (
    resolution.componentId !== appId
    || resolution.state !== "current"
    || resolution.source !== "slot"
  ) {
    throw new TypeError(`Verified installed activation identity is inconsistent: ${appId}`);
  }
  return Object.freeze({
    schema: FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA,
    appId,
    installed: true,
    version: validateComponentVersion(resolution.version),
    sourceCommit: validateComponentSlotSourceCommit(resolution.sourceCommit),
    revision: resolution.revision,
    authority: "none",
  });
}

function recordFromMetadata(metadata, appId) {
  if (metadata?.source === "absent") return absentRecord(metadata, appId);
  if (metadata?.source === "slot") return installedRecord(metadata, appId);
  if (metadata?.source === "bundled") {
    throw new TypeError(
      `External first-party app unexpectedly resolved to bundled source: ${appId}`,
    );
  }
  throw new TypeError(`Verified activation source is invalid: ${appId}`);
}

export async function readVerifiedFirstPartyAppActivationInventory({
  appIds,
  source,
  fetchImpl,
} = {}) {
  const ids = validateAppIds(appIds);
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("First-party activation inventory requires fetchImpl()");
  }

  const records = [];
  for (const appId of ids) {
    const url = packageSource.metadataUrl(appId, "current");
    const metadata = await readMetadataResponse(
      await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      }),
      appId,
    );
    records.push(recordFromMetadata(metadata, appId));
  }

  return Object.freeze({
    schema: FIRST_PARTY_APP_ACTIVATION_INVENTORY_SCHEMA,
    records: Object.freeze(records),
    authority: "none",
  });
}

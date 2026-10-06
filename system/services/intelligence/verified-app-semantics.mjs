import { validateAppIntelligenceManifest } from "../../contracts/app-intelligence-manifest.mjs";
import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { validateComponentSlotResolution } from "../../contracts/component-slot-source.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";

const MAX_APP_MANIFESTS = 32;

function validateAppIds(value) {
  if (!Array.isArray(value) || value.length > MAX_APP_MANIFESTS) {
    throw new TypeError("Verified app semantics appIds must be a bounded array");
  }
  const ids = value.map(validateComponentId);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Verified app semantics appIds must be unique");
  }
  return ids;
}

async function readJsonResponse(response, label) {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new TypeError(`${label} response is invalid`);
  }
  if (!response.ok) {
    throw new Error(`${label} unavailable: HTTP ${response.status}`);
  }
  if (typeof response.json !== "function") {
    throw new TypeError(`${label} response must implement json()`);
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} payload must be an object`);
  }
  return value;
}

function validateCurrentMetadata(value, expectedAppId) {
  if (value.componentId !== expectedAppId || value.state !== "current") {
    throw new TypeError("Verified app semantics metadata identity mismatch");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Verified app semantics metadata revision is invalid");
  }
  if (value.source === "absent" || value.source === "bundled") {
    if (
      value.version !== null
      || value.sourceCommit !== null
      || value.entrypoint !== null
    ) {
      throw new TypeError("Verified app semantics non-slot metadata is inconsistent");
    }
    return Object.freeze({
      componentId: expectedAppId,
      state: "current",
      source: value.source,
      revision: value.revision,
      version: null,
      sourceCommit: null,
      entrypoint: null,
      pendingHealth: null,
    });
  }
  return validateComponentSlotResolution(value);
}

export async function loadVerifiedFirstPartyIntelligenceManifests({
  appIds = [],
  source,
  fetchImpl,
} = {}) {
  const ids = validateAppIds(appIds);
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified app semantics requires fetchImpl()");
  }

  const manifests = [];
  for (const appId of ids) {
    const metadata = validateCurrentMetadata(
      await readJsonResponse(
        await fetchImpl(packageSource.metadataUrl(appId, "current"), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        }),
        `Verified app semantics metadata for ${appId}`,
      ),
      appId,
    );

    if (metadata.source !== "slot") {
      continue;
    }

    const manifestPath = `system/apps/${appId}/ai/manifest.json`;
    const manifestUrl = packageSource.fileUrl({
      componentId: appId,
      state: "current",
      resolution: metadata,
      path: manifestPath,
    });
    const manifest = validateAppIntelligenceManifest(
      await readJsonResponse(
        await fetchImpl(manifestUrl, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        }),
        `Verified app intelligence manifest for ${appId}`,
      ),
      {
        appId,
        appVersion: metadata.version,
      },
    );
    manifests.push(manifest);
  }
  return Object.freeze(manifests);
}

import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";
import { validateFileAssociationManifest } from "../../contracts/file-association-manifest.mjs";
import { validateAppPresentationManifest } from "../../contracts/app-presentation-manifest.mjs";
import { defineExternalFirstPartyApp } from "./external-app-definition.mjs";
import {
  CANONICAL_APP_PACKAGE_COMPONENT_IDS,
  CANONICAL_APP_PACKAGE_SOURCE_REPOSITORY,
} from "./package-source-policy.mjs";

const FETCH_OPTIONS = Object.freeze({
  method: "GET",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});

async function readJson(response, label, { optional = false } = {}) {
  if (!response || typeof response !== "object" || typeof response.status !== "number") {
    throw new TypeError(`${label} response is invalid`);
  }
  if (optional && response.status === 404) return null;
  if (response.ok !== true) throw new Error(`${label} unavailable: HTTP ${response.status}`);
  if (typeof response.json !== "function") throw new TypeError(`${label} response must implement json()`);
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} payload must be an object`);
  }
  return value;
}

async function readPackageJson({ source, fetchImpl, appId, metadata, relativePath, optional = false }) {
  return readJson(
    await fetchImpl(source.fileUrl({
      componentId: appId,
      state: "current",
      resolution: metadata,
      path: `system/apps/${appId}/${relativePath}`,
    }), FETCH_OPTIONS),
    `Verified external app ${relativePath} for ${appId}`,
    { optional },
  );
}

export async function discoverVerifiedExternalApplications({
  source,
  fetchImpl,
  appIds = CANONICAL_APP_PACKAGE_COMPONENT_IDS,
  onError = null,
} = {}) {
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") throw new TypeError("Verified external app discovery requires fetchImpl()");
  if (!Array.isArray(appIds) || new Set(appIds).size !== appIds.length) {
    throw new TypeError("Verified external app discovery appIds must be a unique array");
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Verified external app discovery onError must be a function or null");
  }

  const entries = [];
  for (const appId of appIds) {
    try {
      const metadataPayload = await readJson(
        await fetchImpl(packageSource.metadataUrl(appId, "current"), FETCH_OPTIONS),
        `Verified external app metadata for ${appId}`,
        { optional: true },
      );
      if (metadataPayload === null) continue;
      const metadata = validateComponentRuntimeMetadata(metadataPayload, {
        componentId: appId,
        state: "current",
      });
      if (metadata.source !== "slot") continue;

      const component = defineComponentManifest(
        await readPackageJson({
          source: packageSource,
          fetchImpl,
          appId,
          metadata,
          relativePath: "app.json",
        }),
      );
      if (
        component.id !== appId
        || component.version !== metadata.version
        || component.kind !== "app"
        || component.releaseMode !== "component-slot"
        || component.owner !== CANONICAL_APP_PACKAGE_SOURCE_REPOSITORY
      ) {
        throw new TypeError(`Verified external app identity drifted for ${appId}`);
      }

      const presentation = validateAppPresentationManifest(
        await readPackageJson({
          source: packageSource,
          fetchImpl,
          appId,
          metadata,
          relativePath: "presentation/manifest.json",
        }),
        { appId, appVersion: component.version },
      );

      const rawAssociation = await readPackageJson({
        source: packageSource,
        fetchImpl,
        appId,
        metadata,
        relativePath: "associations/manifest.json",
        optional: true,
      });
      const association = rawAssociation === null
        ? null
        : validateFileAssociationManifest(rawAssociation, {
            appId,
            appVersion: component.version,
          });
      entries.push(Object.freeze({
        component,
        metadata,
        presentation,
        association,
      }));
    } catch (error) {
      onError?.(error, appId);
    }
  }
  return Object.freeze(entries);
}

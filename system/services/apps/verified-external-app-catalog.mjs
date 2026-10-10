import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";
import { validateFileAssociationManifest } from "../../contracts/file-association-manifest.mjs";
import { validateAppPresentationManifest } from "../../contracts/app-presentation-manifest.mjs";
import {
  EXTERNAL_FIRST_PARTY_OWNER,
  isExternalFirstPartyComponentId,
  hasNativeExternalFirstPartyModuleRead,
  listExternalFirstPartyComponentIds,
} from "./external-first-party-policy.mjs";

const REQUEST_OPTIONS = Object.freeze({
  method: "GET",
  cache: "no-store",
  credentials: "same-origin",
  redirect: "error",
});

async function readJson(response, label, optional = false) {
  if (!response || typeof response !== "object" || typeof response.status !== "number") {
    throw new TypeError(`${label} response is invalid`);
  }
  if (optional && response.status === 404) return null;
  if (response.ok !== true || typeof response.json !== "function") {
    throw new Error(`${label} unavailable: HTTP ${response.status}`);
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value;
}

async function readPackageFile({ source, fetchImpl, appId, metadata, file, optional = false }) {
  const url = source.fileUrl({
    componentId: appId,
    state: "current",
    resolution: metadata,
    path: `system/apps/${appId}/${file}`,
  });
  return readJson(await fetchImpl(url, REQUEST_OPTIONS), `Verified ${appId} ${file}`, optional);
}

// Discovery is descriptive. The native broker remains the only reader of
// signature-checked immutable component slots. No package code is evaluated.
export async function discoverVerifiedExternalApplications({
  source,
  fetchImpl,
  appIds = listExternalFirstPartyComponentIds(),
  onError = null,
  deadlineMs = 5_000,
} = {}) {
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified external app discovery requires fetchImpl()");
  }
  if (!Array.isArray(appIds) || appIds.length > 32
      || new Set(appIds).size !== appIds.length
      || appIds.some((id) => !isExternalFirstPartyComponentId(id))) {
    throw new TypeError("Verified external app IDs must belong to the canonical package policy");
  }
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Verified external app onError must be a function or null");
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 30_000) {
    throw new TypeError("Verified external app discovery deadline must be 100..30000 ms");
  }
  const controller = new AbortController();
  const fetchWithAbort = (url, options) =>
    fetchImpl(url, { ...options, signal: controller.signal });
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Verified external app discovery deadline exceeded"));
    }, deadlineMs);
  });
  const readAll = async () => {
  const entries = [];
  for (const appId of appIds) {
    if (controller.signal.aborted) break;
    // A store candidate is not yet a native module-read permission.
    if (!hasNativeExternalFirstPartyModuleRead(appId)) continue;
    try {
      const metadataPayload = await readJson(
        await fetchWithAbort(packageSource.metadataUrl(appId, "current"), REQUEST_OPTIONS),
        `Verified ${appId} slot metadata`,
        true,
      );
      if (metadataPayload === null) continue;
      const metadata = validateComponentRuntimeMetadata(metadataPayload, {
        componentId: appId, state: "current",
      });
      if (metadata.source !== "slot") continue;
      if (!metadata.entrypoint.startsWith(`system/apps/${appId}/`)) {
        throw new TypeError(`Verified ${appId} entrypoint escaped its package`);
      }
      const component = defineComponentManifest(await readPackageFile({
        source: packageSource, fetchImpl: fetchWithAbort, appId, metadata, file: "app.json",
      }));
      if (component.id !== appId || component.version !== metadata.version
          || component.kind !== "app" || component.releaseMode !== "component-slot"
          || component.owner !== EXTERNAL_FIRST_PARTY_OWNER) {
        throw new TypeError(`Verified external app identity drifted: ${appId}`);
      }
      const presentationPayload = await readPackageFile({
        source: packageSource, fetchImpl: fetchWithAbort, appId, metadata,
        file: "presentation/manifest.json", optional: true,
      });
      if (presentationPayload === null) continue;
      const presentation = validateAppPresentationManifest(presentationPayload, {
        appId, appVersion: component.version,
      });
      const associationPayload = await readPackageFile({
        source: packageSource, fetchImpl: fetchWithAbort, appId, metadata,
        file: "associations/manifest.json", optional: true,
      });
      const association = associationPayload === null ? null
        : validateFileAssociationManifest(associationPayload, {
          appId, appVersion: component.version,
        });
      // The Native channel can promote/remove a current slot between reads.
      // Do not publish a presentation built from a stale immutable identity.
      const currentAfterFiles = validateComponentRuntimeMetadata(
        await readJson(
          await fetchWithAbort(packageSource.metadataUrl(appId, "current"), REQUEST_OPTIONS),
          `Verified ${appId} current slot recheck`,
        ),
        { componentId: appId, state: "current" },
      );
      if (currentAfterFiles.source !== "slot"
        || ["revision", "version", "sourceCommit", "entrypoint"].some(
          (field) => currentAfterFiles[field] !== metadata[field]
        )) {
        throw new TypeError(`Verified external app activation changed during discovery: ${appId}`);
      }
      if (controller.signal.aborted) break;
      entries.push(Object.freeze({
        component, metadata, presentation, association,
      }));
    } catch (error) {
      if (controller.signal.aborted) throw error;
      onError?.(error, appId);
    }
  }
  return Object.freeze(entries);
  };
  try {
    return await Promise.race([readAll(), deadline]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

import { validateAppIntelligenceManifest } from "../../contracts/app-intelligence-manifest.mjs";
import {
  defineComponentManifest,
  validateComponentId,
} from "../../contracts/component-manifest.mjs";
import { validateComponentSlotResolution } from "../../contracts/component-slot-source.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";

const MAX_APP_MANIFESTS = 32;
const EXTERNAL_FIRST_PARTY_OWNER = "washingtonmsdj/ordax-apps";

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

async function readVerifiedPackageJson({
  appId,
  metadata,
  path,
  packageSource,
  fetchImpl,
  label,
}) {
  const url = packageSource.fileUrl({
    componentId: appId,
    state: "current",
    resolution: metadata,
    path,
  });
  return readJsonResponse(
    await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    }),
    label,
  );
}

function validateExternalAppComponent(value, appId, metadata) {
  const component = defineComponentManifest(value);
  if (
    component.id !== appId
    || component.version !== metadata.version
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== EXTERNAL_FIRST_PARTY_OWNER
  ) {
    throw new TypeError(`Verified external app identity drifted for ${appId}`);
  }
  if (
    metadata.entrypoint !== `system/apps/${appId}/src/runtime.mjs`
    && !metadata.entrypoint.startsWith(`system/apps/${appId}/`)
  ) {
    throw new TypeError(`Verified external app entrypoint escaped app ownership: ${appId}`);
  }
  return component;
}

export async function loadVerifiedFirstPartyApplicationSemantics({
  appIds = [],
  source,
  fetchImpl,
} = {}) {
  const ids = validateAppIds(appIds);
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified app semantics requires fetchImpl()");
  }

  const entries = [];
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

    const component = validateExternalAppComponent(
      await readVerifiedPackageJson({
        appId,
        metadata,
        path: `system/apps/${appId}/app.json`,
        packageSource,
        fetchImpl,
        label: `Verified app component manifest for ${appId}`,
      }),
      appId,
      metadata,
    );

    const intelligenceManifest = validateAppIntelligenceManifest(
      await readVerifiedPackageJson({
        appId,
        metadata,
        path: `system/apps/${appId}/ai/manifest.json`,
        packageSource,
        fetchImpl,
        label: `Verified app intelligence manifest for ${appId}`,
      }),
      {
        appId: component.id,
        appVersion: component.version,
      },
    );

    entries.push(Object.freeze({
      application: Object.freeze({
        id: component.id,
        title: component.title,
        component,
      }),
      intelligenceManifest,
      sourceCommit: metadata.sourceCommit,
      revision: metadata.revision,
    }));
  }
  return Object.freeze(entries);
}

export async function loadVerifiedFirstPartyIntelligenceManifests(options = {}) {
  const entries = await loadVerifiedFirstPartyApplicationSemantics(options);
  return Object.freeze(entries.map((entry) => entry.intelligenceManifest));
}

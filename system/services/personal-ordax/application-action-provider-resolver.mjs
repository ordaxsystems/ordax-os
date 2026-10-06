import {
  validateApplicationActionPreparation,
} from "../../contracts/application-action-preparation.mjs";
import {
  validateApplicationActionManifest,
} from "../../contracts/application-action-manifest.mjs";
import {
  validateApplicationActionProviderManifest,
} from "../../contracts/application-action-provider-manifest.mjs";
import {
  APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
  validateApplicationActionProviderResolution,
} from "../../contracts/application-action-provider-resolution.mjs";
import {
  defineComponentManifest,
} from "../../contracts/component-manifest.mjs";
import {
  validateComponentSlotResolution,
  validateComponentSlotSourceCommit,
} from "../../contracts/component-slot-source.mjs";
import {
  assertVerifiedComponentPackageSource,
} from "../../contracts/verified-component-package-source.mjs";

const MAX_VERIFIED_APPLICATIONS = 32;
const SHA256_RE = /^[0-9a-f]{64}$/;

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

function boundedOwner(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 220
    || value.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError("Application action provider resolver expected owner is invalid");
  }
  return value;
}

function validateEntry(value, expectedOwner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application action provider resolver entry is invalid");
  }
  const application = value.application;
  if (!application || typeof application !== "object" || Array.isArray(application)) {
    throw new TypeError("Application action provider resolver application is invalid");
  }
  const component = defineComponentManifest(application.component);
  if (
    application.id !== component.id
    || application.title !== component.title
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== expectedOwner
  ) {
    throw new TypeError("Application action provider resolver app identity is not verified first-party");
  }

  const actionManifest = value.actionManifest === null
    ? null
    : validateApplicationActionManifest(value.actionManifest, {
        appId: component.id,
        appVersion: component.version,
      });
  if (value.providerManifest != null && actionManifest === null) {
    throw new TypeError("Application action provider resolver provider manifest lacks Actions");
  }
  const providerManifest = value.providerManifest == null
    ? null
    : validateApplicationActionProviderManifest(value.providerManifest, {
        appId: component.id,
        appVersion: component.version,
        actionManifest,
      });
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Application action provider resolver slot revision is invalid");
  }

  return Object.freeze({
    application: Object.freeze({
      id: component.id,
      title: component.title,
      component,
    }),
    actionManifest,
    providerManifest,
    sourceCommit,
    revision: value.revision,
  });
}

function validateEntries(value, expectedOwner) {
  if (!Array.isArray(value) || value.length > MAX_VERIFIED_APPLICATIONS) {
    throw new TypeError("Application action provider resolver entries must be a bounded array");
  }
  const entries = value.map((entry) => validateEntry(entry, expectedOwner));
  const ids = entries.map((entry) => entry.application.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Application action provider resolver entries must be unique by app");
  }
  return Object.freeze(entries);
}

export function createApplicationActionProviderResolver({
  verifiedEntries = [],
  source: sourceValue,
  fetchImpl,
  artifactIdentity,
  expectedOwner,
} = {}) {
  const owner = boundedOwner(expectedOwner);
  const entries = validateEntries(verifiedEntries, owner);
  const byAppId = new Map(entries.map((entry) => [entry.application.id, entry]));
  const source = assertVerifiedComponentPackageSource(sourceValue);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Application action provider resolver requires fetchImpl()");
  }
  if (typeof artifactIdentity !== "function") {
    throw new TypeError("Application action provider resolver requires artifactIdentity()");
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
    async resolve(preparationValue) {
      const preparation = validateApplicationActionPreparation(preparationValue);
      const appId = preparation.proposal.appId;
      const entry = byAppId.get(appId);
      if (entry === undefined) {
        throw new Error(`Application action provider app is not currently verified: ${appId}`);
      }
      if (entry.providerManifest === null) {
        throw new Error(`Application action provider artifact is unavailable for verified app: ${appId}`);
      }
      const provider = entry.providerManifest.providers.find(
        (candidate) =>
          candidate.adapterId === preparation.provider.adapterId
          && candidate.revision === preparation.provider.revision,
      );
      if (!provider) {
        throw new Error(
          `Application action provider artifact no longer matches preparation: ${appId}`,
        );
      }

      const metadata = validateComponentSlotResolution(
        await readJsonResponse(
          await fetchImpl(source.metadataUrl(appId, "current"), {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            redirect: "error",
          }),
          `Application action provider slot metadata for ${appId}`,
        ),
      );
      if (
        metadata.componentId !== appId
        || metadata.state !== "current"
        || metadata.version !== entry.application.component.version
        || metadata.sourceCommit !== entry.sourceCommit
        || metadata.revision !== entry.revision
      ) {
        throw new Error(
          `Application action provider verified slot changed after semantics load: ${appId}`,
        );
      }

      const moduleUrl = source.fileUrl({
        componentId: appId,
        state: "current",
        resolution: metadata,
        path: `system/apps/${appId}/${provider.module}`,
      });
      const artifactSha256 = await artifactIdentity(moduleUrl);
      if (
        typeof artifactSha256 !== "string"
        || !SHA256_RE.test(artifactSha256)
        || artifactSha256 !== provider.artifactSha256
      ) {
        throw new Error(
          `Application action provider artifact identity mismatch: ${appId}/${provider.adapterId}`,
        );
      }

      return validateApplicationActionProviderResolution({
        schema: APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
        preparationId: preparation.preparationId,
        resourceRef: preparation.resourceRef,
        appId,
        appVersion: metadata.version,
        sourceCommit: metadata.sourceCommit,
        slotRevision: metadata.revision,
        provider: {
          kind: "first-party-native",
          adapterId: provider.adapterId,
          revision: provider.revision,
          module: provider.module,
          artifactSha256,
        },
        authority: "none",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      }, { preparation });
    },
  });
}

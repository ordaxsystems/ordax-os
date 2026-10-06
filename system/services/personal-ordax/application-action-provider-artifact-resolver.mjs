import {
  assertApplicationActionProviderResolver as assertApplicationActionProviderBindingResolver,
  validateApplicationActionProviderBinding,
} from "../../contracts/application-action-provider-binding.mjs";
import {
  validateApplicationActionManifest,
} from "../../contracts/application-action-manifest.mjs";
import {
  validateApplicationActionProviderManifest,
} from "../../contracts/application-action-provider-manifest.mjs";
import {
  APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
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
    throw new TypeError("Application action provider artifact resolver expected owner is invalid");
  }
  return value;
}

function validateEntry(value, expectedOwner, expectedAppId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application action provider artifact resolver entry is invalid");
  }
  const application = value.application;
  if (!application || typeof application !== "object" || Array.isArray(application)) {
    throw new TypeError("Application action provider artifact resolver application is invalid");
  }
  const component = defineComponentManifest(application.component);
  if (
    application.id !== component.id
    || application.title !== component.title
    || component.id !== expectedAppId
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== expectedOwner
  ) {
    throw new TypeError(
      "Application action provider artifact resolver app identity is not verified first-party",
    );
  }

  const actionManifest = value.actionManifest === null
    ? null
    : validateApplicationActionManifest(value.actionManifest, {
        appId: component.id,
        appVersion: component.version,
      });
  if (value.providerManifest != null && actionManifest === null) {
    throw new TypeError(
      "Application action provider artifact resolver provider manifest lacks Actions",
    );
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
    throw new TypeError("Application action provider artifact resolver slot revision is invalid");
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

function sameBinding(leftValue, rightValue) {
  const left = validateApplicationActionProviderBinding(leftValue);
  const right = validateApplicationActionProviderBinding(rightValue);
  return (
    left.resourceRef === right.resourceRef
    && left.workItemId === right.workItemId
    && left.appId === right.appId
    && left.actionId === right.actionId
    && left.appVersion === right.appVersion
    && left.sourceCommit === right.sourceCommit
    && left.componentRevision === right.componentRevision
    && left.provider.kind === right.provider.kind
    && left.provider.adapterId === right.provider.adapterId
    && left.provider.revision === right.provider.revision
    && left.capabilitySha256 === right.capabilitySha256
    && left.capabilityProvenance === right.capabilityProvenance
  );
}

function providerForBinding(entry, binding) {
  const appId = binding.appId;
  if (
    entry.application.component.version !== binding.appVersion
    || entry.sourceCommit !== binding.sourceCommit
    || entry.revision !== binding.componentRevision
  ) {
    throw new Error(`Application action provider verified semantics drifted from binding: ${appId}`);
  }
  if (entry.providerManifest === null) {
    throw new Error(`Application action provider artifact is unavailable for verified app: ${appId}`);
  }
  const provider = entry.providerManifest.providers.find(
    (candidate) =>
      candidate.adapterId === binding.provider.adapterId
      && candidate.revision === binding.provider.revision,
  );
  if (!provider) {
    throw new Error(
      `Application action provider artifact no longer matches binding: ${appId}`,
    );
  }
  return provider;
}

function sameProviderArtifact(left, right) {
  return (
    left.kind === right.kind
    && left.adapterId === right.adapterId
    && left.revision === right.revision
    && left.module === right.module
    && left.artifactSha256 === right.artifactSha256
  );
}

export function createApplicationActionProviderArtifactResolver({
  providerBindingResolver: providerBindingResolverValue,
  resolveVerifiedSemantics,
  source: sourceValue,
  fetchImpl,
  artifactIdentity,
  expectedOwner,
} = {}) {
  const providerBindingResolver = assertApplicationActionProviderBindingResolver(
    providerBindingResolverValue,
  );
  const owner = boundedOwner(expectedOwner);
  if (typeof resolveVerifiedSemantics !== "function") {
    throw new TypeError(
      "Application action provider artifact resolver requires resolveVerifiedSemantics()",
    );
  }
  const source = assertVerifiedComponentPackageSource(sourceValue);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Application action provider artifact resolver requires fetchImpl()");
  }
  if (typeof artifactIdentity !== "function") {
    throw new TypeError("Application action provider artifact resolver requires artifactIdentity()");
  }

  const currentEntry = async (appId) => {
    const value = await resolveVerifiedSemantics(appId);
    if (value === null) {
      throw new Error(`Application action provider app is not currently verified: ${appId}`);
    }
    return validateEntry(value, owner, appId);
  };

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
    async resolve(resourceRef) {
      const firstBindingValue = await providerBindingResolver.resolve(resourceRef);
      if (firstBindingValue === null) return null;
      const binding = validateApplicationActionProviderBinding(firstBindingValue);
      if (binding.resourceRef !== resourceRef) {
        throw new Error("Application action provider binding resource reference drifted");
      }

      const appId = binding.appId;
      const entry = await currentEntry(appId);
      const provider = providerForBinding(entry, binding);

      const semanticsBindingValue = await providerBindingResolver.resolve(resourceRef);
      if (semanticsBindingValue === null || !sameBinding(binding, semanticsBindingValue)) {
        throw new Error(
          "Application action provider binding changed during verified semantics resolution",
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
        || metadata.version !== binding.appVersion
        || metadata.sourceCommit !== binding.sourceCommit
        || metadata.revision !== binding.componentRevision
      ) {
        throw new Error(
          `Application action provider verified slot changed after binding: ${appId}`,
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

      const finalBindingValue = await providerBindingResolver.resolve(resourceRef);
      if (finalBindingValue === null || !sameBinding(binding, finalBindingValue)) {
        throw new Error("Application action provider binding changed during artifact resolution");
      }

      const finalEntry = await currentEntry(appId);
      const finalProvider = providerForBinding(finalEntry, binding);
      if (!sameProviderArtifact(provider, finalProvider)) {
        throw new Error(
          `Application action provider verified semantics changed during artifact resolution: ${appId}`,
        );
      }

      return validateApplicationActionProviderResolution({
        schema: APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
        resourceRef: binding.resourceRef,
        workItemId: binding.workItemId,
        appId: binding.appId,
        actionId: binding.actionId,
        appVersion: binding.appVersion,
        sourceCommit: binding.sourceCommit,
        componentRevision: binding.componentRevision,
        provider: {
          kind: binding.provider.kind,
          adapterId: provider.adapterId,
          revision: provider.revision,
          module: provider.module,
          artifactSha256,
        },
        capabilitySha256: binding.capabilitySha256,
        capabilityProvenance: binding.capabilityProvenance,
        authority: "none",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      }, { binding });
    },
  });
}

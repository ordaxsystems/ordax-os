import {
  validateApplicationActionCapability,
} from "../../contracts/application-action-capability.mjs";
import { validateApplicationActionManifest } from "../../contracts/application-action-manifest.mjs";
import {
  validateApplicationActionProviderManifest,
} from "../../contracts/application-action-provider-manifest.mjs";
import {
  APPLICATION_ACTION_PROVIDER_ARTIFACT_BINDING_SCHEMA,
  validateApplicationActionProviderArtifactBinding,
} from "../../contracts/application-action-provider-artifact-binding.mjs";
import {
  APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
  assertApplicationActionProviderResolver,
  validateApplicationActionProviderBinding,
} from "../../contracts/application-action-provider-binding.mjs";
import {
  assertApplicationActionCapabilityRegistryForPreparation,
  assertApplicationActionPreparationRegistry,
  sameApplicationActionProposal,
  validateApplicationActionPreparation,
} from "../../contracts/application-action-preparation.mjs";
import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { validateComponentSlotSourceCommit } from "../../contracts/component-slot-source.mjs";

const SHA256_RE = /^[0-9a-f]{64}$/;

const RISK_TO_EFFECT = Object.freeze({
  "read-only": "read",
  "local-change": "write",
  "external-effect": "external-egress",
  privileged: "device-control",
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
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

function sameProvider(left, right) {
  return left.kind === right.kind
    && left.adapterId === right.adapterId
    && left.revision === right.revision;
}

function sameCapability(leftValue, rightValue) {
  const left = validateApplicationActionCapability(leftValue);
  const right = validateApplicationActionCapability(rightValue);
  return canonicalJson(left) === canonicalJson(right);
}

function validateVerifiedSemanticsEntry(value, preparation, expectedOwner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Current verified application semantics entry is unavailable");
  }
  if (!value.application || typeof value.application !== "object" || Array.isArray(value.application)) {
    throw new TypeError("Current verified application identity is invalid");
  }
  const component = defineComponentManifest(value.application.component);
  if (
    value.application.id !== component.id
    || value.application.title !== component.title
    || component.id !== preparation.proposal.appId
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== expectedOwner
  ) {
    throw new TypeError("Current verified application identity drifted");
  }
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Current verified application component revision is invalid");
  }
  if (value.actionManifest === null || value.actionManifest === undefined) {
    throw new Error("Current verified application has no Application Action manifest");
  }
  const actionManifest = validateApplicationActionManifest(value.actionManifest, {
    appId: component.id,
    appVersion: component.version,
  });
  const capability = actionManifest.capabilities.find(
    (candidate) => candidate.actionId === preparation.proposal.actionId,
  );
  if (!capability) {
    throw new Error("Prepared Application Action is no longer declared by the verified package");
  }
  const providerManifest = value.providerManifest == null
    ? null
    : validateApplicationActionProviderManifest(value.providerManifest, {
        appId: component.id,
        appVersion: component.version,
        actionManifest,
      });
  return Object.freeze({
    component,
    sourceCommit,
    componentRevision: value.revision,
    capability,
    providerManifest,
  });
}

export function createApplicationActionProviderResolver({
  preparationRegistry: preparationRegistryValue,
  capabilityRegistry: capabilityRegistryValue,
  resolveVerifiedSemantics,
  resolveProviderArtifactSha256 = null,
  expectedOwner,
} = {}) {
  const preparationRegistry = assertApplicationActionPreparationRegistry(
    preparationRegistryValue,
  );
  const capabilityRegistry = assertApplicationActionCapabilityRegistryForPreparation(
    capabilityRegistryValue,
  );
  if (typeof resolveVerifiedSemantics !== "function") {
    throw new TypeError("Application action provider resolver requires verified semantics resolver");
  }
  if (
    resolveProviderArtifactSha256 !== null
    && typeof resolveProviderArtifactSha256 !== "function"
  ) {
    throw new TypeError(
      "Application action provider artifact identity resolver must be a function or null",
    );
  }
  const owner = boundedOwner(expectedOwner);

  const resolveBinding = async (resourceRef) => {
    const retained = preparationRegistry.resolve(resourceRef);
    if (retained === null) return null;
    const preparation = validateApplicationActionPreparation(retained);

    const currentCapability = capabilityRegistry.get(
      preparation.proposal.appId,
      preparation.proposal.actionId,
    );
    if (!currentCapability) {
      throw new Error("Prepared Application Action capability is no longer available");
    }
    if (
      currentCapability.sourceClass !== "first-party"
      || currentCapability.platform !== "ordax"
      || currentCapability.provider.kind !== "first-party-native"
      || currentCapability.binding.payloadSha256 !== null
    ) {
      throw new Error("Prepared Application Action no longer resolves to a first-party provider");
    }
    const currentProposal = capabilityRegistry.propose(
      preparation.proposal.appId,
      preparation.proposal.actionId,
      preparation.proposal.arguments,
    );
    if (!sameApplicationActionProposal(preparation.proposal, currentProposal)) {
      throw new Error("Prepared Application Action proposal is stale");
    }
    if (!sameProvider(currentCapability.provider, preparation.provider)) {
      throw new Error("Prepared Application Action provider revision is stale");
    }
    if (RISK_TO_EFFECT[currentCapability.riskClass] !== preparation.effect) {
      throw new Error("Prepared Application Action effect is stale");
    }

    const verified = validateVerifiedSemanticsEntry(
      await resolveVerifiedSemantics(preparation.proposal.appId),
      preparation,
      owner,
    );
    if (!sameCapability(currentCapability, verified.capability)) {
      throw new Error("Verified package capability no longer matches the prepared capability");
    }
    if (!sameProvider(verified.capability.provider, preparation.provider)) {
      throw new Error("Verified package provider no longer matches the prepared provider");
    }

    return validateApplicationActionProviderBinding({
      schema: APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
      resourceRef: preparation.resourceRef,
      workItemId: preparation.workItemId,
      appId: preparation.proposal.appId,
      actionId: preparation.proposal.actionId,
      appVersion: verified.component.version,
      sourceCommit: verified.sourceCommit,
      componentRevision: verified.componentRevision,
      provider: preparation.provider,
      capabilitySha256: preparation.proposal.capabilitySha256,
      capabilityProvenance: preparation.proposal.capabilityProvenance,
      authority: "none",
      executionAuthorized: false,
      modelDirectExecutionAuthorized: false,
    });
  };

  const port = {
    schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
    resolve: resolveBinding,
    async resolveArtifact(resourceRef) {
      if (resolveProviderArtifactSha256 === null) {
        throw new Error(
          "Application Action provider artifact identity resolution is unavailable",
        );
      }
      const binding = await resolveBinding(resourceRef);
      if (binding === null) return null;

      const retained = preparationRegistry.resolve(resourceRef);
      if (retained === null) {
        throw new Error("Application Action preparation changed before artifact verification");
      }
      const preparation = validateApplicationActionPreparation(retained);
      const verified = validateVerifiedSemanticsEntry(
        await resolveVerifiedSemantics(binding.appId),
        preparation,
        owner,
      );
      if (
        verified.component.version !== binding.appVersion
        || verified.sourceCommit !== binding.sourceCommit
        || verified.componentRevision !== binding.componentRevision
      ) {
        throw new Error(
          "Application Action provider slot changed before artifact verification",
        );
      }
      if (verified.providerManifest === null) {
        throw new Error(
          "Verified Application Action provider artifact manifest is unavailable",
        );
      }
      const providerArtifact = verified.providerManifest.providers.find(
        (candidate) =>
          candidate.adapterId === binding.provider.adapterId
          && candidate.revision === binding.provider.revision,
      );
      if (!providerArtifact) {
        throw new Error(
          "Verified Application Action provider artifact no longer matches binding",
        );
      }

      const actualSha256 = await resolveProviderArtifactSha256(Object.freeze({
        appId: binding.appId,
        appVersion: binding.appVersion,
        sourceCommit: binding.sourceCommit,
        componentRevision: binding.componentRevision,
        module: providerArtifact.module,
        declaredSha256: providerArtifact.artifactSha256,
      }));
      if (
        typeof actualSha256 !== "string"
        || !SHA256_RE.test(actualSha256)
        || actualSha256 !== providerArtifact.artifactSha256
      ) {
        throw new Error(
          "Verified Application Action provider artifact SHA-256 mismatch",
        );
      }

      const currentBinding = await resolveBinding(resourceRef);
      if (
        currentBinding === null
        || canonicalJson(currentBinding) !== canonicalJson(binding)
      ) {
        throw new Error(
          "Application Action provider binding changed during artifact verification",
        );
      }

      return validateApplicationActionProviderArtifactBinding({
        schema: APPLICATION_ACTION_PROVIDER_ARTIFACT_BINDING_SCHEMA,
        providerBinding: binding,
        module: providerArtifact.module,
        artifactSha256: actualSha256,
        authority: "none",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      });
    },
  };

  assertApplicationActionProviderResolver(port);
  return Object.freeze(port);
}

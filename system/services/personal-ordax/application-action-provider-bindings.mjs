import {
  validateApplicationActionCapability,
} from "../../contracts/application-action-capability.mjs";
import { validateApplicationActionManifest } from "../../contracts/application-action-manifest.mjs";
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
  return Object.freeze({
    component,
    sourceCommit,
    componentRevision: value.revision,
    capability,
  });
}

export function createApplicationActionProviderResolver({
  preparationRegistry: preparationRegistryValue,
  capabilityRegistry: capabilityRegistryValue,
  resolveVerifiedSemantics,
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
  const owner = boundedOwner(expectedOwner);

  const port = {
    schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
    async resolve(resourceRef) {
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
    },
  };

  assertApplicationActionProviderResolver(port);
  return Object.freeze(port);
}

import {
  validateApplicationActionManifest,
} from "../../contracts/application-action-manifest.mjs";
import {
  validateApplicationActionProviderManifest,
} from "../../contracts/application-action-provider-manifest.mjs";
import {
  assertApplicationActionProviderArtifactResolver,
  validateApplicationActionProviderResolution,
} from "../../contracts/application-action-provider-resolution.mjs";
import {
  APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA,
  APPLICATION_ACTION_PROVIDER_ACTIVATION_PROVIDER_EXECUTION_MODE,
  APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA,
  APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE,
  assertApplicationActionProviderActivationBroker,
  sameApplicationActionProviderResolution,
  validateApplicationActionProviderActivation,
} from "../../contracts/application-action-provider-activation.mjs";
import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import {
  validateComponentSlotSourceCommit,
} from "../../contracts/component-slot-source.mjs";

function boundedOwner(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 220
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(
      "Application Action provider activation broker expected owner is invalid",
    );
  }
  return value;
}

function validateCurrentVerifiedState(value, resolution, expectedOwner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      "Application Action provider activation requires current verified semantics",
    );
  }
  if (
    !value.application
    || typeof value.application !== "object"
    || Array.isArray(value.application)
  ) {
    throw new TypeError(
      "Application Action provider activation verified application is invalid",
    );
  }

  const component = defineComponentManifest(value.application.component);
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (
    value.application.id !== component.id
    || value.application.title !== component.title
    || component.id !== resolution.appId
    || component.version !== resolution.appVersion
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== expectedOwner
    || sourceCommit !== resolution.sourceCommit
    || value.revision !== resolution.componentRevision
  ) {
    throw new Error(
      "Application Action provider activation verified application drifted",
    );
  }

  if (value.actionManifest === null || value.actionManifest === undefined) {
    throw new Error(
      "Application Action provider activation requires a current Action manifest",
    );
  }
  const actionManifest = validateApplicationActionManifest(value.actionManifest, {
    appId: resolution.appId,
    appVersion: resolution.appVersion,
  });
  const capability = actionManifest.capabilities.find(
    (candidate) => candidate.actionId === resolution.actionId,
  );
  if (
    !capability
    || capability.provider.kind !== resolution.provider.kind
    || capability.provider.adapterId !== resolution.provider.adapterId
    || capability.provider.revision !== resolution.provider.revision
    || capability.provenance !== resolution.capabilityProvenance
  ) {
    throw new Error(
      "Application Action provider activation capability drifted",
    );
  }

  if (
    value.providerManifest === null
    || value.providerManifest === undefined
  ) {
    throw new Error(
      "Application Action provider activation requires a current provider manifest",
    );
  }
  if (value.providerManifest.execution !== APPLICATION_ACTION_PROVIDER_ACTIVATION_PROVIDER_EXECUTION_MODE) {
    throw new Error(
      "Application Action provider activation execution must remain unavailable",
    );
  }
  const providerManifest = validateApplicationActionProviderManifest(
    value.providerManifest,
    {
      appId: resolution.appId,
      appVersion: resolution.appVersion,
      actionManifest,
    },
  );
  const provider = providerManifest.providers.find(
    (candidate) =>
      candidate.kind === resolution.provider.kind
      && candidate.adapterId === resolution.provider.adapterId
      && candidate.revision === resolution.provider.revision,
  );
  if (
    !provider
    || provider.module !== resolution.provider.module
    || provider.artifactSha256 !== resolution.provider.artifactSha256
  ) {
    throw new Error(
      "Application Action provider activation artifact drifted",
    );
  }

  return providerManifest.execution;
}

export function createApplicationActionProviderActivationBroker({
  providerArtifactResolver: providerArtifactResolverValue,
  resolveVerifiedSemantics,
  expectedOwner,
} = {}) {
  const providerArtifactResolver = assertApplicationActionProviderArtifactResolver(
    providerArtifactResolverValue,
  );
  if (typeof resolveVerifiedSemantics !== "function") {
    throw new TypeError(
      "Application Action provider activation broker requires resolveVerifiedSemantics()",
    );
  }
  const owner = boundedOwner(expectedOwner);

  const port = {
    schema: APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA,
    async resolve(resourceRef) {
      const firstValue = await providerArtifactResolver.resolve(resourceRef);
      if (firstValue === null) return null;
      const first = validateApplicationActionProviderResolution(firstValue);

      const currentSemantics = await resolveVerifiedSemantics(first.appId);
      const providerExecution = validateCurrentVerifiedState(
        currentSemantics,
        first,
        owner,
      );

      const secondValue = await providerArtifactResolver.resolve(resourceRef);
      if (secondValue === null) {
        throw new Error(
          "Application Action provider artifact resolution disappeared during activation check",
        );
      }
      const second = validateApplicationActionProviderResolution(secondValue);
      if (!sameApplicationActionProviderResolution(first, second)) {
        throw new Error(
          "Application Action provider artifact resolution changed during activation check",
        );
      }

      return validateApplicationActionProviderActivation({
        schema: APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA,
        resolution: second,
        providerExecution,
        state: APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE,
        brokerOnly: true,
        authority: "none",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      }, { resolution: second });
    },
  };

  assertApplicationActionProviderActivationBroker(port);
  return Object.freeze(port);
}

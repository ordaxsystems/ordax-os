import {
  validateApplicationActionProviderResolution,
} from "./application-action-provider-resolution.mjs";
export const APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA =
  "ordax.application-action-provider-activation/1";
export const APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA =
  "ordax.application-action-provider-activation-broker/1";
export const APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE = "unavailable";
export const APPLICATION_ACTION_PROVIDER_ACTIVATION_PROVIDER_EXECUTION_MODE =
  "unavailable";

const FORBIDDEN_METHODS = Object.freeze([
  "activate",
  "deactivate",
  "execute",
  "invoke",
  "run",
  "launch",
  "import",
  "load",
  "loadAdapter",
  "grant",
  "authorize",
  "confirm",
  "mount",
  "registerAdapter",
]);

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new TypeError(label + " fields are not canonical");
  }
}

export function sameApplicationActionProviderResolution(leftValue, rightValue) {
  const left = validateApplicationActionProviderResolution(leftValue);
  const right = validateApplicationActionProviderResolution(rightValue);
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
    && left.provider.module === right.provider.module
    && left.provider.artifactSha256 === right.provider.artifactSha256
    && left.capabilitySha256 === right.capabilitySha256
    && left.capabilityProvenance === right.capabilityProvenance
    && left.authority === right.authority
    && left.executionAuthorized === right.executionAuthorized
    && left.modelDirectExecutionAuthorized === right.modelDirectExecutionAuthorized
  );
}

export function validateApplicationActionProviderActivation(value, expected = {}) {
  exactFields(
    value,
    [
      "schema",
      "resolution",
      "providerExecution",
      "state",
      "brokerOnly",
      "authority",
      "executionAuthorized",
      "modelDirectExecutionAuthorized",
    ],
    "Application Action provider activation",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA) {
    throw new TypeError("Application Action provider activation schema is incompatible");
  }

  const resolution = validateApplicationActionProviderResolution(value.resolution);
  if (
    value.providerExecution !== APPLICATION_ACTION_PROVIDER_ACTIVATION_PROVIDER_EXECUTION_MODE
    || value.state !== APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE
    || value.brokerOnly !== true
  ) {
    throw new TypeError(
      "Application Action provider activation must remain broker-only and unavailable",
    );
  }
  if (
    value.authority !== "none"
    || value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError("Application Action provider activation cannot grant authority");
  }

  if (
    expected.resolution !== undefined
    && !sameApplicationActionProviderResolution(resolution, expected.resolution)
  ) {
    throw new TypeError(
      "Application Action provider activation no longer matches its artifact resolution",
    );
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA,
    resolution,
    providerExecution: APPLICATION_ACTION_PROVIDER_ACTIVATION_PROVIDER_EXECUTION_MODE,
    state: APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE,
    brokerOnly: true,
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

export function assertApplicationActionProviderActivationBroker(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA
    || typeof port.resolve !== "function"
  ) {
    throw new TypeError(
      "Compatible Application Action provider activation broker is required",
    );
  }
  for (const method of FORBIDDEN_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(
        "Application Action provider activation broker must not expose " + method + "()",
      );
    }
  }
  return port;
}

import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import {
  validateApplicationActionCapability,
} from "./application-action-capability.mjs";

export const APPLICATION_ACTION_MANIFEST_SCHEMA = "ordax.application-action-manifest/1";
export const APPLICATION_ACTION_MANIFEST_EXECUTION_MODE = "proposal-only";

const MAX_CAPABILITIES = 128;

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export function validateApplicationActionManifest(value, expected = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Application action manifest must be an object");
  }
  exactKeys(
    value,
    ["schema", "appId", "appVersion", "authority", "execution", "capabilities"],
    "Application action manifest",
  );
  if (value.schema !== APPLICATION_ACTION_MANIFEST_SCHEMA) {
    throw new TypeError("Unsupported application action manifest schema");
  }

  const appId = validateComponentId(value.appId);
  const appVersion = validateComponentVersion(value.appVersion);
  if (expected.appId && appId !== expected.appId) {
    throw new TypeError(`Application action manifest appId mismatch: expected ${expected.appId}`);
  }
  if (expected.appVersion && appVersion !== expected.appVersion) {
    throw new TypeError(
      `Application action manifest appVersion mismatch: expected ${expected.appVersion}`,
    );
  }
  if (value.authority !== "none") {
    throw new TypeError("Application action manifest must not carry authority");
  }
  if (value.execution !== APPLICATION_ACTION_MANIFEST_EXECUTION_MODE) {
    throw new TypeError("Application action manifest cannot grant execution");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > MAX_CAPABILITIES) {
    throw new TypeError("Application action manifest capabilities must be a bounded array");
  }

  const capabilities = value.capabilities.map((candidate) => {
    const capability = validateApplicationActionCapability(candidate);
    if (
      capability.appId !== appId
      || !capability.actionId.startsWith(`${appId}.`)
    ) {
      throw new TypeError(
        "Application action capability identity must be namespaced by manifest appId",
      );
    }
    if (
      capability.sourceClass !== "first-party"
      || capability.platform !== "ordax"
      || capability.provider.kind !== "first-party-native"
      || capability.binding.payloadSha256 !== null
    ) {
      throw new TypeError(
        "Application action manifest capabilities must remain first-party OrdaX declarations",
      );
    }
    if (
      capability.executionAuthorized !== false
      || capability.modelDirectExecutionAuthorized !== false
    ) {
      throw new TypeError("Application action manifest cannot grant execution authority");
    }
    return capability;
  });

  const actionIds = capabilities.map((capability) => capability.actionId);
  if (new Set(actionIds).size !== actionIds.length) {
    throw new TypeError("Application action manifest action ids must be unique");
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_MANIFEST_SCHEMA,
    appId,
    appVersion,
    authority: "none",
    execution: APPLICATION_ACTION_MANIFEST_EXECUTION_MODE,
    capabilities: Object.freeze(capabilities),
  });
}

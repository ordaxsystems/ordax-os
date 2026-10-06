import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import {
  validateApplicationActionManifest,
} from "./application-action-manifest.mjs";

export const APPLICATION_ACTION_PROVIDER_MANIFEST_SCHEMA =
  "ordax.application-action-provider-manifest/1";
export const APPLICATION_ACTION_PROVIDER_EXECUTION_MODE = "unavailable";

const MAX_PROVIDERS = 16;
const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODULE_RE = /^actions\/providers\/([a-z][a-z0-9-]{0,127})\.mjs$/;

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > max
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function validateApplicationActionProviderManifest(value, expected = {}) {
  exactKeys(
    value,
    ["schema", "appId", "appVersion", "authority", "execution", "providers"],
    "Application action provider manifest",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_MANIFEST_SCHEMA) {
    throw new TypeError("Unsupported Application action provider manifest schema");
  }
  const appId = validateComponentId(value.appId);
  const appVersion = validateComponentVersion(value.appVersion);
  if (expected.appId && appId !== expected.appId) {
    throw new TypeError(`Application action provider manifest appId mismatch: expected ${expected.appId}`);
  }
  if (expected.appVersion && appVersion !== expected.appVersion) {
    throw new TypeError(
      `Application action provider manifest appVersion mismatch: expected ${expected.appVersion}`,
    );
  }
  if (
    value.authority !== "none"
    || value.execution !== APPLICATION_ACTION_PROVIDER_EXECUTION_MODE
  ) {
    throw new TypeError("Application action provider manifest cannot grant execution");
  }
  if (
    !Array.isArray(value.providers)
    || value.providers.length < 1
    || value.providers.length > MAX_PROVIDERS
  ) {
    throw new TypeError("Application action providers must be a bounded non-empty array");
  }

  const providers = value.providers.map((candidate) => {
    exactKeys(
      candidate,
      ["kind", "adapterId", "revision", "module", "sha256"],
      "Application action provider",
    );
    if (candidate.kind !== "first-party-native") {
      throw new TypeError("Application action provider must be first-party native");
    }
    const adapterId = boundedText(
      candidate.adapterId,
      "Application action provider adapterId",
      128,
    );
    if (!ADAPTER_ID_RE.test(adapterId)) {
      throw new TypeError("Application action provider adapterId is invalid");
    }
    const revision = boundedText(
      candidate.revision,
      "Application action provider revision",
      160,
    );
    const module = boundedText(
      candidate.module,
      "Application action provider module",
      256,
    );
    const match = MODULE_RE.exec(module);
    if (!match || match[1] !== adapterId) {
      throw new TypeError("Application action provider module path is not canonical");
    }
    const artifactSha256 = boundedText(
      candidate.sha256,
      "Application action provider SHA-256",
      64,
    );
    if (!SHA256_RE.test(artifactSha256)) {
      throw new TypeError("Application action provider SHA-256 is invalid");
    }
    return Object.freeze({
      kind: "first-party-native",
      adapterId,
      revision,
      module,
      artifactSha256,
    });
  });

  const keys = providers.map((provider) => `${provider.adapterId}@${provider.revision}`);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("Application action providers must be unique");
  }

  if (expected.actionManifest !== undefined) {
    const actions = validateApplicationActionManifest(expected.actionManifest, {
      appId,
      appVersion,
    });
    const required = new Set(
      actions.capabilities.map(
        (capability) =>
          `${capability.provider.adapterId}@${capability.provider.revision}`,
      ),
    );
    if (
      required.size !== keys.length
      || keys.some((key) => !required.has(key))
    ) {
      throw new TypeError(
        "Application action provider artifacts must exactly cover declared capabilities",
      );
    }
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_MANIFEST_SCHEMA,
    appId,
    appVersion,
    authority: "none",
    execution: APPLICATION_ACTION_PROVIDER_EXECUTION_MODE,
    providers: Object.freeze(providers),
  });
}

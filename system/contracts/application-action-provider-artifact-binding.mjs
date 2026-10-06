import {
  validateApplicationActionProviderBinding,
} from "./application-action-provider-binding.mjs";

export const APPLICATION_ACTION_PROVIDER_ARTIFACT_BINDING_SCHEMA =
  "ordax.application-action-provider-artifact-binding/1";

const SHA256_RE = /^[0-9a-f]{64}$/;
const MODULE_RE = /^actions\/providers\/([a-z][a-z0-9-]{0,127})\.mjs$/;

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
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

export function validateApplicationActionProviderArtifactBinding(value) {
  exactFields(
    value,
    [
      "schema",
      "providerBinding",
      "module",
      "artifactSha256",
      "authority",
      "executionAuthorized",
      "modelDirectExecutionAuthorized",
    ],
    "Application Action provider artifact binding",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_ARTIFACT_BINDING_SCHEMA) {
    throw new TypeError(
      "Application Action provider artifact binding schema is incompatible",
    );
  }

  const providerBinding = validateApplicationActionProviderBinding(
    value.providerBinding,
  );
  const module = boundedText(
    value.module,
    "Application Action provider artifact module",
    256,
  );
  const match = MODULE_RE.exec(module);
  if (!match || match[1] !== providerBinding.provider.adapterId) {
    throw new TypeError(
      "Application Action provider artifact module does not match provider binding",
    );
  }
  const artifactSha256 = boundedText(
    value.artifactSha256,
    "Application Action provider artifact SHA-256",
    64,
  );
  if (!SHA256_RE.test(artifactSha256)) {
    throw new TypeError(
      "Application Action provider artifact SHA-256 is invalid",
    );
  }
  if (
    value.authority !== "none"
    || value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError(
      "Application Action provider artifact binding cannot authorize execution",
    );
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_ARTIFACT_BINDING_SCHEMA,
    providerBinding,
    module,
    artifactSha256,
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

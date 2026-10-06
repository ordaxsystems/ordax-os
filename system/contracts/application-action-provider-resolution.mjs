import {
  validateApplicationActionProviderBinding,
} from "./application-action-provider-binding.mjs";
import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import {
  validateComponentSlotSourceCommit,
} from "./component-slot-source.mjs";

export const APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA =
  "ordax.application-action-provider-resolution/1";
export const APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA =
  "ordax.application-action-provider-artifact-resolver/1";

const ACTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODULE_RE = /^actions\/providers\/([a-z][a-z0-9-]{0,127})\.mjs$/;
const RESOURCE_REF_RE = /^application-action:[a-z][a-z0-9._-]{0,159}$/;
const FORBIDDEN_METHODS = [
  "execute", "invoke", "run", "launch", "import", "load", "loadAdapter",
  "grant", "authorize", "confirm",
];

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
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

export function validateApplicationActionProviderResolution(value, expected = {}) {
  exactFields(
    value,
    [
      "schema",
      "resourceRef",
      "workItemId",
      "appId",
      "actionId",
      "appVersion",
      "sourceCommit",
      "componentRevision",
      "provider",
      "capabilitySha256",
      "capabilityProvenance",
      "authority",
      "executionAuthorized",
      "modelDirectExecutionAuthorized",
    ],
    "Application action provider resolution",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA) {
    throw new TypeError("Application action provider resolution schema is incompatible");
  }

  const resourceRef = boundedText(
    value.resourceRef,
    "Application action provider resolution resource ref",
    192,
  );
  if (!RESOURCE_REF_RE.test(resourceRef)) {
    throw new TypeError("Application action provider resolution resource ref is invalid");
  }
  const workItemId = boundedText(
    value.workItemId,
    "Application action provider resolution work item id",
    160,
  );
  const appId = validateComponentId(value.appId);
  if (
    typeof value.actionId !== "string"
    || value.actionId.length > 120
    || !ACTION_ID_RE.test(value.actionId)
  ) {
    throw new TypeError("Application action provider resolution actionId is invalid");
  }
  const appVersion = validateComponentVersion(value.appVersion);
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (!Number.isSafeInteger(value.componentRevision) || value.componentRevision < 0) {
    throw new TypeError("Application action provider resolution component revision is invalid");
  }

  exactFields(
    value.provider,
    ["kind", "adapterId", "revision", "module", "artifactSha256"],
    "Application action provider resolution provider",
  );
  if (value.provider.kind !== "first-party-native") {
    throw new TypeError("Application action provider resolution requires first-party native provider");
  }
  const adapterId = boundedText(
    value.provider.adapterId,
    "Application action provider resolution adapter id",
    128,
  );
  if (!ADAPTER_ID_RE.test(adapterId)) {
    throw new TypeError("Application action provider resolution adapter id is invalid");
  }
  const revision = boundedText(
    value.provider.revision,
    "Application action provider resolution revision",
    160,
  );
  const module = boundedText(
    value.provider.module,
    "Application action provider resolution module",
    256,
  );
  const moduleMatch = MODULE_RE.exec(module);
  if (!moduleMatch || moduleMatch[1] !== adapterId) {
    throw new TypeError("Application action provider resolution module is not canonical");
  }
  const artifactSha256 = boundedText(
    value.provider.artifactSha256,
    "Application action provider resolution artifact SHA-256",
    64,
  );
  if (!SHA256_RE.test(artifactSha256)) {
    throw new TypeError("Application action provider resolution artifact SHA-256 is invalid");
  }
  if (typeof value.capabilitySha256 !== "string" || !SHA256_RE.test(value.capabilitySha256)) {
    throw new TypeError("Application action provider resolution capability digest is invalid");
  }
  const capabilityProvenance = boundedText(
    value.capabilityProvenance,
    "Application action provider resolution capability provenance",
    320,
  );
  if (
    value.authority !== "none"
    || value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError("Application action provider resolution cannot authorize execution");
  }

  if (expected.binding !== undefined) {
    const binding = validateApplicationActionProviderBinding(expected.binding);
    if (
      binding.resourceRef !== resourceRef
      || binding.workItemId !== workItemId
      || binding.appId !== appId
      || binding.actionId !== value.actionId
      || binding.appVersion !== appVersion
      || binding.sourceCommit !== sourceCommit
      || binding.componentRevision !== value.componentRevision
      || binding.provider.kind !== value.provider.kind
      || binding.provider.adapterId !== adapterId
      || binding.provider.revision !== revision
      || binding.capabilitySha256 !== value.capabilitySha256
      || binding.capabilityProvenance !== capabilityProvenance
    ) {
      throw new TypeError(
        "Application action provider resolution no longer matches its provider binding",
      );
    }
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
    resourceRef,
    workItemId,
    appId,
    actionId: value.actionId,
    appVersion,
    sourceCommit,
    componentRevision: value.componentRevision,
    provider: Object.freeze({
      kind: "first-party-native",
      adapterId,
      revision,
      module,
      artifactSha256,
    }),
    capabilitySha256: value.capabilitySha256,
    capabilityProvenance,
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

export function assertApplicationActionProviderArtifactResolver(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA
  ) {
    throw new TypeError("Compatible Application action provider artifact resolver is required");
  }
  if (typeof port.resolve !== "function") {
    throw new TypeError("Application action provider artifact resolver must implement resolve()");
  }
  for (const method of FORBIDDEN_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(
        `Application action provider artifact resolver must not expose ${method}()`,
      );
    }
  }
  return port;
}

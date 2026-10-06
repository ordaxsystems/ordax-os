import {
  validateApplicationActionPreparation,
} from "./application-action-preparation.mjs";
import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";
import {
  validateComponentSlotSourceCommit,
} from "./component-slot-source.mjs";

export const APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA =
  "ordax.application-action-provider-resolution/1";
export const APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA =
  "ordax.application-action-provider-artifact-resolver/1";

const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MODULE_RE = /^actions\/providers\/([a-z][a-z0-9-]{0,127})\.mjs$/;
const FORBIDDEN_METHODS = [
  "execute", "invoke", "run", "launch", "import", "loadAdapter",
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
      "preparationId",
      "resourceRef",
      "appId",
      "appVersion",
      "sourceCommit",
      "slotRevision",
      "provider",
      "authority",
      "executionAuthorized",
      "modelDirectExecutionAuthorized",
    ],
    "Application action provider resolution",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA) {
    throw new TypeError("Application action provider resolution schema is incompatible");
  }
  const preparationId = boundedText(
    value.preparationId,
    "Application action provider resolution preparation id",
    160,
  );
  const resourceRef = boundedText(
    value.resourceRef,
    "Application action provider resolution resource ref",
    192,
  );
  const appId = validateComponentId(value.appId);
  const appVersion = validateComponentVersion(value.appVersion);
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (!Number.isSafeInteger(value.slotRevision) || value.slotRevision < 0) {
    throw new TypeError("Application action provider resolution slot revision is invalid");
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
  if (
    value.authority !== "none"
    || value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError("Application action provider resolution cannot authorize execution");
  }

  if (expected.preparation !== undefined) {
    const preparation = validateApplicationActionPreparation(expected.preparation);
    if (
      preparation.preparationId !== preparationId
      || preparation.resourceRef !== resourceRef
      || preparation.proposal.appId !== appId
      || preparation.provider.adapterId !== adapterId
      || preparation.provider.revision !== revision
    ) {
      throw new TypeError(
        "Application action provider resolution no longer matches its preparation",
      );
    }
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
    preparationId,
    resourceRef,
    appId,
    appVersion,
    sourceCommit,
    slotRevision: value.slotRevision,
    provider: Object.freeze({
      kind: "first-party-native",
      adapterId,
      revision,
      module,
      artifactSha256,
    }),
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

export function assertApplicationActionProviderResolver(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA
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

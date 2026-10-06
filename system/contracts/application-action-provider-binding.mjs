import { validateComponentVersion } from "./component-manifest.mjs";
import { validateComponentSlotSourceCommit } from "./component-slot-source.mjs";

export const APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA =
  "ordax.application-action-provider-binding/1";
export const APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA =
  "ordax.application-action-provider-resolver/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const ACTION_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const ADAPTER_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const RESOURCE_REF_RE = /^application-action:[a-z][a-z0-9._-]{0,159}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const FORBIDDEN_METHODS = [
  "execute", "invoke", "run", "launch", "grant", "authorize", "confirm",
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

export function validateApplicationActionProviderBinding(value) {
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
    "Application action provider binding",
  );
  if (value.schema !== APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA) {
    throw new TypeError("Application action provider binding schema is incompatible");
  }
  const resourceRef = boundedText(
    value.resourceRef,
    "Application action provider binding resource ref",
    192,
  );
  if (!RESOURCE_REF_RE.test(resourceRef)) {
    throw new TypeError("Application action provider binding resource ref is invalid");
  }
  const workItemId = boundedText(
    value.workItemId,
    "Application action provider binding work item id",
    160,
  );
  if (typeof value.appId !== "string" || !APP_ID_RE.test(value.appId)) {
    throw new TypeError("Application action provider binding appId is invalid");
  }
  if (
    typeof value.actionId !== "string"
    || value.actionId.length > 120
    || !ACTION_ID_RE.test(value.actionId)
  ) {
    throw new TypeError("Application action provider binding actionId is invalid");
  }
  const appVersion = validateComponentVersion(value.appVersion);
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  if (!Number.isSafeInteger(value.componentRevision) || value.componentRevision < 0) {
    throw new TypeError("Application action provider binding component revision is invalid");
  }

  exactFields(
    value.provider,
    ["kind", "adapterId", "revision"],
    "Application action provider binding provider",
  );
  if (value.provider.kind !== "first-party-native") {
    throw new TypeError("Application action provider binding requires first-party native provider");
  }
  if (
    typeof value.provider.adapterId !== "string"
    || !ADAPTER_ID_RE.test(value.provider.adapterId)
  ) {
    throw new TypeError("Application action provider binding adapterId is invalid");
  }
  const providerRevision = boundedText(
    value.provider.revision,
    "Application action provider binding provider revision",
    160,
  );
  if (typeof value.capabilitySha256 !== "string" || !SHA256_RE.test(value.capabilitySha256)) {
    throw new TypeError("Application action provider binding capability digest is invalid");
  }
  const capabilityProvenance = boundedText(
    value.capabilityProvenance,
    "Application action provider binding capability provenance",
    320,
  );
  if (value.authority !== "none") {
    throw new TypeError("Application action provider binding authority must remain none");
  }
  if (
    value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError("Application action provider binding cannot authorize execution");
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
    resourceRef,
    workItemId,
    appId: value.appId,
    actionId: value.actionId,
    appVersion,
    sourceCommit,
    componentRevision: value.componentRevision,
    provider: Object.freeze({
      kind: "first-party-native",
      adapterId: value.provider.adapterId,
      revision: providerRevision,
    }),
    capabilitySha256: value.capabilitySha256,
    capabilityProvenance,
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
    || typeof port.resolve !== "function"
  ) {
    throw new TypeError("Compatible Application action provider resolver is required");
  }
  for (const method of FORBIDDEN_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(
        `Application action provider resolver must not expose ${method}()`,
      );
    }
  }
  return port;
}

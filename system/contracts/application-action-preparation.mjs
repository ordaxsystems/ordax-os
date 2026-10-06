import {
  APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
  assertApplicationActionCapabilityRegistryPort,
  validateApplicationActionProposal,
} from "./application-action-capability.mjs";

export const APPLICATION_ACTION_PREPARATION_SCHEMA =
  "ordax.application-action-preparation/1";
export const APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA =
  "ordax.application-action-preparation-registry/1";

const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const ID_RE = /^[a-z][a-z0-9._-]{0,159}$/;
const RESOURCE_REF_RE = /^application-action:[a-z][a-z0-9._-]{0,159}$/;
const FORBIDDEN_METHODS = [
  "execute", "invoke", "run", "launch", "grant", "authorize", "confirm",
];

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

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

export function validateApplicationActionPreparation(value) {
  exactFields(
    value,
    [
      "schema",
      "preparationId",
      "resourceRef",
      "workItemId",
      "proposal",
      "provider",
      "effect",
      "authority",
      "executionAuthorized",
      "modelDirectExecutionAuthorized",
    ],
    "Application action preparation",
  );
  if (value.schema !== APPLICATION_ACTION_PREPARATION_SCHEMA) {
    throw new TypeError("Application action preparation schema is incompatible");
  }

  const preparationId = boundedText(
    value.preparationId,
    "Application action preparation id",
    160,
  );
  if (!ID_RE.test(preparationId)) {
    throw new TypeError("Application action preparation id is invalid");
  }
  const resourceRef = boundedText(
    value.resourceRef,
    "Application action preparation resource ref",
    192,
  );
  if (
    !RESOURCE_REF_RE.test(resourceRef)
    || resourceRef !== `application-action:${preparationId}`
  ) {
    throw new TypeError("Application action preparation resource ref is invalid");
  }
  const workItemId = boundedText(
    value.workItemId,
    "Application action preparation work item id",
    160,
  );
  const proposal = validateApplicationActionProposal(value.proposal);

  exactFields(
    value.provider,
    ["kind", "adapterId", "revision"],
    "Application action preparation provider",
  );
  if (value.provider.kind !== "first-party-native") {
    throw new TypeError("Application action preparation requires first-party native provider");
  }
  const adapterId = boundedText(
    value.provider.adapterId,
    "Application action preparation adapter id",
    128,
  );
  const revision = boundedText(
    value.provider.revision,
    "Application action preparation provider revision",
    160,
  );
  if (!EFFECTS.has(value.effect)) {
    throw new TypeError("Application action preparation effect is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Application action preparation authority must remain none");
  }
  if (
    value.executionAuthorized !== false
    || value.modelDirectExecutionAuthorized !== false
  ) {
    throw new TypeError("Application action preparation cannot authorize execution");
  }

  return Object.freeze({
    schema: APPLICATION_ACTION_PREPARATION_SCHEMA,
    preparationId,
    resourceRef,
    workItemId,
    proposal,
    provider: Object.freeze({
      kind: "first-party-native",
      adapterId,
      revision,
    }),
    effect: value.effect,
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
}

export function assertApplicationActionPreparationRegistry(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA
  ) {
    throw new TypeError("Compatible Application action preparation registry is required");
  }
  for (const method of ["prepare", "resolve", "revoke", "listForWork"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(
        `Application action preparation registry must implement ${method}()`,
      );
    }
  }
  for (const method of FORBIDDEN_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(
        `Application action preparation registry must not expose ${method}()`,
      );
    }
  }
  return port;
}

export function assertApplicationActionCapabilityRegistryForPreparation(port) {
  const registry = assertApplicationActionCapabilityRegistryPort(port);
  if (registry.schema !== APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA) {
    throw new TypeError(
      "Application action preparation requires a compatible capability registry",
    );
  }
  return registry;
}

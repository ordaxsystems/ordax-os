import { createHash } from "node:crypto";

import {
  APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
  APPLICATION_ACTION_PROPOSAL_SCHEMA,
  assertApplicationActionCapabilityRegistryPort,
  validateApplicationActionCapability,
  validateApplicationActionProposal,
} from "../../contracts/application-action-capability.mjs";
import {
  assertApplicationIntelligenceAwarenessPort,
  validateApplicationIntelligenceAwareness,
} from "../../contracts/application-intelligence-awareness.mjs";
import { INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS } from "../../contracts/intelligence.mjs";

const MAX_CAPABILITIES = 512;
const CONTEXT_BUDGET = Math.min(7600, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
const RESOURCE_GRANT_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]{0,31}$/;
const EMPTY_LIST = Object.freeze([]);

function capabilityKey(appId, actionId) {
  return `${appId}\u0000${actionId}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function capabilitySha256(capability) {
  return createHash("sha256").update(canonicalJson(capability), "utf8").digest("hex");
}

function validateArgument(parameter, value) {
  if (parameter.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`Application action argument ${parameter.id} must be boolean`);
    return value;
  }
  if (parameter.type === "integer") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`Application action argument ${parameter.id} must be a safe integer`);
    if (parameter.minimum !== null && value < parameter.minimum) throw new TypeError(`Application action argument ${parameter.id} is below minimum`);
    if (parameter.maximum !== null && value > parameter.maximum) throw new TypeError(`Application action argument ${parameter.id} is above maximum`);
    return value;
  }
  if (parameter.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Application action argument ${parameter.id} must be finite`);
    if (parameter.minimum !== null && value < parameter.minimum) throw new TypeError(`Application action argument ${parameter.id} is below minimum`);
    if (parameter.maximum !== null && value > parameter.maximum) throw new TypeError(`Application action argument ${parameter.id} is above maximum`);
    return value;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > (parameter.maxLength ?? 8192) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`Application action argument ${parameter.id} is invalid`);
  }
  if (parameter.type === "enum" && !parameter.values.includes(value)) {
    throw new TypeError(`Application action argument ${parameter.id} is outside the declared enum`);
  }
  if (parameter.type === "uri") {
    const separator = value.indexOf(":");
    const scheme = separator > 0 ? value.slice(0, separator) : "";
    if (!URI_SCHEME_RE.test(scheme) || !parameter.schemes.includes(scheme)) {
      throw new TypeError(`Application action argument ${parameter.id} uses an undeclared URI scheme`);
    }
  }
  if (parameter.type === "resource-grant-id" && !RESOURCE_GRANT_ID_RE.test(value)) {
    throw new TypeError(`Application action argument ${parameter.id} must be an opaque resource grant id`);
  }
  return value;
}

function validateArguments(capability, argumentsValue) {
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new TypeError("Application action proposal arguments must be an object");
  }
  const declared = new Map(capability.parameters.map((parameter) => [parameter.id, parameter]));
  for (const key of Object.keys(argumentsValue)) {
    if (!declared.has(key)) throw new TypeError(`Application action proposal contains undeclared argument: ${key}`);
  }
  const normalized = {};
  for (const parameter of capability.parameters) {
    const present = Object.prototype.hasOwnProperty.call(argumentsValue, parameter.id);
    if (!present) {
      if (parameter.required) throw new TypeError(`Application action proposal is missing required argument: ${parameter.id}`);
      continue;
    }
    normalized[parameter.id] = validateArgument(parameter, argumentsValue[parameter.id]);
  }
  return Object.freeze(normalized);
}

function parameterContextProjection(parameter) {
  const projection = { id: parameter.id, type: parameter.type, required: parameter.required };
  if (parameter.maxLength !== null) projection.maxLength = parameter.maxLength;
  if (parameter.minimum !== null) projection.minimum = parameter.minimum;
  if (parameter.maximum !== null) projection.maximum = parameter.maximum;
  if (parameter.values !== null) projection.values = [...parameter.values];
  if (parameter.schemes !== null) projection.schemes = [...parameter.schemes];
  return projection;
}

function contextProjection(capability) {
  return {
    appId: capability.appId,
    actionId: capability.actionId,
    title: capability.title,
    parameters: capability.parameters.map(parameterContextProjection),
    riskClass: capability.riskClass,
    confirmation: capability.confirmation,
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  };
}

function capabilityContextItem(capabilities) {
  const actions = [];
  let omitted = 0;
  for (const capability of capabilities) {
    const candidate = contextProjection(capability);
    const next = JSON.stringify({
      actions: [...actions, candidate],
      omitted: Math.max(0, capabilities.length - actions.length - 1),
      authority: "none",
      toolExecution: false,
    });
    if (next.length > CONTEXT_BUDGET) {
      omitted = capabilities.length - actions.length;
      break;
    }
    actions.push(candidate);
  }
  const text = JSON.stringify({ actions, omitted, authority: "none", toolExecution: false });
  if (text.length > CONTEXT_BUDGET) throw new TypeError("Application action capability context exceeded its bounded projection");
  return Object.freeze({
    id: "ordax-application-action-capabilities",
    scope: "system",
    text,
    provenance: "ordax-application-action-capability-registry",
  });
}

export function createApplicationActionCapabilityRegistry({ awareness, capabilities = [] } = {}) {
  assertApplicationIntelligenceAwarenessPort(awareness);
  if (!Array.isArray(capabilities) || capabilities.length > MAX_CAPABILITIES) {
    throw new TypeError("Application action capability catalog is outside bounds");
  }

  const awareById = new Map();
  for (const raw of awareness.list()) {
    const descriptor = validateApplicationIntelligenceAwareness(raw);
    if (awareById.has(descriptor.appId)) throw new TypeError(`Application action awareness app id collision: ${descriptor.appId}`);
    awareById.set(descriptor.appId, descriptor);
  }

  const frozen = Object.freeze(capabilities.map((raw) => {
    const capability = validateApplicationActionCapability(raw);
    const app = awareById.get(capability.appId);
    if (!app) throw new TypeError(`Application action capability references unknown app: ${capability.appId}`);
    if (app.sourceClass !== capability.sourceClass || app.platform !== capability.platform) {
      throw new TypeError(`Application action capability identity binding drifted for ${capability.appId}`);
    }
    if (app.sourceClass === "installed" && app.payloadSha256 !== capability.binding.payloadSha256) {
      throw new TypeError(`Application action capability payload binding drifted for ${capability.appId}`);
    }
    if (app.sourceClass === "first-party" && capability.binding.payloadSha256 !== null) {
      throw new TypeError(`First-party application action capability has foreign payload binding: ${capability.appId}`);
    }
    return capability;
  }));

  const byKey = new Map();
  const byApp = new Map();
  const digestByKey = new Map();
  for (const capability of frozen) {
    const key = capabilityKey(capability.appId, capability.actionId);
    if (byKey.has(key)) throw new TypeError(`Duplicate application action capability: ${capability.appId}/${capability.actionId}`);
    byKey.set(key, capability);
    digestByKey.set(key, capabilitySha256(capability));
    const values = byApp.get(capability.appId) ?? [];
    values.push(capability);
    byApp.set(capability.appId, values);
  }
  for (const [appId, values] of byApp) byApp.set(appId, Object.freeze([...values]));

  const port = {
    schema: APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
    list() {
      return frozen;
    },
    get(appId, actionId) {
      if (typeof appId !== "string" || typeof actionId !== "string") return null;
      return byKey.get(capabilityKey(appId, actionId)) ?? null;
    },
    listForApp(appId) {
      if (typeof appId !== "string") return EMPTY_LIST;
      return byApp.get(appId) ?? EMPTY_LIST;
    },
    propose(appId, actionId, argumentsValue = {}) {
      const key = capabilityKey(appId, actionId);
      const capability = byKey.get(key);
      if (!capability) throw new TypeError("Application action capability is not declared for this app");
      const normalizedArguments = validateArguments(capability, argumentsValue);
      return validateApplicationActionProposal({
        schema: APPLICATION_ACTION_PROPOSAL_SCHEMA,
        appId: capability.appId,
        actionId: capability.actionId,
        arguments: normalizedArguments,
        riskClass: capability.riskClass,
        confirmation: capability.confirmation,
        capabilitySha256: digestByKey.get(key),
        capabilityProvenance: capability.provenance,
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      });
    },
    contextItem() {
      return capabilityContextItem(frozen);
    },
  };

  assertApplicationActionCapabilityRegistryPort(port);
  return Object.freeze(port);
}

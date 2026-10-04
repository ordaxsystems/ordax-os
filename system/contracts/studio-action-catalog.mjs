import { validateDeviceActionRequest } from "./device-action-envelope.mjs";

export const STUDIO_ACTION_CATALOG_SCHEMA = "ordax.studio-action-catalog/1";

const MODE_VALUES = new Set(["read", "write"]);
const SCOPE_VALUES = new Set(["project", "device"]);
const CONFIRMATION_VALUES = new Set(["none", "policy-gated", "always"]);
const ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const PARAMETER_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_FIELDS = new Set([
  "execute",
  "localAction",
  "deviceAgent",
  "grant",
  "authorization",
  "provider",
  "command",
  "shell",
]);

function boundedId(value, label, max = 120) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !ID_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateParameter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio action parameter must be an object");
  }
  const fields = Object.keys(value);
  if (fields.some((field) => !["id", "required"].includes(field))) {
    throw new TypeError("Studio action parameter contains incompatible fields");
  }
  if (typeof value.id !== "string" || !PARAMETER_RE.test(value.id)) {
    throw new TypeError("Studio action parameter id is invalid");
  }
  if (typeof value.required !== "boolean") {
    throw new TypeError("Studio action parameter required flag is invalid");
  }
  return Object.freeze({ id: value.id, required: value.required });
}

export function validateStudioActionBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio action binding must be an object");
  }
  const fields = Object.keys(value);
  if (fields.some((field) => ![
    "capability",
    "operation",
    "mode",
    "scope",
    "confirmation",
    "parameters",
  ].includes(field))) {
    throw new TypeError("Studio action binding contains incompatible fields");
  }
  if (fields.some((field) => FORBIDDEN_FIELDS.has(field))) {
    throw new TypeError("Studio action binding exposes forbidden authority");
  }
  if (!MODE_VALUES.has(value.mode)) {
    throw new TypeError("Studio action binding mode is invalid");
  }
  if (!SCOPE_VALUES.has(value.scope)) {
    throw new TypeError("Studio action binding scope is invalid");
  }
  if (!CONFIRMATION_VALUES.has(value.confirmation)) {
    throw new TypeError("Studio action binding confirmation is invalid");
  }
  if (value.mode === "write" && value.confirmation === "none") {
    throw new TypeError("Studio write actions require policy or explicit confirmation");
  }
  if (!Array.isArray(value.parameters) || value.parameters.length > 24) {
    throw new TypeError("Studio action binding parameters are invalid");
  }
  const parameters = Object.freeze(value.parameters.map(validateParameter));
  if (new Set(parameters.map((item) => item.id)).size !== parameters.length) {
    throw new TypeError("Studio action binding parameter ids must be unique");
  }
  return Object.freeze({
    capability: boundedId(value.capability, "Studio action capability"),
    operation: boundedId(value.operation, "Studio action operation", 96),
    mode: value.mode,
    scope: value.scope,
    confirmation: value.confirmation,
    parameters,
  });
}

function parameter(id, required = false) {
  return Object.freeze({ id, required });
}

const ENTRIES = [
  {
    capability: "files.read",
    operation: "inventory.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [parameter("max_depth"), parameter("max_entries")],
  },
  {
    capability: "files.read",
    operation: "text.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [parameter("path", true)],
  },
  {
    capability: "files.write",
    operation: "text.write",
    mode: "write",
    scope: "project",
    confirmation: "policy-gated",
    parameters: [parameter("path", true), parameter("content", true), parameter("expected_sha256"), parameter("create")],
  },
  {
    capability: "files.read",
    operation: "text.search",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [parameter("query", true), parameter("max_results")],
  },
  {
    capability: "preview.read",
    operation: "status.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
  {
    capability: "preview.control",
    operation: "start",
    mode: "write",
    scope: "project",
    confirmation: "policy-gated",
    parameters: [],
  },
  {
    capability: "preview.control",
    operation: "stop",
    mode: "write",
    scope: "project",
    confirmation: "policy-gated",
    parameters: [],
  },
  {
    capability: "preview.capture",
    operation: "capture",
    mode: "write",
    scope: "project",
    confirmation: "policy-gated",
    parameters: [],
  },
  {
    capability: "preview.read",
    operation: "logs.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [parameter("max_bytes")],
  },
  {
    capability: "preview.read",
    operation: "image.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
  {
    capability: "execution.read",
    operation: "status.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
  {
    capability: "runtime.read",
    operation: "health.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
  {
    capability: "runtime.read",
    operation: "briefing.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
  {
    capability: "git.read",
    operation: "diff.read",
    mode: "read",
    scope: "project",
    confirmation: "none",
    parameters: [],
  },
].map(validateStudioActionBinding);

export const STUDIO_ACTION_CATALOG = Object.freeze({
  schema: STUDIO_ACTION_CATALOG_SCHEMA,
  authority: "none",
  entries: Object.freeze(ENTRIES),
});

export function validateStudioActionCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio action catalog must be an object");
  }
  if (value.schema !== STUDIO_ACTION_CATALOG_SCHEMA || value.authority !== "none") {
    throw new TypeError("Studio action catalog schema/authority is invalid");
  }
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 64) {
    throw new TypeError("Studio action catalog entries are invalid");
  }
  const entries = Object.freeze(value.entries.map(validateStudioActionBinding));
  const keys = entries.map((entry) => `${entry.capability}\0${entry.operation}`);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("Studio action catalog bindings must be unique");
  }
  return Object.freeze({ schema: STUDIO_ACTION_CATALOG_SCHEMA, authority: "none", entries });
}

export function studioActionBinding(capability, operation) {
  const catalog = validateStudioActionCatalog(STUDIO_ACTION_CATALOG);
  return catalog.entries.find(
    (entry) => entry.capability === capability && entry.operation === operation,
  ) ?? null;
}

export function validateStudioActionCatalogRequest(value) {
  const request = validateDeviceActionRequest(value);
  const binding = studioActionBinding(request.capability, request.operation);
  if (!binding) {
    throw new TypeError("Device action capability/operation pair is not in the Studio action catalog");
  }
  const allowed = new Set(binding.parameters.map((item) => item.id));
  const required = binding.parameters.filter((item) => item.required).map((item) => item.id);
  const provided = Object.keys(request.parameters);
  const unsupported = provided.filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new TypeError(`Device action contains unsupported Studio parameter(s): ${unsupported.join(", ")}`);
  }
  const missing = required.filter((field) => !provided.includes(field));
  if (missing.length) {
    throw new TypeError(`Device action is missing required Studio parameter(s): ${missing.join(", ")}`);
  }
  return Object.freeze({ request, binding });
}

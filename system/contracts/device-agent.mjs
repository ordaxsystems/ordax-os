export const DEVICE_AGENT_PORT_SCHEMA = "ordax.device-agent/1";
export const DEVICE_AGENT_CAPABILITIES_SCHEMA = "ordax.device-agent-capabilities/1";
export const DEVICE_AGENT_CAPABILITY_READER_SCHEMA = "ordax.device-agent-capability-reader/1";

const SOURCE_TYPES = new Set(["local", "github", "hybrid"]);
const CLIENTS = new Set(["ordax-local", "ordax-web", "ordax-mobile", "ordax-desktop", "ordax-native", "mcp"]);
const MODES = new Set(["read", "write"]);
const CAPABILITY_STATES = new Set(["ready", "degraded"]);
const FORBIDDEN_CAPABILITIES = new Set([
  "shell.generic",
  "disk.raw",
  "release.signing-key",
  "admin.implicit",
]);

function boundedText(value, label, max = 180) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function validateCapabilityDescriptor(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Device capability[${index}] must be an object`);
  }
  exactKeys(value, ["id", "modes"], `Device capability[${index}]`);
  const id = boundedText(value.id, `Device capability[${index}] id`, 120);
  if (FORBIDDEN_CAPABILITIES.has(id)) {
    throw new TypeError("Forbidden capability cannot cross the product Device Agent boundary");
  }
  if (!Array.isArray(value.modes) || value.modes.length < 1 || value.modes.length > 2) {
    throw new TypeError(`Device capability[${index}] modes are invalid`);
  }
  const modes = value.modes.map((mode) => {
    if (!MODES.has(mode)) throw new TypeError(`Device capability[${index}] mode is invalid`);
    return mode;
  });
  if (new Set(modes).size !== modes.length) {
    throw new TypeError(`Device capability[${index}] modes must be unique`);
  }
  return Object.freeze({ id, modes: Object.freeze([...modes]) });
}

export function validateDeviceAgentCapabilitiesSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device Agent capabilities snapshot must be an object");
  }
  exactKeys(value, ["schema", "state", "capabilities"], "Device Agent capabilities snapshot");
  if (value.schema !== DEVICE_AGENT_CAPABILITIES_SCHEMA) {
    throw new TypeError("Device Agent capabilities snapshot schema is incompatible");
  }
  if (!CAPABILITY_STATES.has(value.state)) {
    throw new TypeError("Device Agent capabilities snapshot state is invalid");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 64) {
    throw new TypeError("Device Agent capabilities must be a bounded array");
  }
  const capabilities = value.capabilities.map(validateCapabilityDescriptor);
  const ids = capabilities.map((capability) => capability.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Device Agent capability ids must be unique");
  }
  return Object.freeze({
    schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
    state: value.state,
    capabilities: Object.freeze(capabilities),
  });
}

export function validateDeviceProjectBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device project binding must be an object");
  }

  const sourceType = value.sourceType ?? "local";
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new TypeError("Device project source type is invalid");
  }

  const localRequired = sourceType === "local" || sourceType === "hybrid";
  const githubRequired = sourceType === "github" || sourceType === "hybrid";

  if (localRequired && value.localRegistered !== true) {
    throw new TypeError("Local projects must be registered on the device");
  }
  if (githubRequired && !value.githubRepositoryId) {
    throw new TypeError("GitHub project binding requires a selected repository id");
  }

  return Object.freeze({
    schema: DEVICE_AGENT_PORT_SCHEMA,
    projectId: boundedText(value.projectId, "Project id"),
    deviceId: localRequired ? boundedText(value.deviceId, "Device id") : null,
    sourceType,
    localRegistered: localRequired,
    githubRepositoryId: githubRequired
      ? boundedText(value.githubRepositoryId, "GitHub repository id")
      : null,
  });
}

export function validateDeviceCapabilityGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device capability grant must be an object");
  }
  if (!CLIENTS.has(value.client) || !MODES.has(value.mode)) {
    throw new TypeError("Device capability client/mode is invalid");
  }

  const capability = boundedText(value.capability, "Capability", 120);
  if (FORBIDDEN_CAPABILITIES.has(capability)) {
    throw new TypeError("Capability is forbidden through the product remote boundary");
  }
  if (value.mode === "write" && value.approved !== true) {
    throw new TypeError("Remote write capability requires explicit approval");
  }

  return Object.freeze({
    schema: DEVICE_AGENT_PORT_SCHEMA,
    accountId: boundedText(value.accountId, "Account id"),
    spaceId: boundedText(value.spaceId, "Space id"),
    projectId: boundedText(value.projectId, "Project id"),
    deviceId: boundedText(value.deviceId, "Device id"),
    client: value.client,
    capability,
    mode: value.mode,
    approved: value.mode === "write" ? true : value.approved === true,
    actionGateway: "ordax",
  });
}

export function assertDeviceAgentPort(port) {
  if (!port || typeof port !== "object" || port.schema !== DEVICE_AGENT_PORT_SCHEMA) {
    throw new TypeError("Compatible OrdaX Device Agent port is required");
  }
  if (typeof port.execute !== "function" || typeof port.capabilities !== "function") {
    throw new TypeError("Device Agent port must implement execute() and capabilities()");
  }
  return port;
}

export function assertDeviceAgentCapabilityReaderPort(port) {
  if (!port || typeof port !== "object" || port.schema !== DEVICE_AGENT_CAPABILITY_READER_SCHEMA) {
    throw new TypeError("Compatible Device Agent capability reader is required");
  }
  if (typeof port.capabilities !== "function") {
    throw new TypeError("Device Agent capability reader must implement capabilities()");
  }
  if ("execute" in port) {
    throw new TypeError("Device Agent capability reader must not expose execute()");
  }
  return port;
}

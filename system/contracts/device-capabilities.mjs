export const DEVICE_AGENT_CAPABILITIES_SCHEMA = "ordax.device-agent-capabilities/1";
export const DEVICE_AGENT_CAPABILITY_READER_SCHEMA = "ordax.device-agent-capability-reader/1";

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

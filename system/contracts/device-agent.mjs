import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "./device-capabilities.mjs";

export {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "./device-capabilities.mjs";

export const DEVICE_AGENT_PORT_SCHEMA = "ordax.device-agent/1";

const SOURCE_TYPES = new Set(["local", "github", "hybrid"]);
const CLIENTS = new Set(["ordax-local", "ordax-web", "ordax-mobile", "ordax-desktop", "ordax-native", "mcp"]);
const MODES = new Set(["read", "write"]);
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

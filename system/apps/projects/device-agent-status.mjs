import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "../../contracts/device-capabilities.mjs";

export const PROJECTS_DEVICE_AGENT_STATUS_SCHEMA = "ordax.projects-device-agent-status/1";
const DEFAULT_TIMEOUT_MS = 1500;

function timeoutValue(value) {
  if (!Number.isSafeInteger(value) || value < 10 || value > 5000) {
    throw new TypeError("Projects Device Agent timeout must be between 10 and 5000 ms");
  }
  return value;
}

function status(state, capabilityCount = 0, readCount = 0, writeCount = 0) {
  return Object.freeze({
    schema: PROJECTS_DEVICE_AGENT_STATUS_SCHEMA,
    state,
    capabilityCount,
    readCount,
    writeCount,
    mutationAuthority: "none",
  });
}

export function validateProjectsDeviceAgentStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Projects Device Agent status must be an object");
  }
  if (value.schema !== PROJECTS_DEVICE_AGENT_STATUS_SCHEMA) {
    throw new TypeError("Projects Device Agent status schema is incompatible");
  }
  if (value.state !== "ready" && value.state !== "degraded") {
    throw new TypeError("Projects Device Agent status state is invalid");
  }
  for (const key of ["capabilityCount", "readCount", "writeCount"]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 64) {
      throw new TypeError(`Projects Device Agent ${key} is invalid`);
    }
  }
  if (value.readCount > value.capabilityCount || value.writeCount > value.capabilityCount) {
    throw new TypeError("Projects Device Agent capability counts are inconsistent");
  }
  if (value.mutationAuthority !== "none") {
    throw new TypeError("Projects Device Agent status cannot grant mutation authority");
  }
  return Object.freeze({
    schema: PROJECTS_DEVICE_AGENT_STATUS_SCHEMA,
    state: value.state,
    capabilityCount: value.capabilityCount,
    readCount: value.readCount,
    writeCount: value.writeCount,
    mutationAuthority: "none",
  });
}

export async function probeProjectsDeviceAgent(deviceAgentCapabilitiesValue, {
  timeoutMs: requestedTimeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (deviceAgentCapabilitiesValue == null) return null;
  const timeoutMs = timeoutValue(requestedTimeout);

  let timer = null;
  try {
    const capabilityReader = assertDeviceAgentCapabilityReaderPort(deviceAgentCapabilitiesValue);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Device Agent capability probe timed out")), timeoutMs);
    });
    const raw = await Promise.race([
      Promise.resolve(capabilityReader.capabilities({ client: "ordax-local" })),
      timeout,
    ]);
    const snapshot = validateDeviceAgentCapabilitiesSnapshot(raw);
    const readCount = snapshot.capabilities.filter((entry) => entry.modes.includes("read")).length;
    const writeCount = snapshot.capabilities.filter((entry) => entry.modes.includes("write")).length;
    return status(snapshot.state, snapshot.capabilities.length, readCount, writeCount);
  } catch {
    return status("degraded");
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "../../contracts/device-agent.mjs";

export const STUDIO_DEVICE_AGENT_STATUS_SCHEMA = "ordax.studio-device-agent-status/1";
const DEFAULT_TIMEOUT_MS = 1500;

function boundedTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 10 || value > 5000) {
    throw new TypeError("Studio Device Agent timeout must be between 10 and 5000 ms");
  }
  return value;
}

function createStatus(state, capabilities = []) {
  const readCount = capabilities.filter((item) => item.modes.includes("read")).length;
  const writeCount = capabilities.filter((item) => item.modes.includes("write")).length;
  return Object.freeze({
    schema: STUDIO_DEVICE_AGENT_STATUS_SCHEMA,
    state,
    capabilityCount: capabilities.length,
    readCount,
    writeCount,
    mutationAuthority: "none",
    capabilityIds: Object.freeze(capabilities.map((item) => item.id)),
  });
}

export async function probeStudioDeviceAgent(deviceAgentCapabilitiesValue, {
  timeoutMs: requestedTimeout = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (deviceAgentCapabilitiesValue == null) return createStatus("unavailable");
  const timeoutMs = boundedTimeout(requestedTimeout);
  let timer = null;
  try {
    const reader = assertDeviceAgentCapabilityReaderPort(deviceAgentCapabilitiesValue);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Studio Device Agent probe timed out")), timeoutMs);
    });
    const raw = await Promise.race([
      Promise.resolve(reader.capabilities({ client: "ordax-local" })),
      timeout,
    ]);
    const snapshot = validateDeviceAgentCapabilitiesSnapshot(raw);
    return createStatus(snapshot.state, snapshot.capabilities);
  } catch {
    return createStatus("degraded");
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "./device-capabilities.mjs";
import {
  validateDeviceActionReceipt,
  validateDeviceActionRequest,
} from "./device-action-envelope.mjs";
import { assertProjectCatalogPort } from "./project-catalog.mjs";

export const STUDIO_RUNTIME_PORT_SCHEMA = "ordax.studio-runtime/1";

export function assertStudioRuntimePort(port) {
  if (!port || typeof port !== "object" || port.schema !== STUDIO_RUNTIME_PORT_SCHEMA) {
    throw new TypeError("A compatible Studio runtime port is required");
  }
  if ("execute" in port || "deviceAgent" in port) {
    throw new TypeError("Studio runtime port must not expose raw device execution");
  }
  assertDeviceAgentCapabilityReaderPort(port.capabilityReader);
  assertProjectCatalogPort(port.projectCatalog);
  if (typeof port.requestAction !== "function") {
    throw new TypeError("Studio runtime port must implement requestAction(request)");
  }
  return port;
}

export async function readStudioRuntimeCapabilities(portValue) {
  const port = assertStudioRuntimePort(portValue);
  return validateDeviceAgentCapabilitiesSnapshot(await port.capabilityReader.capabilities());
}

export async function requestStudioDeviceAction(portValue, requestValue) {
  const port = assertStudioRuntimePort(portValue);
  const request = validateDeviceActionRequest(requestValue);
  const receipt = validateDeviceActionReceipt(await port.requestAction(request));
  if (receipt.actionId !== request.actionId || receipt.deviceId !== request.deviceId) {
    throw new TypeError("Studio action receipt does not match its request");
  }
  return receipt;
}

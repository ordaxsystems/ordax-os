import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "./device-capabilities.mjs";
import {
  validateDeviceActionReceipt,
  validateDeviceActionRequestV2,
} from "./device-action-envelope-v2.mjs";
import { assertProjectCatalogPort } from "./project-catalog.mjs";

export const STUDIO_RUNTIME_V2_PORT_SCHEMA = "ordax.studio-runtime/2";

export function assertStudioRuntimeV2Port(port) {
  if (!port || typeof port !== "object" || port.schema !== STUDIO_RUNTIME_V2_PORT_SCHEMA) {
    throw new TypeError("A compatible Studio runtime v2 port is required");
  }
  if ("execute" in port || "deviceAgent" in port || "call" in port) {
    throw new TypeError("Studio runtime v2 port must not expose raw or generic dispatch");
  }
  assertDeviceAgentCapabilityReaderPort(port.capabilityReader);
  assertProjectCatalogPort(port.projectCatalog);
  if (typeof port.requestAction !== "function") {
    throw new TypeError("Studio runtime v2 port must implement requestAction(request)");
  }
  return port;
}

export async function readStudioRuntimeV2Capabilities(portValue) {
  const port = assertStudioRuntimeV2Port(portValue);
  return validateDeviceAgentCapabilitiesSnapshot(await port.capabilityReader.capabilities());
}

export async function requestStudioDeviceActionV2(portValue, requestValue) {
  const port = assertStudioRuntimeV2Port(portValue);
  const request = validateDeviceActionRequestV2(requestValue);
  const receipt = validateDeviceActionReceipt(await port.requestAction(request));
  if (receipt.actionId !== request.actionId || receipt.deviceId !== request.deviceId) {
    throw new TypeError("Studio action receipt does not match its request");
  }
  return receipt;
}

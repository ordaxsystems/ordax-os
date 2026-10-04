import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "./device-capabilities.mjs";
import {
  validateDeviceActionReceipt,
  validateDeviceActionRequestV2,
} from "./device-action-envelope-v2.mjs";
import { validateDeviceActionResult } from "./device-action-result.mjs";
import { assertProjectCatalogPort } from "./project-catalog.mjs";
import { validateStudioActionContext } from "./studio-action-context.mjs";

export const STUDIO_RUNTIME_V3_PORT_SCHEMA = "ordax.studio-runtime/3";

const ACTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function assertStudioRuntimeV3Port(port) {
  if (!port || typeof port !== "object" || port.schema !== STUDIO_RUNTIME_V3_PORT_SCHEMA) {
    throw new TypeError("A compatible Studio runtime v3 port is required");
  }
  if ("execute" in port || "deviceAgent" in port || "call" in port) {
    throw new TypeError("Studio runtime v3 port must not expose raw or generic dispatch");
  }
  assertDeviceAgentCapabilityReaderPort(port.capabilityReader);
  assertProjectCatalogPort(port.projectCatalog);
  if (typeof port.getActionContext !== "function") {
    throw new TypeError("Studio runtime v3 port must implement getActionContext()");
  }
  if (typeof port.requestAction !== "function") {
    throw new TypeError("Studio runtime v3 port must implement requestAction(request)");
  }
  if (typeof port.getActionResult !== "function") {
    throw new TypeError("Studio runtime v3 port must implement getActionResult(actionId)");
  }
  return port;
}

export async function readStudioRuntimeV3Capabilities(portValue) {
  const port = assertStudioRuntimeV3Port(portValue);
  return validateDeviceAgentCapabilitiesSnapshot(await port.capabilityReader.capabilities());
}

export async function readStudioActionContextV3(portValue) {
  const port = assertStudioRuntimeV3Port(portValue);
  return validateStudioActionContext(await port.getActionContext());
}

export async function requestStudioDeviceActionV3(portValue, requestValue) {
  const port = assertStudioRuntimeV3Port(portValue);
  const request = validateDeviceActionRequestV2(requestValue);
  const context = validateStudioActionContext(await port.getActionContext());
  if (
    request.actor.kind !== context.actor.kind
    || request.actor.subjectId !== context.actor.subjectId
    || request.deviceId !== context.deviceId
    || request.client !== context.client
    || request.spaceId !== context.spaceId
  ) {
    throw new TypeError("Studio action request identity does not match host context");
  }
  const receipt = validateDeviceActionReceipt(await port.requestAction(request));
  if (receipt.actionId !== request.actionId || receipt.deviceId !== request.deviceId) {
    throw new TypeError("Studio action receipt does not match its request");
  }
  return receipt;
}

export async function readStudioDeviceActionResult(portValue, actionIdValue) {
  const port = assertStudioRuntimeV3Port(portValue);
  if (typeof actionIdValue !== "string" || !ACTION_ID_RE.test(actionIdValue)) {
    throw new TypeError("Studio action result id is invalid");
  }
  const context = validateStudioActionContext(await port.getActionContext());
  const result = validateDeviceActionResult(await port.getActionResult(actionIdValue));
  if (result.receipt.actionId !== actionIdValue) {
    throw new TypeError("Studio action result does not match requested action id");
  }
  if (result.receipt.deviceId !== context.deviceId) {
    throw new TypeError("Studio action result device does not match host context");
  }
  return result;
}

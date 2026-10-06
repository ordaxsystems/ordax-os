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

function assertRequestMatchesContext(request, context) {
  if (
    request.actor.kind !== context.actor.kind
    || request.actor.subjectId !== context.actor.subjectId
    || request.deviceId !== context.deviceId
    || request.client !== context.client
    || request.spaceId !== context.spaceId
  ) {
    throw new TypeError("Studio action request identity does not match host context");
  }
}

function assertResultMatchesRequest(result, request) {
  const binding = result.binding;
  if (
    binding.actionId !== request.actionId
    || binding.actor.kind !== request.actor.kind
    || binding.actor.subjectId !== request.actor.subjectId
    || binding.spaceId !== request.spaceId
    || binding.projectId !== request.projectId
    || binding.deviceId !== request.deviceId
    || binding.client !== request.client
  ) {
    throw new TypeError("Studio action result binding does not match its request");
  }
  if (result.receipt.actionId !== request.actionId || result.receipt.deviceId !== request.deviceId) {
    throw new TypeError("Studio action result receipt does not match its request");
  }
}

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
    throw new TypeError("Studio runtime v3 port must implement getActionResult(request)");
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
  assertRequestMatchesContext(request, context);
  const receipt = validateDeviceActionReceipt(await port.requestAction(request));
  if (receipt.actionId !== request.actionId || receipt.deviceId !== request.deviceId) {
    throw new TypeError("Studio action receipt does not match its request");
  }
  return receipt;
}

export async function readStudioDeviceActionResult(portValue, requestValue) {
  const port = assertStudioRuntimeV3Port(portValue);
  const request = validateDeviceActionRequestV2(requestValue);
  const context = validateStudioActionContext(await port.getActionContext());
  assertRequestMatchesContext(request, context);
  const result = validateDeviceActionResult(await port.getActionResult(request));
  assertResultMatchesRequest(result, request);
  return result;
}

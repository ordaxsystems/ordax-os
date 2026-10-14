import {
  INTELLIGENCE_PORT_SCHEMA,
  validateIntelligenceRequest,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";

export const WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA =
  "ordax.web-intelligence-remote-transport/1";
export const WEB_INTELLIGENCE_REMOTE_REQUEST_SCHEMA =
  "ordax.web-intelligence-remote-request/1";
export const WEB_INTELLIGENCE_REMOTE_RESPONSE_SCHEMA =
  "ordax.web-intelligence-remote-response/1";

function boundedId(value, label, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateWebIntelligenceRemoteContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Web Intelligence remote context must be an object");
  }
  if (!Object.hasOwn(value, "spaceId") || !Object.hasOwn(value, "projectId")) {
    throw new TypeError("Web Intelligence remote context must state Space and project explicitly");
  }
  return Object.freeze({
    subjectId: boundedId(value.subjectId, "Web Intelligence subjectId"),
    targetDeviceId: boundedId(value.targetDeviceId, "Web Intelligence targetDeviceId"),
    spaceId: boundedId(value.spaceId, "Web Intelligence spaceId", { nullable: true }),
    projectId: boundedId(value.projectId, "Web Intelligence projectId", { nullable: true }),
  });
}

function sameContext(left, right) {
  return left.subjectId === right.subjectId
    && left.targetDeviceId === right.targetDeviceId
    && left.spaceId === right.spaceId
    && left.projectId === right.projectId;
}

function sameSnapshot(left, right) {
  return left.schema === right.schema
    && left.state === right.state
    && left.inferenceAvailable === right.inferenceAvailable
    && left.engineId === right.engineId
    && left.modelId === right.modelId
    && left.authority === right.authority
    && left.toolExecution === right.toolExecution;
}

function assertRemoteTransport(transport) {
  if (!transport || typeof transport !== "object"
    || transport.schema !== WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA) {
    throw new TypeError("Compatible Web Intelligence remote transport is required");
  }
  for (const method of ["getSnapshot", "subscribe", "respond"]) {
    if (typeof transport[method] !== "function") {
      throw new TypeError(`Web Intelligence remote transport must implement ${method}()`);
    }
  }
  validateIntelligenceSnapshot(transport.getSnapshot());
  return transport;
}

function validateResponseEnvelope(value, expectedContext) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.schema !== WEB_INTELLIGENCE_REMOTE_RESPONSE_SCHEMA) {
    throw new TypeError("Web Intelligence remote response envelope is invalid");
  }
  const echoed = validateWebIntelligenceRemoteContext(value.context);
  if (!sameContext(echoed, expectedContext)) {
    throw new Error("Web Intelligence remote response context does not match the request");
  }
  return validateIntelligenceResponse(value.response);
}

/**
 * Projects a supported remote transport into the canonical Intelligence port.
 *
 * This adapter does not discover endpoints, store credentials, choose providers,
 * read Memory or infer a target. The composition/transport owner must provide an
 * authenticated transport and an explicit subject/device/Space/project context.
 */
export function createRemoteWebIntelligencePort({ transport, readContext } = {}) {
  const remote = assertRemoteTransport(transport);
  if (typeof readContext !== "function") {
    throw new TypeError("Web Intelligence remote context reader is required");
  }

  let current = validateIntelligenceSnapshot(remote.getSnapshot());
  let disposed = false;
  const listeners = new Set();
  const releaseRemote = remote.subscribe((snapshot) => {
    const next = validateIntelligenceSnapshot(snapshot);
    if (sameSnapshot(current, next)) return;
    current = next;
    if (!disposed) {
      for (const listener of [...listeners]) listener(current);
    }
  });

  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Ordax Intelligence listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    async respond(value, { signal = null } = {}) {
      if (disposed) throw new Error("Web Intelligence remote adapter is disposed");
      if (!current.inferenceAvailable || !["ready", "busy"].includes(current.state)) {
        throw new Error("Web Intelligence remote transport is unavailable");
      }
      if (signal !== null && (typeof signal !== "object" || typeof signal.aborted !== "boolean")) {
        throw new TypeError("Web Intelligence remote signal is invalid");
      }
      const request = validateIntelligenceRequest(value);
      const context = validateWebIntelligenceRemoteContext(readContext());
      const envelope = Object.freeze({
        schema: WEB_INTELLIGENCE_REMOTE_REQUEST_SCHEMA,
        context,
        request,
      });
      const raw = await remote.respond(envelope, { signal });
      const response = validateResponseEnvelope(raw, context);
      const currentContext = validateWebIntelligenceRemoteContext(readContext());
      if (!sameContext(currentContext, context)) {
        throw new Error("Web Intelligence remote context changed while the request was pending");
      }
      return response;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseRemote();
      listeners.clear();
    },
  });
}

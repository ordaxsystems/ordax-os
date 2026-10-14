import {
  assertIntelligencePort,
  validateIntelligenceRequest,
  validateIntelligenceResponse,
} from "../../contracts/intelligence.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";

export const NATIVE_INTELLIGENCE_SERVICE_SCHEMA =
  "ordax.native-intelligence-service/1";
export const NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA =
  "ordax.native-intelligence-service-request/1";
export const NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA =
  "ordax.native-intelligence-service-response/1";

const REQUEST_KEYS = Object.freeze(["context", "intent", "maxTokens", "prompt"]);
const CONTEXT_ENTRY_KEYS = Object.freeze(["id", "provenance", "scope", "text"]);
const ENVELOPE_KEYS = Object.freeze(["context", "request", "requestId", "schema"]);
const SERVICE_CONTEXT_KEYS = Object.freeze(["projectId", "spaceId", "subjectId"]);

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === expected.join(",");
}

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function nullableId(value, label) {
  if (value === null) return null;
  return boundedText(value, label);
}

function validateServiceContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, SERVICE_CONTEXT_KEYS)) {
    throw new TypeError("Native Intelligence service context fields are incompatible");
  }
  const projectId = nullableId(value.projectId, "Native Intelligence project id");
  if (projectId !== null) {
    throw new Error("Native Intelligence project context is not available yet");
  }
  return Object.freeze({
    subjectId: boundedText(value.subjectId, "Native Intelligence subject id"),
    spaceId: nullableId(value.spaceId, "Native Intelligence Space id"),
    projectId: null,
  });
}

function validateExactRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, REQUEST_KEYS)) {
    throw new TypeError("Native Intelligence request fields are incompatible");
  }
  if (!Array.isArray(value.context)) {
    throw new TypeError("Native Intelligence request context must be an array");
  }
  for (const entry of value.context) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || !exactKeys(entry, CONTEXT_ENTRY_KEYS)) {
      throw new TypeError("Native Intelligence request context fields are incompatible");
    }
  }
  return validateIntelligenceRequest(value);
}

export function validateNativeIntelligenceServiceRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ENVELOPE_KEYS)
    || value.schema !== NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA) {
    throw new TypeError("Native Intelligence service request is incompatible");
  }
  return Object.freeze({
    schema: NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA,
    requestId: boundedText(value.requestId, "Native Intelligence request id"),
    context: validateServiceContext(value.context),
    request: validateExactRequest(value.request),
  });
}

function sameContext(left, right) {
  return left.subjectId === right.subjectId
    && left.spaceId === right.spaceId
    && left.projectId === right.projectId;
}

/**
 * Projects the already-composed Native consumer Intelligence port into a narrow
 * host-callable service boundary. This module owns no provider, model router,
 * Memory, profile policy, target discovery, grants, socket or network endpoint.
 *
 * The supplied Intelligence port must be the final Native consumer port (today
 * `selectedSpaceIntelligence`), so remote/native callers cannot bypass App
 * Intelligence, authorized Profile context or identity-bound Memory wrappers.
 */
export function createNativeIntelligenceService({
  intelligencePort,
  identitySessionPort,
  spaceSelectionPort,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const identitySession = assertIdentitySessionPort(identitySessionPort);
  const spaceSelection = assertSpaceSelectionPort(spaceSelectionPort);

  const readCurrentContext = () => {
    const identity = validateIdentitySessionSnapshot(identitySession.getSnapshot());
    if (identity.state !== "signed-in") {
      throw new Error("Native Intelligence service requires a signed-in identity");
    }
    const selection = validateSpaceSelectionSnapshot(spaceSelection.getSnapshot());
    if (selection.state === "unavailable" || selection.subjectId !== identity.subjectId) {
      throw new Error("Native Intelligence Space selection is unavailable for the signed-in identity");
    }
    return Object.freeze({
      subjectId: identity.subjectId,
      spaceId: selection.state === "selected" ? selection.selectedSpace.id : null,
      projectId: null,
    });
  };

  return Object.freeze({
    schema: NATIVE_INTELLIGENCE_SERVICE_SCHEMA,
    async respond(value) {
      const envelope = validateNativeIntelligenceServiceRequest(value);
      const before = readCurrentContext();
      if (!sameContext(envelope.context, before)) {
        throw new Error("Native Intelligence request context does not match current identity/Space");
      }
      const response = validateIntelligenceResponse(
        await intelligence.respond(envelope.request),
      );
      const after = readCurrentContext();
      if (!sameContext(after, before)) {
        throw new Error("Native Intelligence identity/Space changed while inference was pending");
      }
      return Object.freeze({
        schema: NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA,
        requestId: envelope.requestId,
        context: before,
        response,
      });
    },
  });
}

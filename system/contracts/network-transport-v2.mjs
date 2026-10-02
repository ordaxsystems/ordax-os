import { assertNetworkMessagePlainText } from "./network-message-content-v1.mjs";
import { validateNetworkMutationOutcome } from "./network-mutation-outcome-v2.mjs";

export const NETWORK_TRANSPORT_V2_SCHEMA = "ordax.network-transport/2";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,120}$/;

function boundedId(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

export function validateNetworkSendMessageRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network send request must be an object");
  }
  const senderSpaceId = boundedId(value.senderSpaceId, "Network sender Space id");
  const conversationId = boundedId(value.conversationId, "Network conversation id");
  if (!IDEMPOTENCY_KEY.test(value.idempotencyKey ?? "")) {
    throw new TypeError("Network idempotency key is invalid");
  }
  const body = assertNetworkMessagePlainText(value.body).trim();
  if (!body) {
    throw new TypeError("Network message body cannot be blank");
  }
  return Object.freeze({
    senderSpaceId,
    conversationId,
    idempotencyKey: value.idempotencyKey,
    body,
  });
}

export function validateNetworkSendMessageOutcome(value, expectedIdempotencyKey = null) {
  const outcome = validateNetworkMutationOutcome(value);
  if (outcome.operation !== "message-send") {
    throw new TypeError("Network send outcome operation is incompatible");
  }
  if (
    expectedIdempotencyKey !== null
    && outcome.idempotencyKey !== expectedIdempotencyKey
  ) {
    throw new TypeError("Network send outcome idempotency key mismatch");
  }
  return outcome;
}

export function assertNetworkTransportV2Port(port) {
  if (!port || typeof port !== "object" || port.schema !== NETWORK_TRANSPORT_V2_SCHEMA) {
    throw new TypeError("Compatible Network transport v2 port is required");
  }
  if (typeof port.sendMessage !== "function") {
    throw new TypeError("Network transport v2 port must implement sendMessage()");
  }
  return port;
}

import {
  NETWORK_TRANSPORT_V2_SCHEMA,
  assertNetworkTransportV2Port,
  validateNetworkSendMessageOutcome,
  validateNetworkSendMessageRequest,
} from "../../contracts/network-transport-v2.mjs";

const SEND_ENDPOINT = "/network/v2/messages/send";

async function readJson(response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error("Network gateway returned invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Network gateway returned an invalid payload");
  }
  return value;
}

export function createWebNetworkTransportV2(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web Network transport requires window.fetch");
  }

  const port = {
    schema: NETWORK_TRANSPORT_V2_SCHEMA,
    async sendMessage(input) {
      const request = validateNetworkSendMessageRequest(input);
      const response = await windowRef.fetch(SEND_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          space_id: request.senderSpaceId,
          conversation_id: request.conversationId,
          idempotency_key: request.idempotencyKey,
          body: request.body,
        }),
      });

      if (!response.ok) {
        throw new Error(`Network send transport failed: ${response.status}`);
      }

      const value = await readJson(response);
      return validateNetworkSendMessageOutcome(value, request.idempotencyKey);
    },
  };

  assertNetworkTransportV2Port(port);
  return Object.freeze(port);
}

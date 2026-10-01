import { assertNetworkDraftPort } from "../../contracts/network-draft.mjs";
import {
  assertNetworkTransportV2Port,
  validateNetworkSendMessageRequest,
} from "../../contracts/network-transport-v2.mjs";

export function createNetworkSendRuntime({
  draftPort,
  transport,
  createIdempotencyKey,
} = {}) {
  const draft = assertNetworkDraftPort(draftPort);
  const network = assertNetworkTransportV2Port(transport);
  if (typeof createIdempotencyKey !== "function") {
    throw new TypeError("Network send runtime requires createIdempotencyKey()");
  }

  let sending = false;

  return Object.freeze({
    async send() {
      if (sending) {
        throw new Error("Network message send is already in progress");
      }
      const bound = draft.bindSend();
      const request = validateNetworkSendMessageRequest({
        senderSpaceId: bound.senderSpaceId,
        conversationId: bound.conversationId,
        idempotencyKey: createIdempotencyKey(),
        body: bound.body,
      });

      sending = true;
      try {
        const outcome = await network.sendMessage(request);
        if (outcome.outcome === "applied" || outcome.outcome === "idempotent") {
          draft.clear();
        }
        return outcome;
      } finally {
        sending = false;
      }
    },
  });
}

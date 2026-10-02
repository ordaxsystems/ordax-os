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
  let retryAttempt = null;

  const idempotencyKeyFor = (revision) => {
    if (retryAttempt?.revision === revision) {
      return retryAttempt.idempotencyKey;
    }
    const idempotencyKey = createIdempotencyKey();
    retryAttempt = Object.freeze({ revision, idempotencyKey });
    return idempotencyKey;
  };

  return Object.freeze({
    async send() {
      if (sending) {
        throw new Error("Network message send is already in progress");
      }
      const bound = draft.bindSend();
      const request = validateNetworkSendMessageRequest({
        senderSpaceId: bound.senderSpaceId,
        conversationId: bound.conversationId,
        idempotencyKey: idempotencyKeyFor(bound.revision),
        body: bound.body,
      });

      sending = true;
      try {
        const outcome = await network.sendMessage(request);
        if (outcome.outcome === "applied" || outcome.outcome === "idempotent") {
          draft.clear(bound.revision);
          if (retryAttempt?.revision === bound.revision) {
            retryAttempt = null;
          }
        }
        return outcome;
      } finally {
        sending = false;
      }
    },
  });
}

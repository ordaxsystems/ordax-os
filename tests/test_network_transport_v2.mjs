import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  NETWORK_TRANSPORT_V2_SCHEMA,
  validateNetworkSendMessageRequest,
} from "../system/contracts/network-transport-v2.mjs";
import { createWebNetworkTransportV2 } from "../system/adapters/web/network-transport-v2.mjs";
import { createNetworkDraftRuntime } from "../system/services/professional-network/draft.mjs";
import { createNetworkSendRuntime } from "../system/services/professional-network/send.mjs";

function mutablePort(schema, initial, extra = {}) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    schema,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
    ...extra,
  };
}

function draftFixture() {
  const identity = mutablePort(IDENTITY_SESSION_SCHEMA, {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "Pessoa A",
  });
  const selection = mutablePort(
    SPACE_SELECTION_SCHEMA,
    {
      schema: SPACE_SELECTION_SCHEMA,
      state: "selected",
      subjectId: "user-a",
      selectedSpace: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        name: "Clínica A",
        kind: "professional",
        state: "active",
        ownerId: "user-a",
        profilePack: null,
      },
    },
    {
      select() {},
      clear() {},
    },
  );
  const draft = createNetworkDraftRuntime({
    identitySession: identity,
    spaceSelection: selection,
  });
  draft.begin("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");
  draft.setBody("Mensagem segura");
  return draft;
}

function rawOutcome({
  outcome = "applied",
  code = "message-applied",
  resourceId = "message-00000001",
  retryAfterSeconds = null,
  idempotencyKey = "message-key-00000001",
} = {}) {
  return {
    schema: "prototype-ordax.network-mutation-outcome/2",
    outcome,
    operation: "message-send",
    code,
    resource_id: resourceId,
    retry_after_seconds: retryAfterSeconds,
    idempotency_key: idempotencyKey,
  };
}

test("Network transport request matches the v2 idempotency and plain-text bounds", () => {
  assert.throws(
    () => validateNetworkSendMessageRequest({
      senderSpaceId: "space-a",
      conversationId: "conversation-a",
      idempotencyKey: "short",
      body: "Olá",
    }),
    /idempotency key is invalid/,
  );
  assert.throws(
    () => validateNetworkSendMessageRequest({
      senderSpaceId: "space-a",
      conversationId: "conversation-a",
      idempotencyKey: "message-key-00000001",
      body: "antes\u0001depois",
    }),
    /unsafe control/,
  );
  const value = validateNetworkSendMessageRequest({
    senderSpaceId: " space-a ",
    conversationId: " conversation-a ",
    idempotencyKey: "message-key-00000001",
    body: "  Olá  ",
  });
  assert.deepEqual(value, {
    senderSpaceId: "space-a",
    conversationId: "conversation-a",
    idempotencyKey: "message-key-00000001",
    body: "Olá",
  });
});

test("Web Network transport is same-origin, bounded and validates the v2 outcome", async () => {
  const calls = [];
  const windowRef = {
    async fetch(url, init) {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return rawOutcome();
        },
      };
    },
  };
  const transport = createWebNetworkTransportV2(windowRef);
  assert.equal(transport.schema, NETWORK_TRANSPORT_V2_SCHEMA);

  const outcome = await transport.sendMessage({
    senderSpaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    conversationId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    idempotencyKey: "message-key-00000001",
    body: "Mensagem segura",
  });

  assert.equal(outcome.outcome, "applied");
  assert.equal(outcome.resourceId, "message-00000001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/network/v2/messages/send");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    space_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    conversation_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    idempotency_key: "message-key-00000001",
    body: "Mensagem segura",
  });
});

test("Web Network transport rejects response idempotency drift", async () => {
  const transport = createWebNetworkTransportV2({
    async fetch() {
      return {
        ok: true,
        status: 200,
        async json() {
          return rawOutcome({ idempotencyKey: "message-key-OTHER0001" });
        },
      };
    },
  });

  await assert.rejects(
    () => transport.sendMessage({
      senderSpaceId: "space-a",
      conversationId: "conversation-a",
      idempotencyKey: "message-key-00000001",
      body: "Mensagem",
    }),
    /idempotency key mismatch/,
  );
});

test("successful or idempotent Network send clears the bound draft", async () => {
  for (const outcomeName of ["applied", "idempotent"]) {
    const draft = draftFixture();
    const transport = {
      schema: NETWORK_TRANSPORT_V2_SCHEMA,
      async sendMessage(request) {
        return {
          schema: "prototype-ordax.network-mutation-outcome/2",
          outcome: outcomeName,
          operation: "message-send",
          code: outcomeName === "applied" ? "message-applied" : "message-idempotent",
          resourceId: "message-00000001",
          retryAfterSeconds: null,
          idempotencyKey: request.idempotencyKey,
        };
      },
    };
    const sender = createNetworkSendRuntime({
      draftPort: draft,
      transport,
      createIdempotencyKey: () => "message-key-00000001",
    });

    const result = await sender.send();
    assert.equal(result.outcome, outcomeName);
    assert.equal(draft.getSnapshot().draft, null);
    draft.dispose();
  }
});

test("rate-limited or denied Network send preserves the user's draft", async () => {
  for (const outcomeName of ["rate_limited", "denied"]) {
    const draft = draftFixture();
    const transport = {
      schema: NETWORK_TRANSPORT_V2_SCHEMA,
      async sendMessage(request) {
        return {
          schema: "prototype-ordax.network-mutation-outcome/2",
          outcome: outcomeName,
          operation: "message-send",
          code: outcomeName === "rate_limited" ? "message-rate-limited" : "message-send-denied",
          resourceId: null,
          retryAfterSeconds: outcomeName === "rate_limited" ? 30 : null,
          idempotencyKey: request.idempotencyKey,
        };
      },
    };
    const sender = createNetworkSendRuntime({
      draftPort: draft,
      transport,
      createIdempotencyKey: () => "message-key-00000001",
    });

    const result = await sender.send();
    assert.equal(result.outcome, outcomeName);
    assert.equal(draft.getSnapshot().draft.body, "Mensagem segura");
    draft.dispose();
  }
});

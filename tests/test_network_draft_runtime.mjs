import assert from "node:assert/strict";
import test from "node:test";

import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  NETWORK_DRAFT_SCHEMA,
  createNetworkDraftRuntime,
} from "../system/apps/network/draft-runtime.mjs";

function selectionPort(seed) {
  let snapshot = seed;
  const listeners = new Set();
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    select() {},
    clear() {},
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

const space = (id, name) => ({
  id,
  name,
  kind: "professional",
  state: "active",
  ownerId: "owner-0001",
  profilePack: null,
});

const selected = (id, name = id) => ({
  schema: SPACE_SELECTION_SCHEMA,
  state: "selected",
  subjectId: "subject-0001",
  selectedSpace: space(id, name),
});

test("draft binds the sender Space when text begins", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  const snapshot = draft.setBody("Mensagem");
  assert.equal(snapshot.schema, NETWORK_DRAFT_SCHEMA);
  assert.equal(snapshot.senderSpaceId, "space-a");
  assert.equal(snapshot.activeSpaceId, "space-a");
  assert.equal(snapshot.state, "backend-unavailable");
  assert.equal(snapshot.canSend, false);
});

test("changing Space never silently retargets a pending draft", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  draft.setBody("Mensagem importante");

  selection.set(selected("space-b"));
  const snapshot = draft.getSnapshot();
  assert.equal(snapshot.senderSpaceId, "space-a");
  assert.equal(snapshot.activeSpaceId, "space-b");
  assert.equal(snapshot.state, "sender-changed");
  assert.equal(snapshot.canSend, false);
});

test("sender rebinding is explicit", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  draft.setBody("Mensagem importante");
  selection.set(selected("space-b"));

  const rebound = draft.rebindToActiveSpace();
  assert.equal(rebound.senderSpaceId, "space-b");
  assert.equal(rebound.body, "Mensagem importante");
  assert.equal(rebound.state, "backend-unavailable");
});

test("offline state is honest and blocks transport", async () => {
  let online = false;
  let sends = 0;
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({
    spaceSelection: selection,
    readOnline: () => online,
    transport: { async sendMessage() { sends += 1; return { ok: true }; } },
  });
  draft.setBody("Mensagem");

  assert.equal(draft.getSnapshot().state, "offline");
  await assert.rejects(() => draft.send({ conversationId: "conversation-1", idempotencyKey: "client-key-00000001" }));
  assert.equal(sends, 0);

  online = true;
  draft.refreshConnectivity();
  assert.equal(draft.getSnapshot().state, "ready");
  assert.equal(draft.getSnapshot().canSend, true);
});

test("successful send uses the bound Space and clears the draft", async () => {
  const calls = [];
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({
    spaceSelection: selection,
    readOnline: () => true,
    transport: { async sendMessage(input) { calls.push(input); return { outcome: "applied" }; } },
  });
  draft.setBody("Mensagem");

  const result = await draft.send({
    conversationId: "conversation-1",
    idempotencyKey: "client-key-00000001",
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(calls, [{
    spaceId: "space-a",
    conversationId: "conversation-1",
    idempotencyKey: "client-key-00000001",
    body: "Mensagem",
  }]);
  assert.equal(draft.getSnapshot().body, "");
  assert.equal(draft.getSnapshot().senderSpaceId, null);
});

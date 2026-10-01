import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createNetworkDraftRuntime } from "../system/services/professional-network/draft.mjs";

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

function identity(subjectId = "user-a") {
  return {
    state: "signed-in",
    subjectId,
    displayName: subjectId === "user-a" ? "Pessoa A" : "Pessoa B",
  };
}

function space(id, name, subjectId = "user-a") {
  return {
    id,
    name,
    kind: "professional",
    state: "active",
    ownerId: subjectId,
    profilePack: null,
  };
}

function selected(id, name, subjectId = "user-a") {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace: space(id, name, subjectId),
  };
}

function unselected(subjectId = "user-a") {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId,
    selectedSpace: null,
  };
}

function fixture() {
  const identityPort = mutablePort(
    IDENTITY_SESSION_SCHEMA,
    identity(),
  );
  const selectionPort = mutablePort(
    SPACE_SELECTION_SCHEMA,
    selected("space-a", "Clínica A"),
    {
      select() { throw new Error("not used in Network draft test"); },
      clear() { throw new Error("not used in Network draft test"); },
    },
  );
  return {
    identityPort,
    selectionPort,
    runtime: createNetworkDraftRuntime({
      identitySession: identityPort,
      spaceSelection: selectionPort,
    }),
  };
}

test("Network draft pins the sender Space and never silently retargets after selection changes", () => {
  const { runtime, selectionPort } = fixture();

  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.begin("conversation-0001");
  runtime.setBody("Mensagem da clínica A");

  let snapshot = runtime.getSnapshot();
  assert.equal(snapshot.state, "drafting");
  assert.equal(snapshot.draft.senderSpaceId, "space-a");

  selectionPort.set(selected("space-b", "Clínica B"));
  snapshot = runtime.getSnapshot();
  assert.equal(snapshot.state, "sender-mismatch");
  assert.equal(snapshot.currentSpace.id, "space-b");
  assert.equal(snapshot.draft.senderSpaceId, "space-a");
  assert.equal(snapshot.draft.body, "Mensagem da clínica A");
  assert.throws(() => runtime.bindSend(), /sender context is not ready/);

  runtime.dispose();
});

test("retargeting a Network draft requires an explicit action and preserves its body", () => {
  const { runtime, selectionPort } = fixture();
  runtime.begin("conversation-0001");
  runtime.setBody("Conteúdo preservado");
  selectionPort.set(selected("space-b", "Clínica B"));

  runtime.retargetToCurrentSpace();
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.state, "drafting");
  assert.equal(snapshot.draft.senderSpaceId, "space-b");
  assert.equal(snapshot.draft.senderSpaceName, "Clínica B");
  assert.equal(snapshot.draft.body, "Conteúdo preservado");

  const bound = runtime.bindSend();
  assert.deepEqual(bound, {
    subjectId: "user-a",
    senderSpaceId: "space-b",
    conversationId: "conversation-0001",
    body: "Conteúdo preservado",
  });

  runtime.dispose();
});

test("temporary Space unavailability pauses rather than retargets an existing draft", () => {
  const { runtime, selectionPort } = fixture();
  runtime.begin("conversation-0001");
  runtime.setBody("Rascunho mantido");

  selectionPort.set(unselected());
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.state, "paused");
  assert.equal(snapshot.currentSpace, null);
  assert.equal(snapshot.draft.senderSpaceId, "space-a");
  assert.equal(snapshot.draft.body, "Rascunho mantido");
  assert.throws(() => runtime.bindSend());

  runtime.dispose();
});

test("account identity change clears the previous account Network draft", () => {
  const { runtime, identityPort } = fixture();
  runtime.begin("conversation-0001");
  runtime.setBody("Não pode cruzar contas");

  identityPort.set(identity("user-b"));
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.subjectId, "user-b");
  assert.equal(snapshot.state, "unselected");
  assert.equal(snapshot.draft, null);

  runtime.dispose();
});

test("Network draft enforces bounded safe plain text before any future send", () => {
  const { runtime } = fixture();
  runtime.begin("conversation-0001");
  assert.throws(() => runtime.setBody("antes\u0001depois"), /unsafe control/);
  assert.throws(() => runtime.setBody("x".repeat(4001)), /outside bounds/);
  runtime.setBody("https://example.com continua sendo texto do rascunho");
  assert.equal(runtime.getSnapshot().draft.senderSpaceId, "space-a");
  runtime.dispose();
});
